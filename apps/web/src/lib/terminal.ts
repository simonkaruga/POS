/**
 * Payment Terminal SDK
 * Supports: Ingenico (NEXO), Verifone (VHQ/REST), PAX (PAXSTORE/A920)
 * NFC tap-to-pay via Web NFC API
 * Biometric auth via Web Authentication API (WebAuthn)
 */

// ─── Card Terminal ─────────────────────────────────────────────────────────────

export type TerminalVendor = 'INGENICO' | 'VERIFONE' | 'PAX' | 'SIMULATED';

export interface TerminalConfig {
  vendor: TerminalVendor;
  /** Base URL of the local terminal agent / cloud gateway */
  endpoint: string;
  /** Terminal ID / TID */
  terminalId: string;
  apiKey?: string;
}

export interface PaymentRequest {
  amountCents: number;
  currency?: string;       // default KES
  reference: string;       // sale/order ID
  transactionType?: 'SALE' | 'REFUND' | 'VOID';
}

export interface PaymentResult {
  approved: boolean;
  authCode?: string;
  cardScheme?: string;     // VISA / MASTERCARD / AMEX
  maskedPan?: string;      // e.g. ****1234
  receiptText?: string;
  errorMessage?: string;
  raw?: unknown;
}

/**
 * Send a payment request to a card terminal.
 * Each vendor uses a different local REST protocol.
 * All vendors expose a local HTTP agent on the POS machine (127.0.0.1).
 */
export async function requestCardPayment(
  config: TerminalConfig,
  req: PaymentRequest,
): Promise<PaymentResult> {
  const type = req.transactionType ?? 'SALE';
  const amount = (req.amountCents / 100).toFixed(2);

  if (config.vendor === 'SIMULATED') {
    await new Promise((r) => setTimeout(r, 1500));
    return {
      approved: true,
      authCode: '123456',
      cardScheme: 'VISA',
      maskedPan: '****4242',
      receiptText: `APPROVED\nAuth: 123456\nVISA ****4242\nKES ${amount}`,
    };
  }

  if (config.vendor === 'INGENICO') {
    // Ingenico NEXO Retailer Protocol (local REST agent on port 8080)
    const body = {
      SaleToPOIRequest: {
        MessageHeader: {
          ProtocolVersion: '3.1',
          MessageClass: 'Service',
          MessageCategory: 'Payment',
          MessageType: 'Request',
          ServiceID: req.reference.slice(0, 10),
          SaleID: 'FAIDA-POS',
          POIID: config.terminalId,
        },
        PaymentRequest: {
          SaleData: {
            SaleTransactionID: { TransactionID: req.reference, TimeStamp: new Date().toISOString() },
          },
          PaymentTransaction: {
            AmountsReq: {
              Currency: req.currency ?? 'KES',
              RequestedAmount: parseFloat(amount),
            },
          },
          PaymentData: { PaymentType: type === 'REFUND' ? 'Refund' : 'Normal' },
        },
      },
    };
    const res = await fetch(`${config.endpoint}/nexo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}) },
      body: JSON.stringify(body),
    });
    const data: any = await res.json();
    const resp = data?.SaleToPOIResponse?.PaymentResponse;
    const approved = resp?.Response?.Result === 'Success';
    return {
      approved,
      authCode: resp?.PaymentResult?.PaymentAcquirerData?.ApprovalCode,
      cardScheme: resp?.PaymentResult?.PaymentInstrumentData?.CardData?.PaymentBrand,
      maskedPan: resp?.PaymentResult?.PaymentInstrumentData?.CardData?.MaskedPan,
      errorMessage: approved ? undefined : resp?.Response?.ErrorCondition,
      raw: data,
    };
  }

  if (config.vendor === 'VERIFONE') {
    // Verifone VHQ Cloud / local REST agent
    const res = await fetch(`${config.endpoint}/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? ''}`,
      },
      body: JSON.stringify({
        terminal_id: config.terminalId,
        transaction_type: type.toLowerCase(),
        amount: req.amountCents,
        currency: req.currency ?? 'KES',
        reference: req.reference,
      }),
    });
    const data: any = await res.json();
    return {
      approved: data.status === 'approved',
      authCode: data.auth_code,
      cardScheme: data.card_scheme,
      maskedPan: data.masked_pan,
      receiptText: data.receipt_text,
      errorMessage: data.status !== 'approved' ? (data.message ?? 'Declined') : undefined,
      raw: data,
    };
  }

  if (config.vendor === 'PAX') {
    // PAX A920/A80 — PAXSTORE CloudPOS REST API or local HTTP agent
    const res = await fetch(`${config.endpoint}/api/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-SN': config.terminalId,
        ...(config.apiKey ? { 'X-Api-Key': config.apiKey } : {}),
      },
      body: JSON.stringify({
        transType: type === 'REFUND' ? '20' : '01',
        amount: req.amountCents.toString(),
        currency: req.currency ?? 'KES',
        referenceNum: req.reference,
      }),
    });
    const data: any = await res.json();
    const approved = data.responseCode === '00' || data.result === 'SUCCESS';
    return {
      approved,
      authCode: data.authCode ?? data.approvalCode,
      cardScheme: data.cardType,
      maskedPan: data.maskedCardNo,
      receiptText: data.receiptData,
      errorMessage: approved ? undefined : (data.responseMessage ?? 'Declined'),
      raw: data,
    };
  }

  throw new Error(`Unsupported terminal vendor: ${config.vendor}`);
}

// ─── NFC Tap-to-Pay (Web NFC API) ─────────────────────────────────────────────

export interface NFCReadResult {
  serialNumber: string;
  records: Array<{ recordType: string; data: string }>;
}

/**
 * Read an NFC tag (loyalty card, transit card, custom tag).
 * Requires Chrome on Android with Web NFC enabled.
 * Returns a promise that resolves on first scan or rejects on error/abort.
 */
export async function readNFCTag(timeoutMs = 30000): Promise<NFCReadResult> {
  if (!('NDEFReader' in window)) {
    throw new Error('Web NFC not supported. Use Chrome on Android.');
  }
  const reader = new (window as any).NDEFReader();
  await reader.scan();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('NFC scan timed out'));
    }, timeoutMs);

    reader.onreading = (event: any) => {
      clearTimeout(timer);
      const records = (event.message?.records ?? []).map((r: any) => {
        let data: string;
        try {
          data = new TextDecoder().decode(r.data);
        } catch {
          data = btoa(String.fromCharCode(...new Uint8Array(r.data?.buffer ?? [])));
        }
        return { recordType: r.recordType, data };
      });
      resolve({ serialNumber: event.serialNumber ?? '', records });
    };

    reader.onerror = (e: any) => {
      clearTimeout(timer);
      reject(new Error(e.message ?? 'NFC read error'));
    };
  });
}

/**
 * Write an NDEF text record to an NFC tag.
 */
export async function writeNFCTag(text: string): Promise<void> {
  if (!('NDEFReader' in window)) {
    throw new Error('Web NFC not supported. Use Chrome on Android.');
  }
  const writer = new (window as any).NDEFReader();
  await writer.write({ records: [{ recordType: 'text', data: text }] });
}

/** Check if Web NFC is available in this browser/device. */
export function isNFCSupported(): boolean {
  return 'NDEFReader' in window;
}

// ─── Biometric Authentication (WebAuthn) ──────────────────────────────────────

export interface BiometricRegisterResult {
  credentialId: string;   // base64url — store on server per user
  publicKey: string;      // base64url COSE key
}

export interface BiometricVerifyResult {
  verified: boolean;
  credentialId: string;
  userHandle?: string;
}

/** Check if platform authenticator (fingerprint/face) is available. */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!window.PublicKeyCredential) return false;
  try {
    return await (PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Register a biometric credential for a user (cashier/manager).
 * Call once per device per user. Store the returned credentialId on the server.
 * @param userId  - server-side user UUID
 * @param userName - display name shown on authenticator prompt
 * @param challenge - random bytes from server (base64url)
 */
export async function registerBiometric(
  userId: string,
  userName: string,
  challenge: string,
): Promise<BiometricRegisterResult> {
  const challengeBytes = base64urlToBuffer(challenge);
  const userIdBytes = new TextEncoder().encode(userId);

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: challengeBytes,
      rp: { name: 'Faida POS', id: window.location.hostname },
      user: { id: userIdBytes, name: userName, displayName: userName },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 },  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  }) as PublicKeyCredential;

  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKey = response.getPublicKey?.();

  return {
    credentialId: bufferToBase64url(credential.rawId),
    publicKey: publicKey ? bufferToBase64url(publicKey) : '',
  };
}

/**
 * Verify a biometric credential (login / PIN replacement).
 * @param challenge - random bytes from server (base64url)
 * @param credentialIds - list of allowed credential IDs (base64url) for this user
 */
export async function verifyBiometric(
  challenge: string,
  credentialIds: string[],
): Promise<BiometricVerifyResult> {
  const challengeBytes = base64urlToBuffer(challenge);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: challengeBytes,
      rpId: window.location.hostname,
      allowCredentials: credentialIds.map((id) => ({
        type: 'public-key' as const,
        id: base64urlToBuffer(id),
        transports: ['internal'] as AuthenticatorTransport[],
      })),
      userVerification: 'required',
      timeout: 60000,
    },
  }) as PublicKeyCredential;

  const response = assertion.response as AuthenticatorAssertionResponse;
  const userHandle = response.userHandle
    ? new TextDecoder().decode(response.userHandle)
    : undefined;

  return {
    verified: true,
    credentialId: bufferToBase64url(assertion.rawId),
    userHandle,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
