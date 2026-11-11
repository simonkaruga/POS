#!/usr/bin/env node
/**
 * The program the desktop app launches:
 *
 *   node cli.js defaults                      prints the default folders as one JSON line
 *   node cli.js validate [--data-dir D] [--backup-dir B]   checks folder choices, one JSON line, exit 0
 *   node cli.js run --pg-bin <dir> --api-main <file> --prisma-cli <file> --schema <file> --app-version 1.0.0
 *                   [--root <dir>] [--data-dir <dir>] [--backup-dir <dir>] [--lan true|false]
 *                   [--pg-lib <dir>] [--node <path>] [--pg-port N] [--api-port N] [--extra-origins a,b]
 *                   [--machine-id <id>] [--license-server <url>] [--license-public-key <file>]
 *
 * It prints one JSON object per line on stdout (type: status | log | warning | result) and reads one JSON command per
 * line on stdin: {"id":1,"cmd":"status"|"backups"|"backup"|"restore"|"stop","file":"..."}. When the desktop app closes or crashes,
 * stdin ends and this program stops the API and the database cleanly instead of leaving them running in the background.
 */
import * as fs from 'fs';
import * as readline from 'readline';
import * as os from 'os';
import { loadConfig } from './config';
import { checkFolders } from './folders';
import { defaultDirs, Platform } from './paths';
import { Supervisor } from './supervisor';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = 'true';
      else { out[a.slice(2)] = next; i++; }
    }
  }
  return out;
}

const emit = (obj: Record<string, unknown>) => process.stdout.write(JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n');

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'defaults' || command === 'validate') {
    const a = parseArgs(rest);
    const platform = process.platform as Platform;
    const dirs = defaultDirs(platform, process.env, os.homedir());
    if (command === 'defaults') {
      process.stdout.write(JSON.stringify({ rootDir: dirs.rootDir, dataDir: dirs.pgDataDir, backupDir: dirs.backupDir, platform }) + '\n');
      return;
    }
    const result = checkFolders(a['data-dir'] ?? dirs.pgDataDir, a['backup-dir'] ?? dirs.backupDir, platform, process.env);
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  if (command !== 'run') {
    process.stderr.write('Usage: faida-server run|validate|defaults ...\n');
    process.exit(2);
  }
  const a = parseArgs(rest);
  for (const required of ['pg-bin', 'api-main', 'prisma-cli', 'schema', 'app-version']) {
    if (!a[required]) { emit({ type: 'error', message: `Missing --${required}` }); process.exit(2); }
  }
  const platform = process.platform as Platform;
  const dirs = defaultDirs(platform, process.env, os.homedir());
  const root = a['root'] ?? dirs.rootDir;
  const sep = platform === 'win32' ? '\\' : '/';
  const configFile = `${root}${sep}server.json`;
  // What the app does not say, the saved settings keep; a new installation falls back to the defaults.
  let saved: ReturnType<typeof loadConfig> = null;
  try {
    saved = loadConfig(configFile);
  } catch (e) {
    emit({ type: 'error', message: (e as Error).message });
    process.exit(1);
  }
  const sup = new Supervisor({
    configFile,
    logDir: `${root}${sep}logs`,
    pgDataDir: a['data-dir'] ?? saved?.pgDataDir ?? `${root}${sep}pgdata`,
    backupDir: a['backup-dir'] ?? saved?.backupDir ?? dirs.backupDir,
    lanEnabled: a['lan'] !== undefined ? a['lan'] === 'true' : saved?.lanEnabled ?? false,
    pgPort: a['pg-port'] ? Number(a['pg-port']) : undefined,
    apiPort: a['api-port'] ? Number(a['api-port']) : undefined,
    pgBinDir: a['pg-bin'],
    pgLibDir: a['pg-lib'],
    nodePath: a['node'] ?? process.execPath,
    apiMain: a['api-main'],
    prismaCli: a['prisma-cli'],
    schemaPath: a['schema'],
    appVersion: a['app-version'],
    machineId: a['machine-id'],
    licenseServerUrl: a['license-server'],
    // Passed as a file path (a PEM does not survive a command line); read here.
    licensePublicKey: a['license-public-key'] && fs.existsSync(a['license-public-key']) ? fs.readFileSync(a['license-public-key'], 'utf8') : undefined,
    extraOrigins: a['extra-origins'] ? a['extra-origins'].split(',').map((x) => x.trim()).filter(Boolean) : undefined,
    platform,
  });
  sup.on('status', (s) => emit({ type: 'status', ...s }));
  sup.on('log', (m) => emit({ type: 'log', message: m }));
  sup.on('warning', (m) => emit({ type: 'warning', message: m }));

  // When the desktop app dies, our output pipe breaks. Writing to it must not crash us (a crash would leave the API and
  // database running with nobody to stop them): ignore the error and carry on to a clean stop.
  process.stdout.on('error', () => undefined);
  process.stdin.on('error', () => undefined);
  // Whatever happens, never leave the API or database behind.
  process.on('exit', () => sup.emergencyStop());
  process.on('uncaughtException', (e) => {
    try { emit({ type: 'error', message: `Unexpected error: ${e.message}` }); } catch { /* pipe gone */ }
    sup.emergencyStop();
    process.exit(1);
  });

  let stopping = false;
  const shutdown = async (backup: boolean) => {
    if (stopping) return;
    stopping = true;
    try { await sup.stop({ backup }); } finally { process.exit(0); }
  };
  process.on('SIGTERM', () => void shutdown(true));
  process.on('SIGINT', () => void shutdown(true));

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('close', () => void shutdown(true)); // the desktop app went away
  rl.on('line', async (line) => {
    let msg: { id?: number; cmd?: string; file?: string };
    try { msg = JSON.parse(line); } catch { return; }
    const reply = (ok: boolean, data?: unknown, error?: string) => emit({ type: 'result', id: msg.id, ok, data, error });
    try {
      if (msg.cmd === 'status') reply(true, sup.status());
      else if (msg.cmd === 'backups') reply(true, sup.backups());
      else if (msg.cmd === 'backup') reply(true, await sup.backupNow('manual'));
      else if (msg.cmd === 'restore' && msg.file) { await sup.restore(msg.file); reply(true); }
      else if (msg.cmd === 'stop') { reply(true); await shutdown(true); }
      else reply(false, undefined, 'Unknown command');
    } catch (e) {
      reply(false, undefined, (e as Error).message);
    }
  });

  try {
    await sup.start();
  } catch (e) {
    emit({ type: 'error', message: (e as Error).message });
    process.exit(1);
  }
}

void main();
