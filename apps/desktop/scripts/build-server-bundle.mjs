#!/usr/bin/env node
/**
 * Assembles the folder the desktop installer ships as `<resources>/server`, in the layout apps/desktop/src-tauri/src/
 * local_server_core.rs (ServerPaths::from_server_dir) expects:
 *
 *   node/node(.exe)             Node, downloaded and checked against a pinned hash
 *   local-server/dist/          packages/local-server, built
 *   api/dist/                   apps/api, built
 *   node_modules/               exactly the packages the API (and Prisma) need at run time, copied from the repo's own
 *                               install so they are the versions that were tested, native parts included
 *   prisma/                     schema.prisma and migrations/
 *   postgres/{bin,lib,share}    PostgreSQL, trimmed to what Faida uses
 *
 * Run it on the machine type you are building FOR (Windows for the Windows installer): the packages copied include native
 * parts (bcrypt, Prisma's engines) that exist only for the platform that ran `npm ci`.
 *
 *   node apps/desktop/scripts/build-server-bundle.mjs [--out DIR] [--cache DIR] [--no-archive]
 *
 * The result: the folder above, and `server.tar.gz` beside it (src-tauri/resources/), which is what the installer carries.
 *
 * Development helpers (never used for a release):
 *   --platform win32|linux   default: this machine. `win32` on another OS only assembles the layout (--allow-cross).
 *   --node PATH              use this Node instead of downloading one
 *   --pg-dir DIR             a PostgreSQL install holding bin/ lib/ share/, instead of downloading
 *   --pg-extra-bin A,B       extra programs to copy into postgres/bin (for example pg_dump, pg_restore)
 *
 * Licensing: the app checks paid plans against a PUBLIC key that this script writes to `license-public-key.pem` in the bundle.
 * Give it as the environment variable LICENSE_PUBLIC_KEY (PEM, or the PEM in base64) or as --license-public-key FILE. A
 * release without it could never activate a paid plan, so the build FAILS unless you say --allow-unlicensed (tests, CI checks).
 * Make the key pair with apps/api/scripts/generate-license-keys.mjs; the private half never comes near this script.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, '..');
const REPO = path.resolve(DESKTOP, '..', '..');
const MARKER = '.faida-server-bundle';

// ───────────────────────── arguments ─────────────────────────

const args = (() => {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const next = a[i + 1];
    if (next === undefined || next.startsWith('--')) out[a[i].slice(2)] = true;
    else { out[a[i].slice(2)] = next; i++; }
  }
  return out;
})();

const platform = args.platform ?? process.platform;
if (platform !== 'win32' && platform !== 'linux') die(`Unsupported --platform ${platform}`);
const windows = platform === 'win32';
const cross = platform !== process.platform;
if (cross && !args['allow-cross']) {
  die(`This machine is ${process.platform}, so it cannot build a working ${platform} bundle: the packages copied include native parts for the machine that installed them. Build on ${platform}. (--allow-cross assembles the layout only, for checking.)`);
}
const OUT = path.resolve(args.out ?? path.join(DESKTOP, 'src-tauri', 'resources', 'server'));
const CACHE = path.resolve(args.cache ?? path.join(DESKTOP, '.cache', 'server-bundle'));
const pins = JSON.parse(fs.readFileSync(path.join(HERE, 'server-bundle.pins.json'), 'utf8'));

function die(msg) {
  console.error(`\nbuild-server-bundle: ${msg}`);
  process.exit(1);
}
const log = (m) => console.log(`==> ${m}`);

// ───────────────────────── small helpers ─────────────────────────

const exeName = (n) => (windows ? `${n}.exe` : n);

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects) => https.get(u, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume();
        return get(new URL(res.headers.location, u).toString(), redirects + 1);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${u} answered ${res.statusCode}`)); }
      const tmp = `${dest}.part`;
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => { fs.renameSync(tmp, dest); resolve(); }));
      file.on('error', reject);
    }).on('error', reject);
    get(url, 0);
  });
}

/** A download, kept in the cache, whose hash must match the pin. A file with the wrong hash is never used. */
async function pinned(entry) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, entry.file);
  if (!fs.existsSync(file)) {
    log(`downloading ${entry.url}`);
    await download(entry.url, file);
  }
  const got = sha256(file);
  if (got !== entry.sha256) {
    fs.rmSync(file, { force: true });
    die(`${entry.file} does not match its pinned hash.\n  expected ${entry.sha256}\n  got      ${got}\nThe file was deleted. If the upgrade is deliberate, update server-bundle.pins.json.`);
  }
  return file;
}

/**
 * The tar to use. On Windows it is the bsdtar that ships with Windows 10 and later, by its FULL path: a GNU tar from Git for
 * Windows is often first on the PATH, and it reads `C:\\...` as a network host and fails.
 */
function tarProgram() {
  return process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
}

/** Extract chosen folders/files from a zip: bsdtar on Windows (it reads zip files), unzip elsewhere. */
function extractZip(zip, dest, members) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync(tarProgram(), ['-xf', zip, '-C', dest, ...members.map((m) => m.replace(/\/$/, ''))], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', '-o', zip, ...members.map((m) => (m.endsWith('/') ? `${m}*` : m)), '-d', dest], { stdio: 'inherit' });
  }
}

function copyDir(src, dest, filter) {
  fs.cpSync(src, dest, { recursive: true, dereference: true, filter });
}

function walk(dir, visit) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, visit);
    else visit(p, e);
  }
}

function countAndSize(dir) {
  let files = 0;
  let bytes = 0;
  walk(dir, (p) => { files++; bytes += fs.statSync(p).size; });
  return { files, mb: Math.round(bytes / 1e6) };
}

/** Delete only a folder this script made before (it carries the marker), or one that does not exist. Never anything else. */
function resetOut() {
  if (fs.existsSync(OUT)) {
    const entries = fs.readdirSync(OUT).filter((n) => n !== 'README.md');
    if (entries.length > 0 && !entries.includes(MARKER)) {
      die(`${OUT} has files that this script did not make. Refusing to delete them. Choose an empty --out folder.`);
    }
    for (const n of entries) fs.rmSync(path.join(OUT, n), { recursive: true, force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, MARKER), 'Generated by apps/desktop/scripts/build-server-bundle.mjs. Safe to delete and rebuild.\n');
}

// ───────────────────────── pieces ─────────────────────────

function copyOwnCode() {
  log('API and server program');
  for (const [from, to] of [
    [path.join(REPO, 'apps', 'api', 'dist'), path.join(OUT, 'api', 'dist')],
    [path.join(REPO, 'packages', 'local-server', 'dist'), path.join(OUT, 'local-server', 'dist')],
  ]) {
    if (!fs.existsSync(from)) die(`${from} is missing. Build it first (npm run build in that folder).`);
    copyDir(from, to, (s) => !s.endsWith('.map'));
  }
  fs.copyFileSync(path.join(REPO, 'packages', 'local-server', 'package.json'), path.join(OUT, 'local-server', 'package.json'));

  log('database schema and migrations');
  const prismaOut = path.join(OUT, 'prisma');
  fs.mkdirSync(prismaOut, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'prisma', 'schema.prisma'), path.join(prismaOut, 'schema.prisma'));
  copyDir(path.join(REPO, 'prisma', 'migrations'), path.join(prismaOut, 'migrations'));
}

const SKIP_DIRS_AT_ROOT = new Set(['test', 'tests', '__tests__', 'docs', 'doc', 'example', 'examples', '.github', 'benchmark', 'benchmarks', 'coverage']);

function pruneFilter(pkgRoot) {
  return (src) => {
    const rel = path.relative(pkgRoot, src);
    if (!rel) return true;
    const first = rel.split(path.sep)[0];
    if (SKIP_DIRS_AT_ROOT.has(first)) return false;
    const base = path.basename(src);
    if (/\.(map|md|markdown|d\.ts|d\.mts|d\.cts)$/i.test(base)) return !/^(license|licence)/i.test(base) ? false : true;
    return true;
  };
}

/** Where a package found in the repo's install belongs inside the bundle (so Node finds it the same way it does here). */
function destFor(real) {
  // The path of `real` inside `root` ('' when it IS root), or null when it is somewhere else.
  const within = (root) => {
    const r = path.relative(root, real);
    return r.startsWith('..') || path.isAbsolute(r) ? null : r;
  };
  let r;
  if ((r = within(path.join(REPO, 'node_modules'))) !== null) return path.join(OUT, 'node_modules', r);
  if ((r = within(path.join(REPO, 'apps', 'api', 'node_modules'))) !== null) return path.join(OUT, 'api', 'node_modules', r);
  if ((r = within(path.join(REPO, 'packages', 'shared'))) !== null) return path.join(OUT, 'node_modules', '@pos', 'shared', r);
  return die(`Do not know where to put ${real}`);
}

function resolveDep(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const cand = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(cand, 'package.json'))) return fs.realpathSync(cand);
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Every package the API and Prisma need at run time: follow dependencies, optional ones that are installed, and required peers. */
function runtimePackages() {
  const apiPkg = JSON.parse(fs.readFileSync(path.join(REPO, 'apps', 'api', 'package.json'), 'utf8'));
  const roots = [
    ...Object.keys(apiPkg.dependencies ?? {}).filter((n) => !n.startsWith('@types/')),
    'prisma',
    '@prisma/client',
  ];
  const seen = new Map(); // real dir -> name
  const queue = roots.map((n) => ({ name: n, from: path.join(REPO, 'apps', 'api') }));
  while (queue.length) {
    const { name, from, optional } = queue.shift();
    const dir = resolveDep(name, from);
    if (!dir) {
      if (optional) continue;
      die(`Cannot find the package "${name}" (needed at run time). Run npm ci first.`);
    }
    if (seen.has(dir)) continue;
    seen.set(dir, name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const n of Object.keys(pkg.dependencies ?? {})) queue.push({ name: n, from: dir });
    for (const n of Object.keys(pkg.optionalDependencies ?? {})) queue.push({ name: n, from: dir, optional: true });
    for (const [n] of Object.entries(pkg.peerDependencies ?? {})) {
      if (pkg.peerDependenciesMeta?.[n]?.optional) continue;
      queue.push({ name: n, from: dir, optional: true });
    }
  }
  return [...seen.keys()];
}

function copyPackages() {
  log('run-time packages (the exact versions installed in this repository)');
  const dirs = runtimePackages();
  for (const dir of dirs) {
    const dest = destFor(dir);
    if (dir === path.join(REPO, 'packages', 'shared')) {
      // The shared package: its manifest and its build, not its sources.
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(path.join(dir, 'package.json'), path.join(dest, 'package.json'));
      copyDir(path.join(dir, 'dist'), path.join(dest, 'dist'), (s) => !s.endsWith('.map'));
      continue;
    }
    copyDir(dir, dest, pruneFilter(dir));
  }
  // Prisma's generated client lives beside the packages, not in one.
  const generated = path.join(REPO, 'node_modules', '.prisma');
  if (!fs.existsSync(path.join(generated, 'client'))) die('Prisma client is not generated. Run: npx prisma generate --schema prisma/schema.prisma');
  copyDir(generated, path.join(OUT, 'node_modules', '.prisma'), (s) => !/\.(map|d\.ts)$/.test(s));
  log(`   ${dirs.length} packages`);
}

async function addNode() {
  log('Node');
  const dest = path.join(OUT, 'node');
  fs.mkdirSync(dest, { recursive: true });
  if (args.node) {
    fs.copyFileSync(path.resolve(args.node), path.join(dest, exeName('node')));
    fs.chmodSync(path.join(dest, exeName('node')), 0o755);
    return;
  }
  if (!windows) die('For Linux pass --node PATH (only Windows downloads Node).');
  const zip = await pinned(pins.node['win32-x64']);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'faida-node-'));
  try {
    const folder = `node-${pins.node.version}-win-x64`;
    extractZip(zip, tmp, [`${folder}/node.exe`, `${folder}/LICENSE`]);
    fs.copyFileSync(path.join(tmp, folder, 'node.exe'), path.join(dest, 'node.exe'));
    fs.copyFileSync(path.join(tmp, folder, 'LICENSE'), path.join(dest, 'LICENSE-node.txt'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The six programs Faida runs, plus two for support. Everything else in bin/ (pgbench, pg_upgrade, ...) is dead weight. */
const PG_PROGRAMS = ['initdb', 'pg_ctl', 'postgres', 'pg_dump', 'pg_restore', 'psql', 'pg_isready', 'pg_controldata'];

async function addPostgres() {
  log('PostgreSQL');
  const dest = path.join(OUT, 'postgres');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'faida-pg-'));
  try {
    let root;
    if (args['pg-dir']) {
      root = path.resolve(args['pg-dir']);
    } else {
      if (!windows) die('For Linux pass --pg-dir DIR (only Windows downloads PostgreSQL).');
      const zip = await pinned(pins.postgres['win32-x64']);
      extractZip(zip, tmp, ['pgsql/bin/', 'pgsql/lib/', 'pgsql/share/', 'pgsql/server_license.txt', 'pgsql/pgAdmin 4/python/vcruntime140.dll', 'pgsql/pgAdmin 4/python/vcruntime140_1.dll']);
      root = path.join(tmp, 'pgsql');
    }

    // bin: the programs we run, plus every DLL they load (not the wxWidgets ones that belong to pgAdmin/StackBuilder).
    const bin = path.join(dest, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const f of fs.readdirSync(path.join(root, 'bin'))) {
      const isProgram = PG_PROGRAMS.some((p) => f === exeName(p));
      const isLib = windows ? /\.dll$/i.test(f) && !/^(wx|testplug)/i.test(f) : false;
      if (isProgram || isLib) fs.copyFileSync(path.join(root, 'bin', f), path.join(bin, f));
    }
    for (const extra of String(args['pg-extra-bin'] ?? '').split(',').filter(Boolean)) {
      fs.copyFileSync(path.resolve(extra), path.join(bin, path.basename(extra)));
    }
    if (windows && !args['pg-dir']) {
      // The Microsoft runtime PostgreSQL's programs need, shipped beside them so the PC does not have to have it installed.
      for (const dll of ['vcruntime140.dll', 'vcruntime140_1.dll']) {
        fs.copyFileSync(path.join(root, 'pgAdmin 4', 'python', dll), path.join(bin, dll));
      }
    }

    // lib: extension libraries only, without the Perl/Python/Tcl languages (they need those installed) or build files.
    if (fs.existsSync(path.join(root, 'lib'))) {
      copyDir(path.join(root, 'lib'), path.join(dest, 'lib'), (s) => {
        if (fs.statSync(s).isDirectory()) return true;
        const b = path.basename(s);
        if (windows) return /\.dll$/i.test(b) && !/(plperl|plpython|pltcl|libecpg|libpgtypes)/i.test(b);
        return !/(plperl|plpython|pltcl)/i.test(b);
      });
    }

    // share: everything the server reads at start (timezones, system catalogs, extensions), without docs and translations.
    copyDir(path.join(root, 'share'), path.join(dest, 'share'), (s) => {
      const rel = path.relative(path.join(root, 'share'), s).split(path.sep)[0];
      return rel !== 'doc' && rel !== 'locale';
    });

    const license = path.join(root, 'server_license.txt');
    if (fs.existsSync(license)) fs.copyFileSync(license, path.join(dest, 'LICENSE-postgresql.txt'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The public key licences are checked against. Validated here, so a mistyped variable fails the build, not the customer's activation. */
function licensePublicKeyPem() {
  const raw = args['license-public-key'] ? fs.readFileSync(path.resolve(String(args['license-public-key'])), 'utf8') : process.env.LICENSE_PUBLIC_KEY;
  if (!raw || !raw.trim()) {
    if (args['allow-unlicensed']) { log('licence public key: none (--allow-unlicensed): this build cannot activate a paid plan'); return null; }
    die('No licence public key. Set LICENSE_PUBLIC_KEY (or pass --license-public-key FILE) so the app can check licences. Make one with apps/api/scripts/generate-license-keys.mjs. For a build that is only being tested, pass --allow-unlicensed.');
  }
  const text = raw.trim();
  const pem = (text.includes('-----BEGIN') ? text.replace(/\\n/g, '\n') : Buffer.from(text, 'base64').toString('utf8')).trim();
  let key;
  try { key = createPublicKey(pem); } catch { die('LICENSE_PUBLIC_KEY is not a valid public key.'); }
  if (key.asymmetricKeyType !== 'ed25519') die(`LICENSE_PUBLIC_KEY must be an Ed25519 key, not ${key.asymmetricKeyType}.`);
  if (/PRIVATE/.test(pem)) die('That is a PRIVATE key. Only the public key goes into the app.');
  return pem;
}

function addLicensePublicKey(pem) {
  if (!pem) return;
  log('licence public key');
  fs.writeFileSync(path.join(OUT, 'license-public-key.pem'), pem + '\n');
}

function verify() {
  log('checking the result');
  const need = [
    path.join('node', exeName('node')),
    path.join('local-server', 'dist', 'cli.js'),
    path.join('api', 'dist', 'main.js'),
    path.join('node_modules', 'prisma', 'build', 'index.js'),
    path.join('node_modules', '@prisma', 'client', 'package.json'),
    path.join('node_modules', '.prisma', 'client', 'index.js'),
    path.join('node_modules', '@pos', 'shared', 'dist', 'index.js'),
    path.join('prisma', 'schema.prisma'),
    ...PG_PROGRAMS.slice(0, 5).map((p) => path.join('postgres', 'bin', exeName(p))),
  ];
  // PostgreSQL's catalog file sits in share/ (Windows) or share/postgresql/ (some other builds).
  const bki = [path.join('postgres', 'share', 'postgres.bki'), path.join('postgres', 'share', 'postgresql', 'postgres.bki')];
  if (!bki.some((n) => fs.existsSync(path.join(OUT, n)))) need.push(bki[0]);
  const missing = need.filter((n) => !fs.existsSync(path.join(OUT, n)));
  if (missing.length) die(`The bundle is incomplete. Missing: ${missing.join(', ')}`);
  // Prisma needs its migration engine and a query engine for THIS platform, or the first start fails far from here.
  const engines = path.join(OUT, 'node_modules', '@prisma', 'engines');
  const hasMigrationEngine = fs.existsSync(engines) && fs.readdirSync(engines).some((f) => f.startsWith('schema-engine'));
  if (!hasMigrationEngine) die('Prisma\'s migration engine (schema-engine) is not in the bundle.');
  const clientDir = path.join(OUT, 'node_modules', '.prisma', 'client');
  if (!fs.readdirSync(clientDir).some((f) => /query_engine|query-engine/.test(f))) die('Prisma\'s query engine is not in the bundle.');
}

/**
 * The whole folder as ONE file, which is what the installer carries (see local_server.rs): about 11,000 small files make a
 * slow, fragile installer, and a file glob can skip folders whose names start with a dot, such as Prisma's `.prisma`.
 * The app unpacks it once per build. tar keeps dot-folders; gzip makes it about a third the size.
 */
function makeArchive() {
  if (args['no-archive']) return null;
  const archive = path.join(path.dirname(OUT), 'server.tar.gz');
  log(`packing ${archive}`);
  fs.rmSync(archive, { force: true });
  execFileSync(tarProgram(), ['-czf', archive, '-C', OUT, '.'], { stdio: 'inherit' });
  return archive;
}

// ───────────────────────── go ─────────────────────────

// Checked before anything is deleted or downloaded, so a missing or mistyped key fails in a second, not after ten minutes.
const licensePem = licensePublicKeyPem();
resetOut();
copyOwnCode();
copyPackages();
await addNode();
await addPostgres();
addLicensePublicKey(licensePem);
verify();

const { files, mb } = countAndSize(OUT);
fs.writeFileSync(path.join(OUT, 'bundle-manifest.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  platform,
  node: args.node ? 'local' : pins.node.version,
  postgres: args['pg-dir'] ? 'local' : pins.postgres.version,
  licensed: fs.existsSync(path.join(OUT, 'license-public-key.pem')),
  files,
  megabytes: mb,
}, null, 2));
const archive = makeArchive();
log(`done: ${OUT}  (${files} files, about ${mb} MB)`);
if (archive) log(`      ${archive}  (${Math.round(fs.statSync(archive).size / 1e6)} MB: this is the file the installer carries)`);
