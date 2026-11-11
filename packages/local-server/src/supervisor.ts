/**
 * Brings the whole local server up in the right order and keeps it healthy:
 *
 *   settings + secrets  ->  database created (first run)  ->  database started  ->  safety backup if the app version
 *   changed  ->  migrations  ->  API started  ->  scheduled backups
 *
 * and takes it down in the reverse order, with a backup on close. Everything the desktop app needs (start, stop, back up,
 * restore, status) is a method here, so the Rust side stays a thin launcher.
 */
import { EventEmitter } from 'events';
import * as nodePath from 'path';
import * as os from 'os';
import { ApiProcess, checkHealth, reapOrphanApi } from './api';
import { BackupInfo, BackupReason, createBackup, dailyBackupDue, listBackups, pruneBackups, restoreBackup } from './backup';
import { ensureConfig, loadConfig, saveConfig, ServerConfig, NewConfigOptions } from './config';
import { migrate, needsMigration } from './migrate';
import { isPortFree, findFreePort } from './ports';
import { PostgresManager } from './postgres';
import { Platform, validateBackupDir, validateDataDir } from './paths';

export interface SupervisorOptions extends NewConfigOptions {
  configFile: string;
  logDir: string;
  pgBinDir: string;
  pgLibDir?: string;
  nodePath: string;
  apiMain: string;
  prismaCli: string;
  schemaPath: string;
  appVersion: string;
  platform?: Platform;
  env?: NodeJS.ProcessEnv;
  /** Extra browser origins the API accepts, besides the desktop app's own (development and tests only). */
  extraOrigins?: string[];
  /** Licensing (see apps/api/src/licensing): handed to the API as environment. */
  machineId?: string;
  licenseServerUrl?: string;
  /** PEM text of the public key licences are checked against. */
  licensePublicKey?: string;
}

export type Phase = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface Status {
  phase: Phase;
  message: string;
  apiPort?: number;
  pgPort?: number;
  lanEnabled?: boolean;
  /** Addresses other computers can use to reach this server (empty unless LAN is enabled). */
  addresses: string[];
  dataDir?: string;
  backupDir?: string;
  lastBackup?: { name: string; at: string; bytes: number; reason: string };
}

const HOUR = 60 * 60 * 1000;

export class Supervisor extends EventEmitter {
  private cfg: ServerConfig | null = null;
  private pg: PostgresManager | null = null;
  private api: ApiProcess | null = null;
  private timer: NodeJS.Timeout | null = null;
  private phase: Phase = 'stopped';
  private message = 'Not started';
  private busy = false;

  constructor(private readonly o: SupervisorOptions) {
    super();
  }

  private set(phase: Phase, message: string): void {
    this.phase = phase;
    this.message = message;
    this.emit('status', this.status());
  }

  status(): Status {
    const cfg = this.cfg;
    const last = cfg ? listBackups(cfg.backupDir)[0] : undefined;
    return {
      phase: this.phase,
      message: this.message,
      apiPort: cfg?.apiPort,
      pgPort: cfg?.pgPort,
      lanEnabled: cfg?.lanEnabled,
      addresses: cfg?.lanEnabled ? lanAddresses(cfg.apiPort) : [],
      dataDir: cfg?.pgDataDir,
      backupDir: cfg?.backupDir,
      lastBackup: last ? { name: last.name, at: last.createdAt.toISOString(), bytes: last.bytes, reason: last.reason } : undefined,
    };
  }

  /**
   * Last resort when this whole program is exiting without a clean stop (the desktop app crashed, an uncaught error):
   * kill the API and stop the database synchronously so nothing is left running in the background.
   */
  emergencyStop(): void {
    if (this.phase === 'stopped') return;
    this.api?.killNow();
    try { this.pg?.stopSync(); } catch { /* nothing more to do */ }
  }

  /** Backups on disk, newest first, for the status screen's restore list. */
  backups(): Array<{ name: string; file: string; at: string; bytes: number; reason: string }> {
    if (!this.cfg) return [];
    return listBackups(this.cfg.backupDir).map((b) => ({ name: b.name, file: b.file, at: b.createdAt.toISOString(), bytes: b.bytes, reason: b.reason }));
  }

  async start(): Promise<void> {
    if (this.phase === 'running' || this.phase === 'starting') return;
    this.set('starting', 'Preparing');
    try {
      const platform = this.o.platform ?? (process.platform as Platform);
      const existing = loadConfig(this.o.configFile);
      if (!existing) {
        const data = validateDataDir(this.o.pgDataDir, platform, this.o.env ?? process.env);
        if (!data.ok) throw new Error(data.reason);
        const bk = validateBackupDir(this.o.backupDir, this.o.pgDataDir, platform);
        if (!bk.ok) throw new Error(bk.reason);
      }
      const pgPort = existing ? existing.pgPort : await findFreePort(this.o.pgPort ?? 54330);
      const { config, created } = ensureConfig(this.o.configFile, { ...this.o, pgPort });
      this.cfg = config;
      const firstRun = created;
      // The desktop app's setup is the source of truth: a later change of network access or folders must take effect,
      // not be ignored because settings were already written the first time.
      if (!created) this.applyChosenSettings(config, platform);

      this.pg = new PostgresManager({
        binDir: this.o.pgBinDir,
        libDir: this.o.pgLibDir,
        dataDir: config.pgDataDir,
        port: config.pgPort,
        user: config.dbUser,
        password: config.dbPassword,
        logFile: nodePath.join(this.o.logDir, 'postgres.log'),
      });

      this.set('starting', firstRun ? 'Creating your database (first time only)' : 'Starting the database');
      await this.pg.init();
      // The port may have been taken by another program since last time; pick another and remember it.
      if (!(await this.pg.isRunning()) && !(await isPortFree(config.pgPort))) {
        config.pgPort = await findFreePort(config.pgPort + 1);
        saveConfig(this.o.configFile, config);
        this.pg = new PostgresManager({ ...(this.pgOptions(config)) });
      }
      await this.pg.start();

      // An update is the riskiest moment for a database: save a copy first, and stop if that fails. It counts as an update when
      // the app version changed OR the database is behind this version's migrations (a build that kept its version number).
      const migrateOptions = { nodePath: this.o.nodePath, prismaCli: this.o.prismaCli, schemaPath: this.o.schemaPath };
      let safety: BackupInfo | undefined;
      if (!firstRun) {
        const versionChanged = !!config.lastRunVersion && config.lastRunVersion !== this.o.appVersion;
        if (versionChanged || (await needsMigration(config, migrateOptions))) {
          this.set('starting', 'Saving a safety backup before updating');
          safety = await createBackup(this.pg, config, 'pre-upgrade');
        }
      }

      this.set('starting', 'Updating the database');
      try {
        await migrate(config, migrateOptions);
      } catch (e) {
        throw await this.putBackAfterFailedUpdate(e as Error, config, safety);
      }

      const pidFile = nodePath.join(nodePath.dirname(this.o.configFile), 'run', 'api.pid');
      if (await reapOrphanApi(pidFile, config.apiPort)) this.emit('warning', 'Stopped a server left running by an earlier crash.');
      if (!(await isPortFree(config.apiPort))) {
        throw new Error(`Port ${config.apiPort} is in use by another program, so the Faida server cannot start. Close that program or restart the computer.`);
      }
      this.set('starting', 'Starting the server');
      this.api = new ApiProcess(config, {
        nodePath: this.o.nodePath,
        apiMain: this.o.apiMain,
        workDir: nodePath.join(nodePath.dirname(this.o.configFile), 'run'),
        logFile: nodePath.join(this.o.logDir, 'api.log'),
        pidFile,
        appVersion: this.o.appVersion,
        extraOrigins: this.o.extraOrigins,
        machineId: this.o.machineId,
        licenseServerUrl: this.o.licenseServerUrl,
        licensePublicKey: this.o.licensePublicKey,
      });
      this.api.on('crashed', () => this.set('running', 'The server restarted after a problem'));
      this.api.on('gave-up', () => this.set('error', 'The server keeps stopping. See the log files, then restart Faida.'));
      await this.api.start();

      config.lastRunVersion = this.o.appVersion;
      saveConfig(this.o.configFile, config);
      this.scheduleBackups();
      this.set('running', 'Running');
    } catch (e) {
      const msg = (e as Error).message;
      await this.shutdown().catch(() => undefined);
      this.set('error', msg);
      throw e;
    }
  }

  /**
   * The database update failed. A half-applied update leaves the database neither old nor new (and Prisma then refuses to go
   * on), so with a safety backup in hand the data is put back exactly as it was before the update, and the message says so.
   * Returns the error to report.
   */
  private async putBackAfterFailedUpdate(failure: Error, config: ServerConfig, safety: BackupInfo | undefined): Promise<Error> {
    if (!safety || !this.pg) return failure;
    try {
      this.set('starting', 'The update failed, putting your data back as it was');
      await restoreBackup(this.pg, config, safety.file);
    } catch (restoreFailure) {
      return new Error(
        `${failure.message} Putting your data back also failed (${(restoreFailure as Error).message}). Your data from before the update is safe in ${safety.file}.`,
      );
    }
    return new Error(`The update could not change your database, so it was put back exactly as it was before. Nothing was lost. ${failure.message}`);
  }

  /** Apply what the app asks for now over what was saved, checking folders the same way as on the first run. */
  private applyChosenSettings(config: ServerConfig, platform: Platform): void {
    let changed = false;
    if (this.o.lanEnabled !== undefined && this.o.lanEnabled !== config.lanEnabled) {
      config.lanEnabled = this.o.lanEnabled;
      changed = true;
    }
    if (this.o.backupDir && this.o.backupDir !== config.backupDir) {
      const bk = validateBackupDir(this.o.backupDir, this.o.pgDataDir || config.pgDataDir, platform);
      if (!bk.ok) throw new Error(bk.reason);
      config.backupDir = this.o.backupDir;
      changed = true;
    }
    if (this.o.pgDataDir && this.o.pgDataDir !== config.pgDataDir) {
      const data = validateDataDir(this.o.pgDataDir, platform, this.o.env ?? process.env);
      if (!data.ok) throw new Error(data.reason);
      this.emit('warning', `The database folder changed from ${config.pgDataDir} to ${this.o.pgDataDir}. The old folder is left untouched.`);
      config.pgDataDir = this.o.pgDataDir;
      changed = true;
    }
    if (changed) saveConfig(this.o.configFile, config);
  }

  private pgOptions(c: ServerConfig) {
    return {
      binDir: this.o.pgBinDir,
      libDir: this.o.pgLibDir,
      dataDir: c.pgDataDir,
      port: c.pgPort,
      user: c.dbUser,
      password: c.dbPassword,
      logFile: nodePath.join(this.o.logDir, 'postgres.log'),
    };
  }

  /**
   * The daily backup: one per calendar day, taken just after midnight while the app is open (checked every five minutes), or
   * a minute after the app starts if midnight passed while it was closed. While the app is closed the database is off, so
   * nothing can be backed up then; the catch-up on the next start and the backup taken when the app closes cover that.
   */
  private scheduleBackups(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.checkDailyBackup(), 5 * 60 * 1000);
    this.timer.unref?.();
    setTimeout(() => void this.checkDailyBackup(), 60 * 1000).unref?.();
  }

  /** Take today's backup if it is still to be made. Returns true when it made one. Public so a test can drive the clock. */
  async checkDailyBackup(now: Date = new Date()): Promise<boolean> {
    if (this.phase !== 'running' || this.busy || !this.cfg || !this.pg) return false;
    if (!dailyBackupDue(listBackups(this.cfg.backupDir)[0]?.createdAt, now)) return false;
    try {
      await this.backupNow('auto');
      return true;
    } catch (e) {
      this.emit('warning', `Automatic backup failed: ${(e as Error).message}`);
      return false;
    }
  }

  async backupNow(reason: BackupReason = 'manual'): Promise<BackupInfo> {
    if (!this.cfg || !this.pg || this.phase !== 'running') throw new Error('The server is not running.');
    if (this.busy) throw new Error('Another operation is in progress. Try again in a moment.');
    this.busy = true;
    try {
      const info = await createBackup(this.pg, this.cfg, reason);
      pruneBackups(this.cfg.backupDir);
      this.emit('status', this.status());
      return info;
    } finally {
      this.busy = false;
    }
  }

  /** Restore a backup file. Takes a safety copy of the current data first, and restarts the server afterwards. */
  async restore(file: string): Promise<void> {
    if (!this.cfg || !this.pg || !this.api || this.phase !== 'running') throw new Error('The server is not running.');
    if (this.busy) throw new Error('Another operation is in progress. Try again in a moment.');
    this.busy = true;
    const cfg = this.cfg;
    try {
      this.set('starting', 'Saving a safety backup before restoring');
      await createBackup(this.pg, cfg, 'pre-restore');
      this.set('starting', 'Restoring');
      await this.api.stop();
      await restoreBackup(this.pg, cfg, file);
      await migrate(cfg, { nodePath: this.o.nodePath, prismaCli: this.o.prismaCli, schemaPath: this.o.schemaPath });
      await this.api.start();
      this.set('running', 'Restored from backup');
    } catch (e) {
      this.set('error', `The restore did not finish: ${(e as Error).message}. Your data before the restore was saved as a pre-restore backup.`);
      throw e;
    } finally {
      this.busy = false;
    }
  }

  /** Stop everything. With backup=true a backup is taken first unless one was made within the last hour. */
  async stop(opts: { backup?: boolean } = {}): Promise<void> {
    if (this.phase === 'stopped' || this.phase === 'stopping') return;
    this.set('stopping', 'Shutting down');
    if (opts.backup && this.cfg && this.pg && this.phase !== 'error') {
      const newest = listBackups(this.cfg.backupDir)[0];
      if (!newest || Date.now() - newest.createdAt.getTime() > HOUR) {
        try {
          const info = await createBackup(this.pg, this.cfg, 'on-close');
          pruneBackups(this.cfg.backupDir);
          this.emit('log', `Backup saved: ${info.name}`);
        } catch (e) {
          this.emit('warning', `Backup on close failed: ${(e as Error).message}`);
        }
      }
    }
    await this.shutdown();
    this.set('stopped', 'Stopped');
  }

  private async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.api?.stop().catch(() => undefined);
    await this.pg?.stop().catch(() => undefined);
  }
}

/**
 * How likely an address is to be the shop's real network, lower is better. A router hands out 192.168.x.x (or 10.x.x.x)
 * almost everywhere; 172.16-31.x.x is what Docker, WSL, VirtualBox and many VPNs create, so it ranks last.
 */
export function addressRank(ip: string): number {
  if (/^192\.168\./.test(ip)) return 0;
  if (/^10\./.test(ip)) return 1;
  if (/^169\.254\./.test(ip)) return 9; // no network was found (self-assigned)
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 5;
  return 3;
}

/** The addresses a client on the network would type, such as http://192.168.1.20:3010, most likely first. */
export function lanAddresses(port: number, interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): string[] {
  const ips: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  return ips.sort((a, b) => addressRank(a) - addressRank(b)).map((ip) => `http://${ip}:${port}`);
}
