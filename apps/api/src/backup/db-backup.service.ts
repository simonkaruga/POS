import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';

const execAsync = promisify(exec);

@Injectable()
export class DbBackupService {
  private readonly logger = new Logger(DbBackupService.name);
  private readonly backupDir = process.env.BACKUP_DIR ?? '/var/backups/faida';
  private readonly retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS ?? '30', 10);

  /** Daily at 02:00 UTC (05:00 EAT) */
  @Cron('0 2 * * *')
  async runBackup() {
    // The offline desktop edition backs itself up (packages/local-server): verified, to the owner's folder, with its own
    // PostgreSQL tools. This job needs pg_dump and gzip on the PATH and a Linux folder, so on a customer's PC it would
    // only fail every night and leave a stray C:\var\backups behind.
    if (process.env.FAIDA_EDITION === 'LOCAL') return;

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl || !dbUrl.startsWith('postgresql')) {
      this.logger.warn('DB backup skipped — DATABASE_URL is not a PostgreSQL connection string');
      return;
    }

    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
    } catch (err: any) {
      this.logger.error(`Cannot create backup directory ${this.backupDir}: ${err.message}`);
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = path.join(this.backupDir, `faida_${timestamp}.sql.gz`);

    try {
      await execAsync(`pg_dump "${dbUrl}" | gzip > "${filename}"`);
      const stats = fs.statSync(filename);
      this.logger.log(`Backup created: ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
      await this.pruneOldBackups();
    } catch (err: any) {
      this.logger.error(`Backup failed: ${err.message}`);
      // Clean up partial file if it exists
      if (fs.existsSync(filename)) fs.unlinkSync(filename);
    }
  }

  private async pruneOldBackups() {
    const cutoff = Date.now() - this.retentionDays * 86400000;
    const files = fs.readdirSync(this.backupDir).filter((f) => f.startsWith('faida_') && f.endsWith('.sql.gz'));

    for (const file of files) {
      const filePath = path.join(this.backupDir, file);
      const mtime = fs.statSync(filePath).mtimeMs;
      if (mtime < cutoff) {
        fs.unlinkSync(filePath);
        this.logger.log(`Pruned old backup: ${file}`);
      }
    }
  }

  /** Returns a list of available backups for the admin health panel */
  listBackups(): Array<{ name: string; sizeBytes: number; createdAt: Date }> {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs
      .readdirSync(this.backupDir)
      .filter((f) => f.startsWith('faida_') && f.endsWith('.sql.gz'))
      .map((f) => {
        const stats = fs.statSync(path.join(this.backupDir, f));
        return { name: f, sizeBytes: stats.size, createdAt: stats.mtime };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}
