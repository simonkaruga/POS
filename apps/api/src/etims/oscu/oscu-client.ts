/**
 * The HTTP side of KRA eTIMS OSCU: one POST per call, JSON in and out, a `resultCd` string in every answer.
 *
 * Authentication is the communication key (cmcKey) that /selectInitOsdcInfo hands out for a device serial KRA has
 * approved. It goes on every later call as a header (tin, bhfId, cmcKey) and, because the specification is ambiguous,
 * in the body too. It does not expire, and re-initialising with another serial invalidates it.
 */

export const OSCU_API_URL = {
  sandbox: 'https://etims-api-sbx.kra.go.ke/etims-api',
  production: 'https://etims-api.kra.go.ke/etims-api',
} as const;

/** KRA's public receipt page; an invoice QR code links here with PIN + branch + receipt signature. */
export const OSCU_RECEIPT_URL = {
  sandbox: 'https://etims-sbx.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData',
  production: 'https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData',
} as const;

export type OscuEnvironment = keyof typeof OSCU_API_URL;

export interface OscuIdentity {
  tin: string;
  bhfId: string;
  cmcKey: string;
}

/** Result codes from section 4.18 of the specification, with what to do about each. */
const RESULT_CODES: Record<string, { message: string; kind: OscuErrorKind }> = {
  '900': { message: 'There is no header information (tin, bhfId or cmcKey)', kind: 'auth' },
  '901': { message: 'It is not a valid device', kind: 'device' },
  '902': { message: 'This device is already installed', kind: 'device' },
  '903': { message: 'Only an OSCU device can be verified', kind: 'device' },
  '905': { message: 'This serial is not approved as an OSCU device', kind: 'device' },
  '910': { message: 'Request parameter error', kind: 'rejected' },
  '911': { message: 'There is no request full text', kind: 'rejected' },
  '912': { message: 'Request method error', kind: 'rejected' },
  '921': { message: 'This sale or invoice was already declared', kind: 'duplicate' },
  '922': { message: 'Sales invoice data can be received only after the sales data', kind: 'sequence' },
  '990': { message: 'The maximum number of views was exceeded', kind: 'unavailable' },
  '991': { message: 'KRA error during registration', kind: 'unavailable' },
  '992': { message: 'KRA error during modification', kind: 'unavailable' },
  '993': { message: 'KRA error during deletion', kind: 'unavailable' },
  '994': { message: 'This data is already registered (overlapped)', kind: 'duplicate' },
  '995': { message: 'There is no downloaded file', kind: 'unavailable' },
  '999': { message: 'Unknown KRA error', kind: 'unavailable' },
};

/**
 * - unavailable: KRA could not be reached or failed internally. Nothing was accepted; try again later.
 * - duplicate: KRA already has this record (an invoice number sent before). Treat as done, never resend a new number.
 * - rejected / sequence / auth / device: the request itself is wrong. Retrying the same thing will fail again;
 *   a person has to fix the data or the setup.
 */
export type OscuErrorKind = 'unavailable' | 'duplicate' | 'rejected' | 'sequence' | 'auth' | 'device';

export class OscuError extends Error {
  constructor(
    message: string,
    readonly kind: OscuErrorKind,
    readonly resultCd?: string,
    readonly response?: unknown,
  ) {
    super(message);
    this.name = 'OscuError';
  }
  get retryable(): boolean {
    return this.kind === 'unavailable';
  }
}

export interface OscuCallLog {
  path: string;
  request: unknown;
  response: unknown;
  resultCd: string | null;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface OscuClientOptions {
  environment: OscuEnvironment;
  /** Overrides the API base URL (tests, a proxy). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Every attempt, request and response, for the audit trail KRA disputes are settled with. */
  onCall?: (log: OscuCallLog) => void | Promise<void>;
}

export interface OscuEnvelope {
  resultCd: string;
  resultMsg?: string;
  resultDt?: string;
  data?: any;
}

export class OscuClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: OscuClientOptions) {
    this.baseUrl = (opts.baseUrl ?? OSCU_API_URL[opts.environment]).replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  get receiptUrl(): string {
    return OSCU_RECEIPT_URL[this.opts.environment];
  }

  /** The link for an invoice's QR code: KRA's receipt page looked up by PIN + branch + receipt signature. */
  qrUrl(tin: string, bhfId: string, rcptSign: string): string {
    return `${this.receiptUrl}?Data=${encodeURIComponent(`${tin}${bhfId}${rcptSign}`)}`;
  }

  /**
   * Initialise the device KRA approved for this taxpayer and branch, and get its communication key.
   * The serial is the one KRA issued on the eTIMS portal; never make one up, or KRA refuses it (901/905).
   */
  async initDevice(tin: string, bhfId: string, dvcSrlNo: string): Promise<{ cmcKey: string; info: Record<string, unknown> }> {
    const env = await this.post('/selectInitOsdcInfo', { tin, bhfId, dvcSrlNo }, {});
    const info = env.data?.info;
    if (!info || typeof info !== 'object') throw new OscuError('Device initialisation returned no device information', 'rejected', env.resultCd, env);
    const cmcKey = String(info.cmcKey ?? '').trim();
    if (!cmcKey) throw new OscuError('Device initialisation returned no communication key', 'rejected', env.resultCd, env);
    return { cmcKey, info };
  }

  /** An authenticated call. "001" (no search result) is a normal empty answer, not an error. */
  async call(identity: OscuIdentity, path: string, body: Record<string, unknown>): Promise<OscuEnvelope> {
    const auth = { tin: identity.tin, bhfId: identity.bhfId, cmcKey: identity.cmcKey };
    return this.post(path, { ...auth, ...body }, auth);
  }

  private async post(path: string, body: Record<string, unknown>, authHeaders: Record<string, string>): Promise<OscuEnvelope> {
    const started = Date.now();
    const log: OscuCallLog = { path, request: redact(body), response: null, resultCd: null, ok: false, durationMs: 0 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        throw new OscuError(`Could not reach KRA eTIMS: ${e instanceof Error ? e.message : String(e)}`, 'unavailable');
      }
      const text = await res.text();
      let json: any;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      log.response = json ?? text.slice(0, 2000);
      if (!res.ok) {
        // 5xx and gateway errors are KRA being down; a 4xx is our request.
        throw new OscuError(`KRA eTIMS HTTP ${res.status}`, res.status >= 500 || res.status === 429 ? 'unavailable' : 'rejected', undefined, log.response);
      }
      if (!json || typeof json !== 'object' || !('resultCd' in json)) {
        throw new OscuError('KRA eTIMS sent an answer without a result code', 'unavailable', undefined, log.response);
      }
      // A string, always: "000" is not the number 0, and leading zeros matter.
      const resultCd = String(json.resultCd).trim();
      log.resultCd = resultCd;
      if (resultCd === '000' || resultCd === '001') {
        log.ok = true;
        return { ...json, resultCd };
      }
      const known = RESULT_CODES[resultCd];
      const kind: OscuErrorKind = known?.kind ?? (resultCd.startsWith('9') ? 'rejected' : 'unavailable');
      throw new OscuError(`KRA eTIMS ${resultCd}: ${json.resultMsg ?? known?.message ?? 'error'}`, kind, resultCd, json);
    } catch (e) {
      log.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      clearTimeout(timer);
      log.durationMs = Date.now() - started;
      try { await this.opts.onCall?.(log); } catch { /* logging must never break a submission */ }
    }
  }
}

/** The communication key is a secret; it never goes into a log. */
function redact(body: Record<string, unknown>): Record<string, unknown> {
  if (!('cmcKey' in body)) return body;
  return { ...body, cmcKey: '***' };
}
