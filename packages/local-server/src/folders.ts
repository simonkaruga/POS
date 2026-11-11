/**
 * Checks that need the real disk, on top of the pure rules in paths.ts: does the folder exist, is it empty, can Faida
 * write there. Used by the setup wizard before it commits to a choice.
 */
import * as fs from 'fs';
import * as nodePath from 'path';
import { Check, Env, Platform, validateBackupDir, validateDataDir } from './paths';

function nearestExisting(dir: string): string {
  let cur = dir;
  while (!fs.existsSync(cur)) {
    const up = nodePath.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return cur;
}

/** Can we write inside this folder (or, if it does not exist yet, create it)? Leaves nothing behind. */
export function canWrite(dir: string): Check {
  try {
    const existing = nearestExisting(dir);
    if (existing === dir) {
      if (!fs.statSync(dir).isDirectory()) return { ok: false, reason: 'That path is a file, not a folder.' };
      const probe = nodePath.join(dir, `.faida-write-test-${process.pid}`);
      fs.writeFileSync(probe, 'x');
      fs.rmSync(probe, { force: true });
    } else {
      fs.accessSync(existing, fs.constants.W_OK);
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Faida cannot write to this folder. Choose another one, or run the installer again as an administrator.' };
  }
}

export interface FolderCheck {
  dataDir: Check;
  backupDir: Check;
}

/** Everything the wizard checks, in one call, with messages written for the owner. */
export function checkFolders(dataDir: string, backupDir: string, platform: Platform, env: Env): FolderCheck {
  let data: Check = validateDataDir(dataDir, platform, env);
  if (data.ok) {
    if (fs.existsSync(dataDir)) {
      const isDb = fs.existsSync(nodePath.join(dataDir, 'PG_VERSION'));
      if (!isDb && fs.statSync(dataDir).isDirectory() && fs.readdirSync(dataDir).length > 0) {
        data = { ok: false, reason: 'This folder already contains files. Choose an empty or new folder so nothing of yours is mixed with the database.' };
      }
    }
    if (data.ok) data = canWrite(dataDir);
  }
  let backup: Check = validateBackupDir(backupDir, dataDir, platform);
  if (backup.ok) backup = canWrite(backupDir);
  return { dataDir: data, backupDir: backup };
}
