/**
 * Licensing on real software: the real API on a real PostgreSQL, talking to a stand-in Faida licence server that signs with
 * a key made for this test. Skips itself like supervisor.integration.test.ts unless FAIDA_PG_BIN is set and the API is built.
 *
 * What it proves, end to end: a key entered by the owner becomes a signed licence that the app checks with only the public
 * key; the plan on the business changes; it survives a restart; a licence signed by the WRONG key or for ANOTHER computer is
 * refused and changes nothing; and a refused renewal keeps the licence and says why.
 */
import { generateKeyPairSync } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { findFreePort } from '../src/ports';
import { Supervisor, SupervisorOptions } from '../src/supervisor';

const PG_BIN = process.env.FAIDA_PG_BIN;
const REPO = path.resolve(__dirname, '..', '..', '..');
const API_MAIN = path.join(REPO, 'apps', 'api', 'dist', 'main.js');
const TOKEN_JS = path.join(REPO, 'apps', 'api', 'dist', 'licensing', 'license-token.js');
const PRISMA_CLI = path.join(REPO, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = path.join(REPO, 'prisma', 'schema.prisma');
const ready = !!PG_BIN && fs.existsSync(API_MAIN) && fs.existsSync(TOKEN_JS) && fs.existsSync(PRISMA_CLI);
const maybe = ready ? describe : describe.skip;

const PASSWORD = `Aa1-${randomBytes(12).toString('hex')}`;
const MACHINE = 'test-machine-0001';
const KEY = 'KPS-1a2b3c4d-5e6f7a8b-9c0d1e2f';
const DAY = 24 * 60 * 60 * 1000;

const pem = (k: ReturnType<typeof generateKeyPairSync>) => ({
  pub: k.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  priv: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
});

maybe('licensing, end to end', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { signLicense } = require(TOKEN_JS) as typeof import('../../../apps/api/src/licensing/license-token');
  const good = pem(generateKeyPairSync('ed25519'));
  const other = pem(generateKeyPairSync('ed25519'));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faida-lic-'));
  let apiPort = 0;
  let pgPort = 0;
  let authority: http.Server;
  let authorityPort = 0;
  /** What the stand-in licence server does next. */
  let mode: 'OK' | 'WRONG_SIGNER' | 'OTHER_COMPUTER_TOKEN' | 'REVOKED' = 'OK';
  const asked: string[] = [];

  const token = (signer: string, machineId: string) => {
    const now = Date.now();
    return signLicense({ v: 1, lid: 'lic-1', tier: 'PRO', machineId, issuedAt: new Date(now).toISOString(), tokenExpiresAt: new Date(now + 30 * DAY).toISOString(), licenseExpiresAt: new Date(now + 365 * DAY).toISOString() }, signer);
  };

  const opts = (): SupervisorOptions & { machineId: string; licenseServerUrl: string; licensePublicKey: string } => ({
    configFile: path.join(root, 'server.json'),
    logDir: path.join(root, 'logs'),
    pgDataDir: path.join(root, 'pgdata'),
    backupDir: path.join(root, 'backups'),
    lanEnabled: false,
    pgPort,
    apiPort,
    pgBinDir: PG_BIN as string,
    pgLibDir: process.env.FAIDA_PG_LIB,
    nodePath: process.execPath,
    apiMain: API_MAIN,
    prismaCli: PRISMA_CLI,
    schemaPath: SCHEMA,
    appVersion: '1.0.0',
    platform: process.platform as 'linux',
    machineId: MACHINE,
    licenseServerUrl: `http://127.0.0.1:${authorityPort}`,
    licensePublicKey: good.pub,
  });

  const api = (p: string) => `http://127.0.0.1:${apiPort}/api/v1${p}`;
  const call = async (method: string, p: string, body?: unknown, bearer?: string) => {
    const res = await fetch(api(p), {
      method,
      headers: { 'Content-Type': 'application/json', Origin: 'http://tauri.localhost', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  let owner = '';
  const signIn = async () => {
    const r = await call('POST', '/auth/login', { email: 'owner@shop.test', password: PASSWORD });
    expect(r.status).toBe(201);
    return r.body.accessToken as string;
  };

  beforeAll(async () => {
    pgPort = await findFreePort(54500);
    apiPort = await findFreePort(3500);
    authorityPort = await findFreePort(3600);
    authority = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}') as { key: string; machineId: string };
        asked.push(`${req.url} ${body.machineId}`);
        const send = (status: number, json: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
        if (mode === 'REVOKED') return send(403, { code: 'REVOKED', message: 'This licence key has been revoked.' });
        if (mode === 'WRONG_SIGNER') return send(201, { token: token(other.priv, body.machineId) });
        if (mode === 'OTHER_COMPUTER_TOKEN') return send(201, { token: token(good.priv, 'some-other-computer') });
        return send(201, { token: token(good.priv, body.machineId) });
      });
    });
    await new Promise<void>((r) => authority.listen(authorityPort, '127.0.0.1', r));
  });

  afterAll(async () => {
    await new Promise((r) => authority.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a new shop starts without a licence', async () => {
    const sup = new Supervisor(opts());
    await sup.start();
    try {
      const reg = await call('POST', '/auth/register', { name: 'Owner', email: 'owner@shop.test', password: PASSWORD, businessName: 'Licensed Shop' });
      expect(reg.status).toBe(201);
      owner = await signIn();
      const st = await call('GET', '/license/status', undefined, owner);
      expect(st.status).toBe(200);
      expect(st.body).toMatchObject({ edition: 'LOCAL', configured: true, state: 'NONE', machineId: MACHINE, tier: null });
    } finally {
      await sup.stop();
    }
  });

  it('refuses a licence signed by the wrong key, or made for another computer, and changes nothing', async () => {
    const sup = new Supervisor(opts());
    await sup.start();
    try {
      owner = await signIn();
      mode = 'WRONG_SIGNER';
      let r = await call('POST', '/license/activate', { key: KEY }, owner);
      expect(r.status).toBe(502);
      expect(r.body.code ?? r.body.message).toBeTruthy();
      mode = 'OTHER_COMPUTER_TOKEN';
      r = await call('POST', '/license/activate', { key: KEY }, owner);
      expect(r.status).toBe(502);
      const st = await call('GET', '/license/status', undefined, owner);
      expect(st.body).toMatchObject({ state: 'NONE', tier: null });
    } finally {
      mode = 'OK';
      await sup.stop();
    }
  });

  it('activating a key gives the shop the plan, and it survives a restart', async () => {
    const sup = new Supervisor(opts());
    await sup.start();
    try {
      owner = await signIn();
      const r = await call('POST', '/license/activate', { key: KEY }, owner);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ state: 'ACTIVE', tier: 'PRO' });
      expect(asked[asked.length - 1]).toBe(`/api/v1/license-server/activate ${MACHINE}`);
      // The plan the rest of the app reads has changed: a fresh sign-in carries it.
      const login = await call('POST', '/auth/login', { email: 'owner@shop.test', password: PASSWORD });
      expect(login.body.user).toMatchObject({ subscriptionTier: 'PRO', subscriptionStatus: 'ACTIVE' });
    } finally {
      await sup.stop();
    }

    const again = new Supervisor(opts());
    await again.start();
    try {
      owner = await signIn();
      const st = await call('GET', '/license/status', undefined, owner);
      expect(st.body).toMatchObject({ state: 'ACTIVE', tier: 'PRO', keyHint: expect.stringContaining('1e2f') });
    } finally {
      await again.stop();
    }
  });

  it('a refused renewal keeps the licence and says why', async () => {
    const sup = new Supervisor(opts());
    await sup.start();
    try {
      owner = await signIn();
      mode = 'REVOKED';
      const r = await call('POST', '/license/renew', {}, owner);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ state: 'ACTIVE', tier: 'PRO', serverStatus: 'REVOKED', serverMessage: expect.stringContaining('revoked') });
    } finally {
      mode = 'OK';
      await sup.stop();
    }
  });

  it('activating needs a signed-in user', async () => {
    const sup = new Supervisor(opts());
    await sup.start();
    try {
      const none = await call('POST', '/license/activate', { key: KEY });
      expect(none.status).toBe(401);
    } finally {
      await sup.stop();
    }
  });
});
