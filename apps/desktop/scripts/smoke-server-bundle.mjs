#!/usr/bin/env node
/**
 * Proves an assembled server bundle works on its own, the way the desktop app runs it: the bundled Node starts the
 * server program, which creates a real database, migrates it, starts the real API, and answers; then a business is
 * registered, a backup is taken and verified, and closing the pipe stops everything with nothing left running.
 *
 *   node apps/desktop/scripts/smoke-server-bundle.mjs [--bundle DIR] [--in-place]
 *
 * By default the bundle is first COPIED to a temporary folder outside the repository. Run in place inside the repo, Node
 * would find the repo's node_modules for anything the bundle forgot, and the test would pass while the installed app fails.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const windows = process.platform === 'win32';
const SOURCE = path.resolve(args.bundle ?? path.join(HERE, '..', 'src-tauri', 'resources', 'server'));
const exe = (n) => (windows ? `${n}.exe` : n);
// A password made fresh for each run: no password is ever written into a file, test files included.
const PASSWORD = `Aa1-${randomBytes(12).toString('hex')}`;
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };

const freePort = (start) => new Promise((resolve) => {
  const t = (p) => { const s = net.createServer(); s.once('error', () => t(p + 1)); s.once('listening', () => s.close(() => resolve(p))); s.listen(p, '127.0.0.1'); };
  t(start);
});
const isFree = (port) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.once('listening', () => s.close(() => resolve(true))); s.listen(port, '127.0.0.1'); });
const waitFree = async (port, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await isFree(port)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };

if (!fs.existsSync(path.join(SOURCE, 'local-server', 'dist', 'cli.js'))) {
  console.error(`No bundle at ${SOURCE}. Build one with build-server-bundle.mjs.`);
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'faida-smoke-'));
const bundle = args['in-place'] ? SOURCE : path.join(work, 'server');
if (!args['in-place']) {
  console.log(`copying the bundle to ${bundle} (outside the repository) ...`);
  fs.cpSync(SOURCE, bundle, { recursive: true, dereference: true });
}
const root = path.join(work, 'data');
const backups = path.join(work, 'backups');
const pgPort = await freePort(54700);
const apiPort = await freePort(3700);
const lib = path.join(bundle, 'postgres', 'lib');

const cliArgs = [
  path.join(bundle, 'local-server', 'dist', 'cli.js'), 'run',
  '--root', root, '--backup-dir', backups,
  '--pg-bin', path.join(bundle, 'postgres', 'bin'),
  ...(!windows && fs.existsSync(lib) ? ['--pg-lib', lib] : []),
  '--api-main', path.join(bundle, 'api', 'dist', 'main.js'),
  '--prisma-cli', path.join(bundle, 'node_modules', 'prisma', 'build', 'index.js'),
  '--schema', path.join(bundle, 'prisma', 'schema.prisma'),
  '--node', path.join(bundle, 'node', exe('node')),
  '--app-version', 'smoke', '--pg-port', String(pgPort), '--api-port', String(apiPort),
];

console.log(`starting the server with the bundled Node (ports ${pgPort}/${apiPort}) ...`);
const child = spawn(path.join(bundle, 'node', exe('node')), cliArgs, { cwd: work, stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
let err = '';
let pending = new Map();
let nextId = 1;
let buf = '';
child.stdout.on('data', (d) => {
  buf += d; out += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(line); if (m.type === 'result' && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch { /* not JSON */ }
  }
});
child.stderr.on('data', (d) => { err += d; });
const exited = new Promise((r) => child.on('exit', (code) => r(code)));
const request = (cmd) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, resolve);
  child.stdin.write(JSON.stringify({ id, cmd }) + '\n');
  setTimeout(() => reject(new Error(`${cmd} timed out`)), 120000);
});

function dumpLogs() {
  console.log('\n--- program output (last lines) ---');
  console.log(out.trim().split('\n').slice(-6).join('\n'));
  if (err.trim()) console.log('--- stderr ---\n' + err.trim().split('\n').slice(-10).join('\n'));
  for (const f of ['api.log', 'postgres.log']) {
    const p = path.join(root, 'logs', f);
    if (fs.existsSync(p)) console.log(`--- ${f} (last lines) ---\n` + fs.readFileSync(p, 'utf8').trim().split('\n').slice(-12).join('\n'));
  }
}

try {
  // 1. up and running
  const end = Date.now() + 300000;
  let state = '';
  while (Date.now() < end) {
    if (out.includes('"phase":"running"')) { state = 'running'; break; }
    if (out.includes('"type":"error"') || out.includes('"phase":"error"')) { state = 'error'; break; }
    if (child.exitCode !== null) { state = 'exited'; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  check('the server starts from the bundle alone (database created, migrations applied, API up)', state === 'running', state === 'running' ? '' : `(${state})`);
  if (state !== 'running') throw new Error('did not start');

  // 2. it really answers, from a browser origin the desktop app uses
  const health = await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`).then((r) => r.ok, () => false);
  check('the API answers its health check', health);
  const post = (p, body) => fetch(`http://127.0.0.1:${apiPort}/api/v1${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://tauri.localhost' }, body: JSON.stringify(body) });
  const reg = await post('/auth/register', { name: 'Smoke Owner', email: 'smoke@faida-test.invalid', password: PASSWORD, businessName: 'Smoke Shop' });
  check('a business can be registered (the encryption key, database and API all work together)', reg.status === 201, `(${reg.status})`);
  const login = await post('/auth/login', { email: 'smoke@faida-test.invalid', password: PASSWORD });
  check('and the owner can sign in', login.status === 201, `(${login.status})`);

  // 3. a backup that verifies
  const backup = await request('backup');
  check('a backup is made and verified with the bundled pg_dump / pg_restore', backup.ok === true && backup.data?.bytes > 10000, backup.ok ? `(${backup.data?.bytes} bytes)` : `(${backup.error})`);
  check('the backup file is in the backup folder', fs.existsSync(backups) && fs.readdirSync(backups).some((f) => f.endsWith('.kbk')));

  // 4. clean stop: closing the pipe, as when the app closes
  child.stdin.end();
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 120000))]);
  check('closing the app stops the server program cleanly', code === 0, `(exit ${code})`);
  check('the API is no longer running', await waitFree(apiPort, 30000));
  check('the database is no longer running', await waitFree(pgPort, 30000));
} catch (e) {
  check('smoke test ran to the end', false, String(e.message ?? e));
  dumpLogs();
} finally {
  if (child.exitCode === null) { try { child.stdin.end(); } catch { /* closed */ } await Promise.race([exited, new Promise((r) => setTimeout(r, 60000))]); }
  if (child.exitCode === null) child.kill('SIGKILL');
  if (!args.keep) fs.rmSync(work, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nthe bundle works');
process.exit(failures ? 1 : 0);
