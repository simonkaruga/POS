/**
 * Where the offline edition keeps its files, and which folders it refuses.
 *
 * The LIVE database must sit on a plain local folder. PostgreSQL stores a database as thousands of files that it locks
 * and rewrites constantly; a folder that OneDrive, Dropbox or a network share is syncing gets those files corrupted.
 * Windows often redirects Documents, Desktop and Pictures into OneDrive without telling the user, so those are refused
 * too. BACKUPS are single files and may live anywhere, including Documents (the default) or a USB drive.
 *
 * All functions take the platform and environment as arguments so the Windows rules can be tested on any machine.
 */
import * as nodePath from 'path';

export type Platform = 'win32' | 'linux' | 'darwin';

export interface Dirs {
  /** Faida's root folder: settings, secrets, logs. */
  rootDir: string;
  /** PostgreSQL's data directory (the live database). */
  pgDataDir: string;
  /** Folder for automatic and manual backups. */
  backupDir: string;
  logDir: string;
  /** server.json: ports, secrets, where things are. */
  configFile: string;
}

export interface Env {
  [key: string]: string | undefined;
}

const pathFor = (platform: Platform) => (platform === 'win32' ? nodePath.win32 : nodePath.posix);

/** The folders a fresh install uses (C:\ProgramData\Faida and Documents\Faida Backups on Windows). */
export function defaultDirs(platform: Platform, env: Env, home: string): Dirs {
  const p = pathFor(platform);
  let root: string;
  let documents: string;
  if (platform === 'win32') {
    root = p.join(env.ProgramData || 'C:\\ProgramData', 'Faida');
    documents = p.join(env.USERPROFILE || home, 'Documents');
  } else if (platform === 'darwin') {
    root = p.join(home, 'Library', 'Application Support', 'Faida');
    documents = p.join(home, 'Documents');
  } else {
    root = p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'faida');
    documents = p.join(home, 'Documents');
  }
  return {
    rootDir: root,
    pgDataDir: p.join(root, 'pgdata'),
    backupDir: p.join(documents, 'Faida Backups'),
    logDir: p.join(root, 'logs'),
    configFile: p.join(root, 'server.json'),
  };
}

export type Check = { ok: true } | { ok: false; reason: string };

const SYNC_FOLDER = /(^|[\\/])(onedrive[^\\/]*|dropbox[^\\/]*|google ?drive[^\\/]*|icloud ?drive[^\\/]*|box sync|box|pcloud[^\\/]*|sync\.com|mega)([\\/]|$)/i;
const REDIRECTED_USER_FOLDER = /(^|[\\/])users[\\/][^\\/]+[\\/](documents|desktop|pictures|downloads|music|videos)([\\/]|$)/i;
const PROGRAM_FILES = /(^|[\\/])(program files( \(x86\))?|windows)([\\/]|$)/i;

/** Is this a safe place for the live database? Reasons are written for the owner, not for a programmer. */
export function validateDataDir(dir: string, platform: Platform, env: Env = {}): Check {
  const p = pathFor(platform);
  const raw = (dir ?? '').trim();
  if (!raw) return { ok: false, reason: 'Choose a folder for the database.' };
  if (!p.isAbsolute(raw)) return { ok: false, reason: 'Use a full folder path, for example C:\\FaidaData.' };
  if (platform === 'win32' && /^[\\/]{2}/.test(raw)) {
    return { ok: false, reason: 'The database cannot live on a network share (a path starting with \\\\). Choose a folder on this computer.' };
  }
  const norm = p.normalize(raw);
  if (p.parse(norm).root === norm || p.parse(norm).root === norm + p.sep) {
    return { ok: false, reason: 'Choose a folder, not the whole drive, so Faida does not mix its files with yours.' };
  }
  const cmp = platform === 'win32' ? (s: string) => s.toLowerCase() : (s: string) => s;
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const od = env[key];
    if (od && cmp(norm).startsWith(cmp(p.normalize(od)))) {
      return { ok: false, reason: 'This folder is synced by OneDrive. Syncing damages a live database. Choose a folder outside OneDrive, such as C:\\ProgramData\\Faida.' };
    }
  }
  if (SYNC_FOLDER.test(norm)) {
    return { ok: false, reason: 'This folder looks like a cloud-synced folder (OneDrive, Dropbox, Google Drive, iCloud). Syncing damages a live database. Choose a folder that is not synced.' };
  }
  if (platform === 'win32' && REDIRECTED_USER_FOLDER.test(norm)) {
    return { ok: false, reason: 'Documents, Desktop, Pictures and Downloads are often synced to OneDrive by Windows. Choose a folder such as C:\\ProgramData\\Faida instead. Backups can still go to Documents.' };
  }
  if (platform === 'win32' && PROGRAM_FILES.test(norm)) {
    return { ok: false, reason: 'Program Files and Windows are read-only for normal users. Choose another folder.' };
  }
  return { ok: true };
}

/** A backup folder may be anywhere EXCEPT inside the live database folder. */
export function validateBackupDir(backupDir: string, pgDataDir: string, platform: Platform): Check {
  const p = pathFor(platform);
  const raw = (backupDir ?? '').trim();
  if (!raw) return { ok: false, reason: 'Choose a folder for backups.' };
  if (!p.isAbsolute(raw)) return { ok: false, reason: 'Use a full folder path for backups.' };
  const cmp = platform === 'win32' ? (s: string) => s.toLowerCase() : (s: string) => s;
  const b = cmp(p.normalize(raw));
  const d = cmp(p.normalize(pgDataDir));
  if (b === d || b.startsWith(d + p.sep)) {
    return { ok: false, reason: 'Backups must not be stored inside the database folder, or one mistake loses both.' };
  }
  return { ok: true };
}
