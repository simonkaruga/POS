/**
 * server.json: this installation's settings and secrets.
 *
 * The secrets are generated once, on first run, and never change:
 *  - dbPassword      PostgreSQL's password (the database only listens on this computer)
 *  - jwtSecret       signs login tokens
 *  - encryptionKey   encrypts the saved M-Pesa and eTIMS credentials INSIDE the database. A restored backup is
 *                    useless for those credentials without the same key, so backups must carry it (see backup.ts).
 * Losing server.json with its encryptionKey cannot be repaired, so it is written atomically and kept private.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as nodePath from 'path';

export interface ServerConfig {
  version: 1;
  createdAt: string;
  pgDataDir: string;
  backupDir: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  pgPort: number;
  apiPort: number;
  /** true: other computers on the network may connect to the API (a server for LAN clients). */
  lanEnabled: boolean;
  jwtSecret: string;
  encryptionKey: string;
  /** App version that last started this database; a change triggers a safety backup before migrating. */
  lastRunVersion?: string;
}

export interface NewConfigOptions {
  pgDataDir: string;
  backupDir: string;
  pgPort?: number;
  apiPort?: number;
  lanEnabled?: boolean;
}

export const DEFAULT_PG_PORT = 54330;
export const DEFAULT_API_PORT = 3010;

const hex = (bytes: number) => crypto.randomBytes(bytes).toString('hex');

export function newConfig(o: NewConfigOptions, now: Date = new Date()): ServerConfig {
  return {
    version: 1,
    createdAt: now.toISOString(),
    pgDataDir: o.pgDataDir,
    backupDir: o.backupDir,
    dbName: 'faida',
    dbUser: 'faida',
    dbPassword: hex(24),
    pgPort: o.pgPort ?? DEFAULT_PG_PORT,
    apiPort: o.apiPort ?? DEFAULT_API_PORT,
    lanEnabled: o.lanEnabled ?? false,
    jwtSecret: hex(32),
    encryptionKey: hex(32), // 64 hex characters, as the API expects
  };
}

export function loadConfig(file: string): ServerConfig | null {
  if (!fs.existsSync(file)) return null;
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as ServerConfig;
  if (cfg.version !== 1 || !cfg.dbPassword || !cfg.jwtSecret || !/^[0-9a-f]{64}$/i.test(cfg.encryptionKey)) {
    throw new Error(`${file} is damaged or from a newer version of Faida. Restore it from a backup; do not delete it, the database cannot be read without it.`);
  }
  return cfg;
}

/** Write-then-rename so a power cut cannot leave half a file; owner-only permissions where the OS supports them. */
export function saveConfig(file: string, cfg: ServerConfig): void {
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Load the config, or create it (with fresh secrets) on the first run. Existing secrets are never regenerated. */
export function ensureConfig(file: string, o: NewConfigOptions): { config: ServerConfig; created: boolean } {
  const existing = loadConfig(file);
  if (existing) return { config: existing, created: false };
  const config = newConfig(o);
  saveConfig(file, config);
  return { config, created: true };
}

export function databaseUrl(cfg: ServerConfig, db: string = cfg.dbName): string {
  return `postgresql://${cfg.dbUser}:${encodeURIComponent(cfg.dbPassword)}@127.0.0.1:${cfg.pgPort}/${db}`;
}
