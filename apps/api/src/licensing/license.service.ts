/**
 * The offline edition's side of licensing: holds the signed licence, activates and quietly renews it, and keeps the
 * business's plan in step with it.
 *
 * Only runs as the offline edition (FAIDA_EDITION=LOCAL, set by the desktop app's server program). On the cloud server every
 * method answers "cloud" and does nothing, so the cloud's own subscription handling is untouched.
 *
 * Trust: the plan and the dates are read from the verified token, never from the readable copy in the database, so editing the
 * database cannot upgrade or extend a licence. A token made for another computer is refused, so a copied database is useless.
 */
import { HttpException, Injectable, Logger, OnApplicationBootstrap, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as os from 'node:os';
import { PrismaService } from '../prisma/prisma.service';
import { LicensePayload, verifyLicense } from './license-token';
import { evaluateLicense, LicenseEvaluation, LicenseState, planFieldsFor } from './license-state';

const DAY = 24 * 60 * 60 * 1000;
/** Where licences are issued; the desktop app can point elsewhere (a test server). */
const DEFAULT_SERVER = 'https://faida-api.onrender.com';
/** How often a connected installation renews. The token lasts 30 days, so a day's renewal keeps it fresh with huge margin. */
const RENEW_EVERY_MS = DAY;

export interface LicenseStatus {
  edition: 'LOCAL' | 'CLOUD';
  /** The public key and the computer's id are known; without them nothing can be checked. */
  configured: boolean;
  state: LicenseState;
  tier: string | null;
  tokenExpiresAt: string | null;
  licenseExpiresAt: string | null;
  graceEndsAt: string | null;
  daysLeft: number | null;
  clockBehind: boolean;
  machineId: string | null;
  /** Hint of the activated key, e.g. "KPS-…-1a2b". */
  keyHint: string | null;
  /** What the licence server last said: OK, REVOKED, EXPIRED, OTHER_COMPUTER or UNREACHABLE. */
  serverStatus: string | null;
  serverMessage: string | null;
  lastRenewedAt: string | null;
  trial: { active: boolean; endsAt: string | null; daysLeft: number | null } | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const failure = (status: number, code: string, message: string) => new HttpException({ statusCode: status, code, message }, status);

@Injectable()
export class LicenseService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LicenseService.name);
  /** Replaceable in tests. */
  http: typeof fetch = (input, init) => fetch(input, init);
  private renewing: Promise<unknown> | null = null;
  private lastAttemptAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  get edition(): 'LOCAL' | 'CLOUD' {
    return process.env.FAIDA_EDITION === 'LOCAL' ? 'LOCAL' : 'CLOUD';
  }
  private get publicKey(): string | null { return process.env.FAIDA_LICENSE_PUBLIC_KEY?.trim() || null; }
  private get machineId(): string | null { return process.env.FAIDA_MACHINE_ID?.trim() || null; }
  private get serverUrl(): string { return (process.env.LICENSE_SERVER_URL?.trim() || DEFAULT_SERVER).replace(/\/+$/, ''); }
  private get configured(): boolean { return !!this.publicKey && !!this.machineId; }

  async onApplicationBootstrap(): Promise<void> {
    if (this.edition !== 'LOCAL') return;
    await this.reconcile().catch((e) => this.logger.warn(`Could not apply the licence at start: ${(e as Error).message}`));
    // First renewal a little after start, when the network is up.
    setTimeout(() => void this.maybeRenew().catch(() => undefined), 20000).unref?.();
  }

  /** Twice an hour: re-apply the licence to the business (dates move on) and renew if it is due and the internet is there. */
  @Cron('*/30 * * * *')
  async tick(): Promise<void> {
    if (this.edition !== 'LOCAL') return;
    await this.reconcile().catch((e) => this.logger.warn(`Licence check failed: ${(e as Error).message}`));
    await this.maybeRenew().catch(() => undefined);
  }

  // ── reading the stored licence ──────────────────────────────────────────────

  /** The stored licence as the signed token says it is, or null if there is none or it does not verify for this computer. */
  private async load(): Promise<{ row: NonNullable<Awaited<ReturnType<LicenseService['findRow']>>>; payload: LicensePayload } | null> {
    const row = await this.findRow();
    if (!row || !this.publicKey) return null;
    const v = verifyLicense(row.token, this.publicKey);
    if (!v.ok) return null;
    if (this.machineId && v.payload.machineId !== this.machineId) return null; // made for another computer
    return { row, payload: v.payload };
  }

  private findRow() {
    return this.prisma.localLicense.findUnique({ where: { id: 'local' } });
  }

  // ── status ──────────────────────────────────────────────────────────────────

  async status(now: Date = new Date()): Promise<LicenseStatus> {
    if (this.edition !== 'LOCAL') {
      return { edition: 'CLOUD', configured: false, state: 'NONE', tier: null, tokenExpiresAt: null, licenseExpiresAt: null, graceEndsAt: null, daysLeft: null, clockBehind: false, machineId: null, keyHint: null, serverStatus: null, serverMessage: null, lastRenewedAt: null, trial: null };
    }
    const held = await this.load();
    const row = await this.findRow();
    const evaluation = evaluateLicense(
      held ? { tier: held.payload.tier, tokenExpiresAt: new Date(held.payload.tokenExpiresAt), licenseExpiresAt: held.payload.licenseExpiresAt ? new Date(held.payload.licenseExpiresAt) : null, lastSeenAt: held.row.lastSeenAt } : null,
      now,
    );
    const business = await this.prisma.business.findFirst({ select: { trialEndsAt: true, subscriptionStatus: true }, orderBy: { createdAt: 'asc' } });
    const trialEnds = business?.trialEndsAt ?? null;
    const trial = business
      ? { active: business.subscriptionStatus === 'TRIAL' && !!trialEnds && trialEnds >= now, endsAt: iso(trialEnds), daysLeft: trialEnds ? Math.max(0, Math.ceil((trialEnds.getTime() - now.getTime()) / DAY)) : null }
      : null;
    return {
      edition: 'LOCAL',
      configured: this.configured,
      state: evaluation.state,
      tier: held?.payload.tier ?? null,
      tokenExpiresAt: held?.payload.tokenExpiresAt ?? null,
      licenseExpiresAt: held?.payload.licenseExpiresAt ?? null,
      graceEndsAt: iso(evaluation.graceEndsAt),
      daysLeft: evaluation.daysLeft,
      clockBehind: evaluation.clockBehind,
      machineId: this.machineId,
      keyHint: row ? `${row.key.slice(0, 4)}…${row.key.slice(-4)}` : null,
      serverStatus: row?.serverStatus ?? null,
      serverMessage: row?.serverMessage ?? null,
      lastRenewedAt: iso(row?.lastRenewedAt),
      trial,
    };
  }

  // ── applying it to the business ────────────────────────────────────────────

  /**
   * Bring the business's plan fields in line with the licence. Every existing check (feature gates, limits, the plan shown in
   * the app) already reads those fields, so this is the whole enforcement. Also remembers the latest time seen, so the clock
   * cannot be wound back past it.
   */
  async reconcile(now: Date = new Date()): Promise<LicenseEvaluation> {
    const held = await this.load();
    const evaluation = evaluateLicense(
      held ? { tier: held.payload.tier, tokenExpiresAt: new Date(held.payload.tokenExpiresAt), licenseExpiresAt: held.payload.licenseExpiresAt ? new Date(held.payload.licenseExpiresAt) : null, lastSeenAt: held.row.lastSeenAt } : null,
      now,
    );
    if (held && (!held.row.lastSeenAt || evaluation.effectiveNow > held.row.lastSeenAt)) {
      await this.prisma.localLicense.update({ where: { id: 'local' }, data: { lastSeenAt: evaluation.effectiveNow } });
    }
    const fields = held ? planFieldsFor(evaluation.state, held.payload.tier) : null;
    if (fields) await this.prisma.business.updateMany({ where: { isComped: false }, data: fields });
    return evaluation;
  }

  // ── talking to the licence server ──────────────────────────────────────────

  private async ask(path: 'activate' | 'renew', key: string): Promise<{ token: string }> {
    const machineId = this.machineId;
    if (!machineId) throw failure(503, 'NOT_CONFIGURED', 'This computer could not be identified, so it cannot be licensed.');
    let res: Response;
    try {
      res = await this.http(`${this.serverUrl}/api/v1/license-server/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, machineId, hostname: os.hostname() }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw failure(503, 'UNREACHABLE', 'Could not reach the Faida licence server. Connect this computer to the internet and try again.');
    }
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; token?: string };
    if (!res.ok) throw failure(res.status, body.code ?? 'REFUSED', body.message ?? 'The licence server refused the request.');
    if (!body.token) throw failure(502, 'BAD_ANSWER', 'The licence server gave an unreadable answer.');
    return { token: body.token };
  }

  private async store(key: string, token: string, now: Date): Promise<LicensePayload> {
    if (!this.publicKey) throw failure(503, 'NOT_CONFIGURED', 'This installation has no licence key to check licences against. Reinstall Faida POS.');
    const v = verifyLicense(token, this.publicKey);
    // A licence that does not verify is never stored: it could be a forgery, or an answer from the wrong server.
    if (!v.ok) throw failure(502, 'BAD_SIGNATURE', 'The licence could not be verified. Contact Faida support.');
    if (v.payload.machineId !== this.machineId) throw failure(502, 'WRONG_COMPUTER', 'That licence is for a different computer.');
    const previous = await this.findRow();
    const tokenExpiresAt = new Date(v.payload.tokenExpiresAt);
    const lastSeenAt = previous?.lastSeenAt && previous.lastSeenAt > now ? previous.lastSeenAt : now;
    const data = {
      key, token, tier: v.payload.tier, machineId: v.payload.machineId,
      licenseExpiresAt: v.payload.licenseExpiresAt ? new Date(v.payload.licenseExpiresAt) : null,
      tokenExpiresAt, lastRenewedAt: now, lastSeenAt, serverStatus: 'OK', serverMessage: null,
    };
    await this.prisma.localLicense.upsert({ where: { id: 'local' }, create: { id: 'local', activatedAt: now, ...data }, update: data });
    return v.payload;
  }

  /** The owner enters a key: bind it to this computer and take the licence. Errors are shown to the owner as they are. */
  async activate(rawKey: string, now: Date = new Date()): Promise<LicenseStatus> {
    if (this.edition !== 'LOCAL') throw new BadRequestException('Licences are activated on the offline edition only.');
    const key = String(rawKey ?? '').trim();
    if (key.length < 8) throw failure(400, 'BAD_KEY', 'Enter the licence key from your purchase email.');
    const { token } = await this.ask('activate', key);
    await this.store(key, token, now);
    await this.reconcile(now);
    return this.status(now);
  }

  /** Renew now (the owner pressed "Check now") or because it is due. Offline is not an error: the licence just keeps its dates. */
  async renew(now: Date = new Date()): Promise<LicenseStatus> {
    if (this.edition !== 'LOCAL') throw new BadRequestException('Licences are renewed on the offline edition only.');
    const row = await this.findRow();
    if (!row) throw failure(400, 'NO_LICENSE', 'There is no licence to renew yet. Activate a key first.');
    if (this.renewing) { await this.renewing.catch(() => undefined); return this.status(now); }
    this.renewing = (async () => {
      try {
        const { token } = await this.ask('renew', row.key);
        await this.store(row.key, token, now);
      } catch (e) {
        const body = e instanceof HttpException ? (e.getResponse() as { code?: string; message?: string }) : {};
        const code = body.code ?? 'UNREACHABLE';
        // Keep the licence as it is; remember why renewal did not happen so the owner can be told.
        await this.prisma.localLicense.update({ where: { id: 'local' }, data: { serverStatus: code, serverMessage: body.message ?? null } });
      } finally {
        this.lastAttemptAt = now.getTime();
      }
      await this.reconcile(now);
    })();
    try { await this.renewing; } finally { this.renewing = null; }
    return this.status(now);
  }

  /** Renew if it has been a day since the last success (and not tried in the last hour). Silent. */
  async maybeRenew(now: Date = new Date()): Promise<void> {
    const row = await this.findRow();
    if (!row) return;
    if (now.getTime() - row.lastRenewedAt.getTime() < RENEW_EVERY_MS) return;
    if (now.getTime() - this.lastAttemptAt < 60 * 60 * 1000) return;
    await this.renew(now);
  }
}
