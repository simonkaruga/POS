import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DbBackupService } from './db-backup.service';

describe('DbBackupService on the offline desktop edition', () => {
  const saved = { edition: process.env.FAIDA_EDITION, dir: process.env.BACKUP_DIR, url: process.env.DATABASE_URL };
  afterEach(() => {
    for (const [key, value] of [['FAIDA_EDITION', saved.edition], ['BACKUP_DIR', saved.dir], ['DATABASE_URL', saved.url]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('does nothing: the desktop app backs itself up, and this job would only fail and leave a stray folder', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'faida-dbb-')), 'never-created');
    process.env.FAIDA_EDITION = 'LOCAL';
    process.env.BACKUP_DIR = dir;
    process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/z';
    await new DbBackupService().runBackup();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('still tries to back up on the cloud server (no edition set)', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'faida-dbb-')), 'created');
    delete process.env.FAIDA_EDITION;
    process.env.BACKUP_DIR = dir;
    process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/z';
    await new DbBackupService().runBackup();
    expect(fs.existsSync(dir)).toBe(true); // it got as far as creating its folder; pg_dump itself fails against this fake URL
  });
});
