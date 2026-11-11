/**
 * Updating the app, on real software: a real PostgreSQL and the real API, with a shop's data already in the database.
 *
 * Skips itself unless FAIDA_PG_BIN is set and the API is built (see supervisor.integration.test.ts). It proves the part of
 * an app update that can lose a shop's records: the first start of a new version saves a safety backup, applies the new
 * database changes, and keeps every record; and when a database change FAILS the data is put back exactly as it was, so
 * the shop is never left with a half-updated database. Everything runs in a temporary folder on free ports.
 */
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { backupFileName, BackupReason, listBackups } from '../src/backup';
import { isPortFree, findFreePort } from '../src/ports';
import { Supervisor, SupervisorOptions } from '../src/supervisor';

const PASSWORD = `Aa1-${randomBytes(12).toString('hex')}`;
const PG_BIN = process.env.FAIDA_PG_BIN;
const REPO = path.resolve(__dirname, '..', '..', '..');
const API_MAIN = path.join(REPO, 'apps', 'api', 'dist', 'main.js');
const PRISMA_CLI = path.join(REPO, 'node_modules', 'prisma', 'build', 'index.js');
const ready = !!PG_BIN && fs.existsSync(API_MAIN) && fs.existsSync(PRISMA_CLI);
const maybe = ready ? describe : describe.skip;

maybe('updating the app keeps the shop data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faida-upd-'));
  let apiPort = 0;
  let pgPort = 0;

  /** A copy of the real prisma folder (schema + all real migrations) with extra migrations added: the "next release". */
  function release(name: string, extra: Record<string, string>): string {
    const dir = path.join(root, name);
    fs.cpSync(path.join(REPO, 'prisma'), dir, { recursive: true });
    for (const [migration, sql] of Object.entries(extra)) {
      fs.mkdirSync(path.join(dir, 'migrations', migration));
      fs.writeFileSync(path.join(dir, 'migrations', migration, 'migration.sql'), sql);
    }
    return path.join(dir, 'schema.prisma');
  }

  const ADD_NOTE = {
    '20261201000000_update_test_note': `
      ALTER TABLE "User" ADD COLUMN "updateTestNote" TEXT;
      UPDATE "User" SET "updateTestNote" = 'backfilled by the update';
      CREATE TABLE "UpdateTestThing" ("id" TEXT PRIMARY KEY, "label" TEXT NOT NULL);`,
  };
  const ADD_SECOND = { '20261201000100_update_test_second': `ALTER TABLE "User" ADD COLUMN "updateTestSecond" TEXT;` };
  const BROKEN = { '20261201000200_update_test_broken': `ALTER TABLE "NoSuchTable" ADD COLUMN "x" INTEGER;` };

  const opts = (version: string, schemaPath: string): SupervisorOptions => ({
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
    schemaPath,
    appVersion: version,
    platform: process.platform as 'linux',
  });

  const api = (p: string) => `http://127.0.0.1:${apiPort}/api/v1${p}`;
  const post = (p: string, body: unknown) =>
    fetch(api(p), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://tauri.localhost' }, body: JSON.stringify(body) });
  const register = (email: string) => post('/auth/register', { name: 'Owner', email, password: PASSWORD, businessName: `Shop ${email}` });
  const login = async (email: string) => (await post('/auth/login', { email, password: PASSWORD })).status;

  /** Ask the live database a question (the server must be running). */
  const sql = (query: string): string => {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8'));
    return execFileSync(path.join(PG_BIN as string, 'psql'), ['-h', '127.0.0.1', '-p', String(pgPort), '-U', cfg.dbUser, '-d', cfg.dbName, '-tAc', query], {
      env: { ...process.env, PGPASSWORD: cfg.dbPassword },
    })
      .toString()
      .trim();
  };
  const preUpgrades = () => listBackups(path.join(root, 'backups')).filter((b) => b.reason === 'pre-upgrade');

  const v1 = path.join(REPO, 'prisma', 'schema.prisma');
  let users = '';

  beforeAll(async () => {
    pgPort = await findFreePort(54700);
    apiPort = await findFreePort(3700);
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('the shop starts on version 1 and records some data', async () => {
    const sup = new Supervisor(opts('1.0.0', v1));
    await sup.start();
    try {
      expect((await register('owner@shop.test')).status).toBe(201);
      expect((await register('other@shop.test')).status).toBe(201);
      users = sql('SELECT count(*) FROM "User"');
      expect(Number(users)).toBeGreaterThanOrEqual(2);
    } finally {
      await sup.stop();
    }
    expect(preUpgrades()).toHaveLength(0); // a first install has nothing to protect
  });

  it('version 2 saves a safety backup, applies its database changes and keeps every record', async () => {
    const v2 = release('v2', ADD_NOTE);
    const sup = new Supervisor(opts('2.0.0', v2));
    await sup.start();
    try {
      expect(sup.status().phase).toBe('running');
      expect(preUpgrades()).toHaveLength(1);
      expect(preUpgrades()[0].bytes).toBeGreaterThan(10000);
      expect(sql('SELECT count(*) FROM "User"')).toBe(users); // nothing lost
      expect(sql('SELECT count(*) FROM "User" WHERE "updateTestNote" = \'backfilled by the update\'')).toBe(users); // new column filled
      expect(sql('SELECT count(*) FROM "UpdateTestThing"')).toBe('0'); // new table exists
      expect(await login('owner@shop.test')).toBe(201);
      expect(JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8')).lastRunVersion).toBe('2.0.0');
    } finally {
      await sup.stop();
    }
  });

  it('a start on the same version takes no new safety backup when nothing changed', async () => {
    const v2 = release('v2-again', ADD_NOTE);
    const sup = new Supervisor(opts('2.0.0', v2));
    await sup.start();
    await sup.stop();
    expect(preUpgrades()).toHaveLength(1);
  });

  it('a database change waiting on an UNCHANGED version number still gets a safety backup', async () => {
    const v2b = release('v2b', { ...ADD_NOTE, ...ADD_SECOND });
    const sup = new Supervisor(opts('2.0.0', v2b));
    await sup.start();
    try {
      expect(preUpgrades()).toHaveLength(2);
      expect(sql('SELECT count(*) FROM information_schema.columns WHERE column_name = \'updateTestSecond\'')).toBe('1');
    } finally {
      await sup.stop();
    }
  });

  it('a database change that fails puts the data back exactly as it was and says so', async () => {
    // One good change (applied first, then undone by the put-back) followed by one that cannot work.
    const bad = release('v3-bad', {
      ...ADD_NOTE,
      ...ADD_SECOND,
      '20261201000150_update_test_third': `ALTER TABLE "User" ADD COLUMN "updateTestThird" TEXT;`,
      ...BROKEN,
    });
    const sup = new Supervisor(opts('3.0.0', bad));
    const failure = await sup.start().then(() => null, (e: Error) => e);
    expect(failure).not.toBeNull();
    expect(failure!.message).toMatch(/put back exactly as it was before/i);
    expect(sup.status().phase).toBe('error');
    expect(preUpgrades()).toHaveLength(3);
    expect(await isPortFree(apiPort)).toBe(true); // nothing left running
    expect(await isPortFree(pgPort)).toBe(true);

    // The version was not recorded, and the data is the version-2 data, with none of the half-applied changes.
    expect(JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8')).lastRunVersion).toBe('2.0.0');
    const v2b = release('v2b-check', { ...ADD_NOTE, ...ADD_SECOND });
    const back = new Supervisor(opts('2.0.0', v2b));
    await back.start();
    try {
      expect(sql('SELECT count(*) FROM "User"')).toBe(users);
      expect(sql('SELECT count(*) FROM information_schema.columns WHERE column_name = \'updateTestThird\'')).toBe('0');
      expect(sql('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL')).toBe('0'); // no failed change left to block Prisma
      expect(await login('owner@shop.test')).toBe(201);
    } finally {
      await back.stop();
    }
  });

  it('once the broken change is fixed in a later version, the update goes through', async () => {
    const fixed = release('v3-fixed', {
      ...ADD_NOTE,
      ...ADD_SECOND,
      '20261201000150_update_test_third': `ALTER TABLE "User" ADD COLUMN "updateTestThird" TEXT;`,
    });
    const sup = new Supervisor(opts('3.0.1', fixed));
    await sup.start();
    try {
      expect(sup.status().phase).toBe('running');
      expect(sql('SELECT count(*) FROM information_schema.columns WHERE column_name = \'updateTestThird\'')).toBe('1');
      expect(sql('SELECT count(*) FROM "User"')).toBe(users);
      expect(await login('other@shop.test')).toBe(201);
    } finally {
      await sup.stop();
    }
  });

  it('takes the daily backup once the day has changed, and only once a day', async () => {
    const dir = path.join(root, 'backups');
    // Pretend every backup so far was made two days ago, as after a closed weekend.
    for (const b of listBackups(dir)) {
      const older = new Date(b.createdAt.getTime() - 2 * 24 * 60 * 60 * 1000);
      fs.renameSync(b.file, path.join(dir, backupFileName(older, b.reason as BackupReason)));
    }
    const sup = new Supervisor(opts('3.0.1', path.join(root, 'v3-fixed', 'schema.prisma')));
    await sup.start();
    try {
      const before = listBackups(dir).length;
      expect(await sup.checkDailyBackup()).toBe(true); // nothing since this midnight: take it now
      expect(listBackups(dir).length).toBe(before + 1);
      expect(listBackups(dir)[0].reason).toBe('auto');
      expect(await sup.checkDailyBackup()).toBe(false); // today's is done
      expect(await sup.checkDailyBackup(new Date(Date.now() + 25 * 60 * 60 * 1000))).toBe(true); // the next day: due again
    } finally {
      await sup.stop();
    }
  });
});
