import { HttpException } from '@nestjs/common';
import { generateLicenseKeyPair, LicensePayload, signLicense } from './license-token';
import { LicenseService } from './license.service';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-11-08T12:00:00Z');
const MACHINE = 'this-computer-1111';
const server = generateLicenseKeyPair();
const stranger = generateLicenseKeyPair();

const payload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 1, lid: 'lic-1', tier: 'PRO', machineId: MACHINE, issuedAt: T0.toISOString(),
  tokenExpiresAt: new Date(T0.getTime() + 30 * DAY).toISOString(), licenseExpiresAt: new Date(T0.getTime() + 365 * DAY).toISOString(), ...over,
});
const token = (over: Partial<LicensePayload> = {}, key = server.privateKeyPem) => signLicense(payload(over), key);

/** In-memory stand-ins for the two tables the service touches. */
function setup() {
  const state: { row: any | null; businessUpdates: any[]; business: any } = {
    row: null,
    businessUpdates: [],
    business: { trialEndsAt: new Date(T0.getTime() + 10 * DAY), subscriptionStatus: 'TRIAL' },
  };
  const prisma: any = {
    localLicense: {
      findUnique: jest.fn(async () => state.row),
      update: jest.fn(async ({ data }: any) => { Object.assign(state.row, data); return state.row; }),
      upsert: jest.fn(async ({ create, update }: any) => { state.row = state.row ? { ...state.row, ...update } : { ...create }; return state.row; }),
    },
    business: {
      findFirst: jest.fn(async () => state.business),
      updateMany: jest.fn(async ({ data }: any) => { state.businessUpdates.push(data); return { count: 1 }; }),
    },
  };
  const svc = new LicenseService(prisma);
  return { svc, state, prisma };
}

const answer = (status: number, body: object): typeof fetch => (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof HttpException ? (e.getResponse() as any).code : String(e); } };

describe('the offline licence', () => {
  beforeEach(() => {
    process.env.FAIDA_EDITION = 'LOCAL';
    process.env.FAIDA_MACHINE_ID = MACHINE;
    process.env.FAIDA_LICENSE_PUBLIC_KEY = server.publicKeyPem;
    delete process.env.LICENSE_SERVER_URL;
  });
  afterAll(() => { for (const k of ['FAIDA_EDITION', 'FAIDA_MACHINE_ID', 'FAIDA_LICENSE_PUBLIC_KEY']) delete process.env[k]; });

  it('on the cloud server it does nothing and says cloud', async () => {
    process.env.FAIDA_EDITION = 'CLOUD';
    const { svc } = setup();
    expect((await svc.status(T0)).edition).toBe('CLOUD');
    expect(await code(svc.activate('KPS-AAAA-BBBB-CCCC', T0))).not.toBe('OK');
  });

  it('with no licence: state NONE, the trial is reported, and the business is left exactly as registered', async () => {
    const { svc, state } = setup();
    const s = await svc.status(T0);
    expect(s.state).toBe('NONE');
    expect(s.trial).toEqual({ active: true, endsAt: new Date(T0.getTime() + 10 * DAY).toISOString(), daysLeft: 10 });
    await svc.reconcile(T0);
    expect(state.businessUpdates).toHaveLength(0);
  });

  it('activating takes the signed licence, stores it, and sets the business to the licensed plan', async () => {
    const { svc, state } = setup();
    svc.http = answer(201, { token: token() });
    const s = await svc.activate(' KPS-AAAA-BBBB-CCCC ', T0);
    expect(s.state).toBe('ACTIVE');
    expect(s.tier).toBe('PRO');
    expect(s.daysLeft).toBe(30);
    expect(s.keyHint).toBe('KPS-…CCCC');
    expect(state.row.key).toBe('KPS-AAAA-BBBB-CCCC');
    expect(state.businessUpdates.at(-1)).toEqual({ subscriptionTier: 'PRO', subscriptionStatus: 'ACTIVE', trialEndsAt: null, planName: 'Pro' });
  });

  it('shows the owner what the licence server said when it refuses, and stores nothing', async () => {
    for (const [status, c] of [[409, 'OTHER_COMPUTER'], [403, 'REVOKED'], [404, 'UNKNOWN_KEY'], [403, 'EXPIRED']] as const) {
      const { svc, state } = setup();
      svc.http = answer(status, { code: c, message: `message for ${c}` });
      expect(await code(svc.activate('KPS-AAAA-BBBB-CCCC', T0))).toBe(c);
      expect(state.row).toBeNull();
    }
  });

  it('being offline when activating gives a clear message and stores nothing', async () => {
    const { svc, state } = setup();
    svc.http = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    expect(await code(svc.activate('KPS-AAAA-BBBB-CCCC', T0))).toBe('UNREACHABLE');
    expect(state.row).toBeNull();
  });

  it('a licence that does not verify is never stored: signed by someone else, or made for another computer', async () => {
    const forged = setup();
    forged.svc.http = answer(201, { token: token({}, stranger.privateKeyPem) });
    expect(await code(forged.svc.activate('KPS-AAAA-BBBB-CCCC', T0))).toBe('BAD_SIGNATURE');
    expect(forged.state.row).toBeNull();

    const elsewhere = setup();
    elsewhere.svc.http = answer(201, { token: token({ machineId: 'some-other-computer' }) });
    expect(await code(elsewhere.svc.activate('KPS-AAAA-BBBB-CCCC', T0))).toBe('WRONG_COMPUTER');
    expect(elsewhere.state.row).toBeNull();
  });

  it('editing the database cannot upgrade or extend a licence: the plan and dates come from the signed token', async () => {
    const { svc, state } = setup();
    svc.http = answer(201, { token: token({ tier: 'STARTER' }) });
    await svc.activate('KPS-AAAA-BBBB-CCCC', T0);
    state.row.tier = 'ENTERPRISE'; // someone edits the readable copy
    state.row.tokenExpiresAt = new Date(T0.getTime() + 999 * DAY);
    const s = await svc.status(T0);
    expect(s.tier).toBe('STARTER');
    expect(s.tokenExpiresAt).toBe(payload({ tier: 'STARTER' }).tokenExpiresAt);
  });

  it('a database copied to another computer carries no licence there', async () => {
    const { svc } = setup();
    svc.http = answer(201, { token: token() });
    await svc.activate('KPS-AAAA-BBBB-CCCC', T0);
    process.env.FAIDA_MACHINE_ID = 'a-different-computer';
    expect((await svc.status(T0)).state).toBe('NONE');
  });

  it('as time passes: active, then grace (still the paid plan), then lapsed (Free plan); the licence is never deleted', async () => {
    const { svc, state } = setup();
    svc.http = answer(201, { token: token() });
    await svc.activate('KPS-AAAA-BBBB-CCCC', T0);

    await svc.reconcile(new Date(T0.getTime() + 31 * DAY)); // token ended yesterday
    expect((await svc.status(new Date(T0.getTime() + 31 * DAY))).state).toBe('GRACE');
    expect(state.businessUpdates.at(-1)).toMatchObject({ subscriptionStatus: 'ACTIVE', subscriptionTier: 'PRO' });

    const lapsed = new Date(T0.getTime() + 46 * DAY);
    await svc.reconcile(lapsed);
    expect((await svc.status(lapsed)).state).toBe('LAPSED');
    expect(state.businessUpdates.at(-1)).toEqual({ subscriptionStatus: 'EXPIRED' });
    expect(state.row).not.toBeNull();
  });

  it('winding the clock back does not bring a lapsed licence back to life', async () => {
    const { svc, state } = setup();
    svc.http = answer(201, { token: token() });
    await svc.activate('KPS-AAAA-BBBB-CCCC', T0);
    const lapsed = new Date(T0.getTime() + 50 * DAY);
    await svc.reconcile(lapsed); // the computer sees this date
    const cheat = new Date(T0.getTime() + 5 * DAY); // then the clock is set back to when the licence was fine
    const s = await svc.status(cheat);
    expect(s.state).toBe('LAPSED');
    expect(s.clockBehind).toBe(true);
    await svc.reconcile(cheat);
    expect(state.businessUpdates.at(-1)).toEqual({ subscriptionStatus: 'EXPIRED' });
  });

  it('renewing refreshes the token and the plan', async () => {
    const { svc, state } = setup();
    svc.http = answer(201, { token: token() });
    await svc.activate('KPS-AAAA-BBBB-CCCC', T0);
    const later = new Date(T0.getTime() + 10 * DAY);
    svc.http = answer(201, { token: token({ tier: 'ENTERPRISE', issuedAt: later.toISOString(), tokenExpiresAt: new Date(later.getTime() + 30 * DAY).toISOString() }) });
    const s = await svc.renew(later);
    expect(s.tier).toBe('ENTERPRISE');
    expect(s.daysLeft).toBe(30);
    expect(state.row.serverStatus).toBe('OK');
  });

  it('a cancelled licence: renewal is refused, the owner is told, and the licence keeps working until its own end', async () => {
    const { svc } = setup();
    svc.http = answer(201, { token: token() });
    await svc.activate('KPS-AAAA-BBBB-CCCC', T0);
    svc.http = answer(403, { code: 'REVOKED', message: 'This licence has been cancelled.' });
    const later = new Date(T0.getTime() + 5 * DAY);
    const s = await svc.renew(later);
    expect(s.serverStatus).toBe('REVOKED');
    expect(s.serverMessage).toMatch(/cancelled/i);
    expect(s.state).toBe('ACTIVE'); // not cut off: it runs to the end of the token, then the grace
    expect(s.daysLeft).toBe(25);
  });

  it('offline renewal is not an error: the licence keeps its dates', async () => {
    const { svc } = setup();
    svc.http = answer(201, { token: token() });
    await svc.activate('KPS-AAAA-BBBB-CCCC', T0);
    svc.http = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const s = await svc.renew(new Date(T0.getTime() + 3 * DAY));
    expect(s.state).toBe('ACTIVE');
    expect(s.serverStatus).toBe('UNREACHABLE');
  });

  it('renews quietly at most once a day, and never when there is no licence', async () => {
    const { svc } = setup();
    const http = jest.fn(answer(201, { token: token() }));
    svc.http = http as unknown as typeof fetch;
    await svc.maybeRenew(T0); // no licence yet: nothing to renew
    expect(http).not.toHaveBeenCalled();
    await svc.activate('KPS-AAAA-BBBB-CCCC', T0);
    http.mockClear();
    await svc.maybeRenew(new Date(T0.getTime() + 2 * 60 * 60 * 1000)); // two hours later: too soon
    expect(http).not.toHaveBeenCalled();
    await svc.maybeRenew(new Date(T0.getTime() + 25 * 60 * 60 * 1000)); // a day later: due
    expect(http).toHaveBeenCalledTimes(1);
  });
});
