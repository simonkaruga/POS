/**
 * The whole local server on real software: a real PostgreSQL, the real API, real backups.
 *
 * Needs the PostgreSQL programs, so it SKIPS itself unless FAIDA_PG_BIN points at a folder holding initdb, pg_ctl,
 * postgres, pg_dump and pg_restore (and FAIDA_PG_LIB at their libraries where they are not alongside). It also needs the
 * API built (apps/api/dist) and Prisma installed, as in CI. It never touches your real data: everything runs in a
 * temporary folder on free ports.
 */
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { backupFileName, BackupReason, listBackups } from '../src/backup';
import { findFreePort, isPortFree } from '../src/ports';
import { Supervisor, SupervisorOptions } from '../src/supervisor';
import { checkHealth } from '../src/api';

/** A password made fresh for each run: no password is written into a file, test files included. */
const PASSWORD = `Aa1-${randomBytes(12).toString('hex')}`;
/** This API answers a successful POST /auth/login with 201 (Nest's default for POST). */
const LOGIN_OK = 201;
const PG_BIN = process.env.FAIDA_PG_BIN;
const REPO = path.resolve(__dirname, '..', '..', '..');
const API_MAIN = path.join(REPO, 'apps', 'api', 'dist', 'main.js');
const PRISMA_CLI = path.join(REPO, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = path.join(REPO, 'prisma', 'schema.prisma');
const ready = !!PG_BIN && fs.existsSync(API_MAIN) && fs.existsSync(PRISMA_CLI);
const maybe = ready ? describe : describe.skip;

maybe('local server, end to end', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faida-it-'));
  let apiPort = 0;
  let pgPort = 0;
  const opts = (version: string): SupervisorOptions => ({
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
    appVersion: version,
    platform: process.platform as 'linux',
  });
  const api = (p: string) => `http://127.0.0.1:${apiPort}/api/v1${p}`;
  const post = (p: string, body: unknown) =>
    fetch(api(p), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://tauri.localhost' }, body: JSON.stringify(body) });
  const register = (email: string) => post('/auth/register', { name: 'Owner', email, password: PASSWORD, businessName: `Shop ${email}` });
  const login = async (email: string) => (await post('/auth/login', { email, password: PASSWORD })).status;

  beforeAll(async () => {
    pgPort = await findFreePort(54400);
    apiPort = await findFreePort(3400);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('first run creates the database, migrates, starts the API, and answers browsers from the desktop app', async () => {
    const sup = new Supervisor(opts('1.0.0'));
    await sup.start();
    try {
      expect(sup.status().phase).toBe('running');
      expect(await checkHealth(apiPort)).toBe(true);
      expect((await register('first@shop.test')).status).toBe(201);
      const pre = await fetch(api('/auth/login'), { method: 'OPTIONS', headers: { Origin: 'http://tauri.localhost', 'Access-Control-Request-Method': 'POST' } });
      expect(pre.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
      // With LAN off the API must refuse connections arriving on a non-loopback address.
      const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
      if (lan) {
        const reachable = await fetch(`http://${lan.address}:${apiPort}/api/v1/health`).then(() => true, () => false);
        expect(reachable).toBe(false);
      }
      // server.json holds the secrets; they never change.
      const cfg = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8'));
      expect(cfg.encryptionKey).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await sup.stop();
    }
    expect(await isPortFree(apiPort)).toBe(true);
    expect(await isPortFree(pgPort)).toBe(true);
  });

  it('backs up and restores: data made after the backup is gone, data from before it is back', async () => {
    const sup = new Supervisor(opts('1.0.0'));
    await sup.start();
    try {
      expect(await login('first@shop.test')).toBe(LOGIN_OK); // survived a full stop and start
      const backup = await sup.backupNow('manual');
      expect(fs.existsSync(backup.file)).toBe(true);
      expect(backup.bytes).toBeGreaterThan(10000);

      expect((await register('second@shop.test')).status).toBe(201);
      expect(await login('second@shop.test')).toBe(LOGIN_OK);

      await sup.restore(backup.file);
      expect(sup.status().phase).toBe('running');
      expect(await login('first@shop.test')).toBe(LOGIN_OK);
      expect(await login('second@shop.test')).toBe(401); // not in the backup, so gone after the restore
      // The restore first saved the data it was about to replace.
      expect(listBackups(path.join(root, 'backups')).some((b) => b.reason === 'pre-restore')).toBe(true);
    } finally {
      await sup.stop();
    }
  });

  it('an app update saves a safety backup first, then keeps working', async () => {
    const sup = new Supervisor(opts('1.0.1'));
    await sup.start();
    try {
      expect(listBackups(path.join(root, 'backups')).some((b) => b.reason === 'pre-upgrade')).toBe(true);
      expect(await login('first@shop.test')).toBe(LOGIN_OK);
    } finally {
      // A backup was made minutes ago (the safety copy), so closing the app does not pile up another one.
      await sup.stop({ backup: true });
    }
    expect(listBackups(path.join(root, 'backups')).some((b) => b.reason === 'on-close')).toBe(false);
  });

  it('closing the app takes a backup when the newest one is more than an hour old', async () => {
    const dir = path.join(root, 'backups');
    // Age every backup by three days.
    for (const b of listBackups(dir)) {
      const older = new Date(b.createdAt.getTime() - 3 * 24 * 60 * 60 * 1000);
      fs.renameSync(b.file, path.join(dir, backupFileName(older, b.reason as BackupReason)));
    }
    const sup = new Supervisor(opts('1.0.1'));
    await sup.start();
    await sup.stop({ backup: true });
    const onClose = listBackups(dir).filter((b) => b.reason === 'on-close');
    expect(onClose).toHaveLength(1);
    expect(onClose[0].bytes).toBeGreaterThan(10000);
  });

  it('a change made in the app (network access, backup folder) takes effect on the next start', async () => {
    const moved = path.join(root, 'backups-moved');
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    const onLan = (port: number) => (lan ? fetch(`http://${lan.address}:${port}/api/v1/health`).then((r) => r.ok, () => false) : Promise.resolve(true));

    const on = new Supervisor({ ...opts('1.0.1'), lanEnabled: true, backupDir: moved });
    await on.start();
    try {
      expect(on.status().lanEnabled).toBe(true);
      const saved = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8'));
      expect(saved.lanEnabled).toBe(true);
      expect(saved.backupDir).toBe(moved);
      expect((await on.backupNow('manual')).file.startsWith(moved)).toBe(true);
      expect(await onLan(apiPort)).toBe(true); // other computers can now connect
    } finally {
      await on.stop();
    }

    const off = new Supervisor({ ...opts('1.0.1'), lanEnabled: false });
    await off.start();
    try {
      expect(off.status().lanEnabled).toBe(false);
      expect(lan ? await onLan(apiPort) : false).toBe(false); // and now they cannot
      expect(await login('first@shop.test')).toBe(LOGIN_OK); // same data throughout
    } finally {
      await off.stop();
    }
  });

  it('refuses an unsafe new backup folder instead of silently switching to it', async () => {
    const sup = new Supervisor({ ...opts('1.0.1'), backupDir: path.join(root, 'pgdata', 'backups') });
    await expect(sup.start()).rejects.toThrow(/inside the database folder/i);
    expect(await isPortFree(apiPort)).toBe(true); // nothing was left running
  });

  it('survives a power cut: the database is killed without warning and the next start recovers by itself', async () => {
    const sup = new Supervisor(opts('1.0.1'));
    await sup.start();
    const pid = Number(fs.readFileSync(path.join(root, 'pgdata', 'postmaster.pid'), 'utf8').split(/\r?\n/)[0]);
    process.kill(pid, 'SIGKILL');
    await sup.stop().catch(() => undefined); // tidy the API child the crash left behind
    expect(fs.existsSync(path.join(root, 'pgdata', 'postmaster.pid'))).toBe(true); // stale, as after a real power cut

    const again = new Supervisor(opts('1.0.1'));
    await again.start();
    try {
      expect(await login('first@shop.test')).toBe(LOGIN_OK);
    } finally {
      await again.stop();
    }
  });

  // The built program (dist/cli.js) is what the desktop app launches; these tests drive it the way the app does.
  const CLI = path.join(REPO, 'packages', 'local-server', 'dist', 'cli.js');
  const cliTests = fs.existsSync(CLI) ? it : it.skip;

  function launchCli(dir: string, pg: number, api: number): { child: ChildProcess; running: Promise<void> } {
    const args = ['run', '--root', dir, '--backup-dir', path.join(dir, 'bk'), '--pg-bin', PG_BIN as string, '--api-main', API_MAIN,
      '--prisma-cli', PRISMA_CLI, '--schema', SCHEMA, '--app-version', '1.0.0', '--pg-port', String(pg), '--api-port', String(api)];
    if (process.env.FAIDA_PG_LIB) args.push('--pg-lib', process.env.FAIDA_PG_LIB);
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const running = new Promise<void>((resolve, reject) => {
      child.stdout!.on('data', (d) => {
        buf += d;
        if (buf.includes('"phase":"running"')) resolve();
        if (buf.includes('"type":"error"')) reject(new Error(buf.slice(-300)));
      });
      child.on('exit', () => reject(new Error('program exited before it was running')));
    });
    return { child, running };
  }
  const waitFree = async (port: number, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await isPortFree(port)) return true; await new Promise((r) => setTimeout(r, 300)); }
    return false;
  };

  cliTests('when the desktop app dies abruptly (its pipes break), the server stops by itself and leaves nothing running', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faida-it-crash-'));
    const pg = await findFreePort(54600);
    const api = await findFreePort(3600);
    const { child, running } = launchCli(dir, pg, api);
    await running;
    expect(await isPortFree(api)).toBe(false);
    // The app is gone: both ends of the pipe break at once, with no "stop" command sent.
    child.stdout!.destroy();
    child.stdin!.destroy();
    expect(await waitFree(api, 90000)).toBe(true);
    expect(await waitFree(pg, 60000)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  cliTests('after the server program is KILLED outright, the next start reclaims the leftover and works, with the data intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faida-it-kill-'));
    const pg = await findFreePort(54620);
    const api = await findFreePort(3620);
    const { child, running } = launchCli(dir, pg, api);
    await running;
    const reg = await fetch(`http://127.0.0.1:${api}/api/v1/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://tauri.localhost' },
      body: JSON.stringify({ name: 'Owner', email: 'killed@shop.test', password: PASSWORD, businessName: 'Killed Shop' }),
    });
    expect(reg.status).toBe(201);

    child.kill('SIGKILL'); // no chance to clean up, like a power cut taking the program but not the background processes
    await new Promise((r) => child.on('exit', r));
    // On Linux the API keeps running with nobody to stop it (an orphan); on Windows it went down with its parent. Either way
    // the next start must work, which is what this test is about. Say which happened, for whoever reads the log.
    const orphaned = !(await isPortFree(api));
    console.log(orphaned ? 'the API survived its parent (orphaned): the next start must reclaim it' : 'the API went down with its parent: nothing to reclaim');

    const again = new Supervisor({
      ...opts('1.0.0'), configFile: path.join(dir, 'server.json'), logDir: path.join(dir, 'logs'), pgDataDir: path.join(dir, 'pgdata'),
      backupDir: path.join(dir, 'bk'), pgPort: pg, apiPort: api,
    });
    await again.start();
    try {
      expect(again.status().phase).toBe('running');
      const res = await fetch(`http://127.0.0.1:${api}/api/v1/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://tauri.localhost' },
        body: JSON.stringify({ email: 'killed@shop.test', password: PASSWORD }),
      });
      expect(res.status).toBe(LOGIN_OK); // the account made before the kill is still there
    } finally {
      await again.stop();
    }
    expect(await isPortFree(api)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to create a database in a folder that already holds someone\'s files, and leaves them alone', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'faida-it-full-'));
    const keep = path.join(other, 'pgdata');
    fs.mkdirSync(keep);
    fs.writeFileSync(path.join(keep, 'invoice.pdf'), 'precious');
    const sup = new Supervisor({ ...opts('1.0.0'), configFile: path.join(other, 'server.json'), logDir: path.join(other, 'logs'), pgDataDir: keep, backupDir: path.join(other, 'bk') });
    await expect(sup.start()).rejects.toThrow(/not empty/i);
    expect(fs.readFileSync(path.join(keep, 'invoice.pdf'), 'utf8')).toBe('precious');
    fs.rmSync(other, { recursive: true, force: true });
  });
});
