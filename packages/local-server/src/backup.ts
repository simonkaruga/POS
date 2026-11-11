/**
 * Backups of the live database.
 *
 * A backup is one file, FAIDA-2026-11-06_103015-<reason>.kbk: a PostgreSQL custom-format dump made with -C, so a restore
 * can recreate the database from nothing. Every backup is checked after it is written (pg_restore --list must read it),
 * written under a temporary name and renamed, so a half-written file is never mistaken for a good backup.
 *
 * Not in the file: the encryption key (server.json) that protects the saved M-Pesa and eTIMS credentials inside the
 * database. After restoring onto a NEW computer those credentials must be entered again; everything else (items, sales,
 * customers, users, stock) comes back. Key escrow arrives with the cloud backup.
 */
import * as fs from 'fs';
import * as nodePath from 'path';
import { PostgresManager, run } from './postgres';
import { ServerConfig } from './config';

export type BackupReason = 'auto' | 'manual' | 'on-close' | 'pre-upgrade' | 'pre-restore';

export interface BackupInfo {
  file: string;
  name: string;
  bytes: number;
  createdAt: Date;
  reason: string;
}

const NAME = /^FAIDA-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})-([a-z-]+)\.kbk$/;

const two = (n: number) => String(n).padStart(2, '0');

export function backupFileName(at: Date, reason: BackupReason): string {
  return `FAIDA-${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}_${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}-${reason}.kbk`;
}

export function parseBackupName(name: string): { createdAt: Date; reason: string } | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, reason] = m;
  return { createdAt: new Date(+y, +mo - 1, +d, +h, +mi, +s), reason };
}

export function listBackups(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: BackupInfo[] = [];
  for (const name of fs.readdirSync(dir)) {
    const parsed = parseBackupName(name);
    if (!parsed) continue;
    const file = nodePath.join(dir, name);
    out.push({ file, name, bytes: fs.statSync(file).size, createdAt: parsed.createdAt, reason: parsed.reason });
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export interface RetentionPolicy {
  /** Keep every backup newer than this many days. */
  keepAllDays: number;
  /** Then keep one per day until this many days. */
  keepDailyDays: number;
  /** Then keep one per month until this many months. */
  keepMonthlyMonths: number;
  /** Safety copies taken before an upgrade or a restore are kept this long. */
  keepSafetyDays: number;
  /** Never delete the newest N, whatever the age. */
  keepNewest: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { keepAllDays: 7, keepDailyDays: 30, keepMonthlyMonths: 12, keepSafetyDays: 90, keepNewest: 3 };

const dayMs = 24 * 60 * 60 * 1000;
const dayKey = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}`;

/** Which backups to delete. Pure, so the rules are tested without touching a disk. Input newest first. */
export function backupsToDelete(backups: BackupInfo[], now: Date, policy: RetentionPolicy = DEFAULT_RETENTION): BackupInfo[] {
  const keep = new Set<string>();
  backups.slice(0, policy.keepNewest).forEach((b) => keep.add(b.file));
  const days = new Set<string>();
  const months = new Set<string>();
  // Oldest first so the EARLIEST backup of each day / month is the one kept for it.
  for (const b of [...backups].reverse()) {
    const age = (now.getTime() - b.createdAt.getTime()) / dayMs;
    const safety = b.reason === 'pre-upgrade' || b.reason === 'pre-restore';
    if (age <= policy.keepAllDays) keep.add(b.file);
    else if (safety && age <= policy.keepSafetyDays) keep.add(b.file);
    else if (age <= policy.keepDailyDays) {
      // Inside the daily window only the daily rule applies: a second backup of the same day must not slip through
      // to the monthly rule below.
      if (!days.has(dayKey(b.createdAt))) {
        days.add(dayKey(b.createdAt));
        keep.add(b.file);
      }
    } else if (age <= policy.keepMonthlyMonths * 31 && !months.has(monthKey(b.createdAt))) {
      months.add(monthKey(b.createdAt));
      keep.add(b.file);
    }
  }
  return backups.filter((b) => !keep.has(b.file));
}

export function pruneBackups(dir: string, now: Date = new Date(), policy: RetentionPolicy = DEFAULT_RETENTION): BackupInfo[] {
  const doomed = backupsToDelete(listBackups(dir), now, policy);
  for (const b of doomed) fs.rmSync(b.file, { force: true });
  return doomed;
}

/**
 * Is today's backup still to be made? One backup per calendar day (local time), taken as soon as midnight passes while the app
 * is running, or as soon as the app starts if midnight passed while it was closed. Any backup made since midnight counts,
 * including the one taken when the app was closed after midnight. Pure, so the rule is tested without a clock or a disk.
 */
export function dailyBackupDue(newest: Date | undefined, now: Date): boolean {
  if (!newest) return true;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return newest.getTime() < startOfToday.getTime();
}

export async function createBackup(pg: PostgresManager, cfg: ServerConfig, reason: BackupReason, now: Date = new Date()): Promise<BackupInfo> {
  fs.mkdirSync(cfg.backupDir, { recursive: true });
  const name = backupFileName(now, reason);
  const final = nodePath.join(cfg.backupDir, name);
  const tmp = `${final}.part`;
  const r = await run(
    pg.toolPath('pg_dump'),
    ['-h', '127.0.0.1', '-p', String(cfg.pgPort), '-U', cfg.dbUser, '-Fc', '-C', '--no-owner', '-f', tmp, cfg.dbName],
    { env: pg.toolEnv(), timeoutMs: 30 * 60 * 1000 },
  );
  if (r.code !== 0) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`The backup failed: ${r.stderr.trim().split(/\r?\n/).slice(-3).join(' | ')}`);
  }
  await verifyBackup(pg, tmp);
  fs.renameSync(tmp, final);
  return { file: final, name, bytes: fs.statSync(final).size, createdAt: now, reason };
}

/** Prove the file can be read back: pg_restore --list must succeed and name some contents. */
export async function verifyBackup(pg: PostgresManager, file: string): Promise<void> {
  const r = await run(pg.toolPath('pg_restore'), ['--list', file], { env: pg.toolEnv(), timeoutMs: 120000 });
  if (r.code !== 0 || !/TABLE DATA|TABLE /.test(r.stdout)) {
    throw new Error(`This backup file is damaged or empty and cannot be used: ${file}`);
  }
}

/**
 * Replace the live database with a backup. The API must be stopped first (the old database is dropped, which needs
 * every connection closed). The caller takes a pre-restore backup first, so a failed restore can be undone.
 */
export async function restoreBackup(pg: PostgresManager, cfg: ServerConfig, file: string): Promise<void> {
  await verifyBackup(pg, file);
  const r = await run(
    pg.toolPath('pg_restore'),
    ['-h', '127.0.0.1', '-p', String(cfg.pgPort), '-U', cfg.dbUser, '-d', 'postgres', '--clean', '--if-exists', '--create', '--no-owner', file],
    { env: pg.toolEnv(), timeoutMs: 60 * 60 * 1000 },
  );
  if (r.code !== 0) {
    throw new Error(`The restore failed: ${r.stderr.trim().split(/\r?\n/).slice(-4).join(' | ')}`);
  }
}
