/**
 * Runs Faida's API (the same NestJS server as the cloud) as a child process, watches it, and restarts it if it dies.
 */
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import { EventEmitter } from 'events';
import * as nodePath from 'path';
import { databaseUrl, ServerConfig } from './config';

export interface ApiOptions {
  nodePath: string;
  /** dist/main.js of the API. */
  apiMain: string;
  /** Where the API runs from. It must NOT contain a .env file: the API would load it over our settings. */
  workDir: string;
  logFile: string;
  /** Where this process's id is written, so a later start can find and stop an API left running by a crash. */
  pidFile?: string;
  /** Extra origins allowed to call the API; the desktop app's own origins are always included. */
  extraOrigins?: string[];
  appVersion?: string;
  /** This computer's id, as the licence is bound to it. */
  machineId?: string;
  /** Where licences are issued and renewed (the Faida cloud). */
  licenseServerUrl?: string;
  /** The PUBLIC key licences are checked against (PEM text). Without it nothing can be verified, so no paid plan is granted. */
  licensePublicKey?: string;
}

/** The web addresses the Tauri desktop app uses on Windows (http://tauri.localhost) and macOS/Linux (tauri://localhost). */
export const DESKTOP_ORIGINS = ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'];

export function apiEnvironment(cfg: ServerConfig, o: ApiOptions): NodeJS.ProcessEnv {
  const url = databaseUrl(cfg);
  return {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(cfg.apiPort),
    // Other computers may connect only when the owner chose to act as a server for them.
    HOST: cfg.lanEnabled ? '0.0.0.0' : '127.0.0.1',
    DATABASE_URL: url,
    DIRECT_URL: url,
    JWT_SECRET: cfg.jwtSecret,
    ENCRYPTION_KEY: cfg.encryptionKey,
    FRONTEND_URL: DESKTOP_ORIGINS[0],
    ADMIN_URL: DESKTOP_ORIGINS[0],
    EXTRA_ORIGINS: [...DESKTOP_ORIGINS, ...(o.extraOrigins ?? [])].join(','),
    FAIDA_EDITION: 'LOCAL',
    ...(o.appVersion ? { FAIDA_APP_VERSION: o.appVersion } : {}),
    ...(o.machineId ? { FAIDA_MACHINE_ID: o.machineId } : {}),
    ...(o.licenseServerUrl ? { LICENSE_SERVER_URL: o.licenseServerUrl } : {}),
    ...(o.licensePublicKey ? { FAIDA_LICENSE_PUBLIC_KEY: o.licensePublicKey } : {}),
  };
}

export function checkHealth(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/v1/health', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

export class ApiProcess extends EventEmitter {
  private child: ChildProcess | null = null;
  private wanted = false;
  private restarts: number[] = [];

  constructor(private readonly cfg: ServerConfig, private readonly o: ApiOptions) {
    super();
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** Start the API and wait until it answers its health check. */
  async start(timeoutMs = 90000): Promise<void> {
    this.wanted = true;
    this.spawnChild();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.running) throw new Error(`The server stopped while starting. ${this.tail(8)}`);
      if (await checkHealth(this.cfg.apiPort)) return;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`The server did not become ready in time. ${this.tail(8)}`);
  }

  private spawnChild(): void {
    fs.mkdirSync(nodePath.dirname(this.o.logFile), { recursive: true });
    fs.mkdirSync(this.o.workDir, { recursive: true });
    const log = fs.openSync(this.o.logFile, 'a');
    const child = spawn(this.o.nodePath, [this.o.apiMain], {
      cwd: this.o.workDir,
      env: apiEnvironment(this.cfg, this.o),
      stdio: ['ignore', log, log],
      windowsHide: true,
    });
    fs.closeSync(log);
    this.child = child;
    if (this.o.pidFile && child.pid) {
      try { fs.writeFileSync(this.o.pidFile, String(child.pid)); } catch { /* not fatal: only orphan recovery needs it */ }
    }
    child.on('exit', (code, signal) => {
      this.child = null;
      if (!this.wanted) return;
      // An unplanned exit: restart, but give up if it keeps dying (5 times in a minute) instead of looping forever.
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => now - t < 60000);
      this.restarts.push(now);
      this.emit('crashed', { code, signal });
      if (this.restarts.length > 5) {
        this.wanted = false;
        this.emit('gave-up');
        return;
      }
      setTimeout(() => this.wanted && this.spawnChild(), 1000);
    });
  }

  /** Kill at once, without waiting: used when the whole program is going down. */
  killNow(): void {
    this.wanted = false;
    try { this.child?.kill('SIGKILL'); } catch { /* already gone */ }
    if (this.o.pidFile) fs.rmSync(this.o.pidFile, { force: true });
  }

  async stop(): Promise<void> {
    this.wanted = false;
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => { child.kill('SIGKILL'); }, 10000);
      child.once('exit', () => { clearTimeout(force); resolve(); });
      child.kill('SIGTERM');
    });
    if (this.o.pidFile) fs.rmSync(this.o.pidFile, { force: true });
  }

  private tail(n: number): string {
    try {
      return fs.readFileSync(this.o.logFile, 'utf8').trim().split(/\r?\n/).slice(-n).join(' | ');
    } catch {
      return '';
    }
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/**
 * If an earlier run of this app crashed, its API may still be running and holding the port. Find it by the id we wrote
 * down and stop it, so the new start is not refused with "port in use". It is only stopped when that id is alive AND
 * something on our port still answers our health check, so a recycled process id can never take down an unrelated program.
 * Returns true if a leftover was stopped.
 */
export async function reapOrphanApi(pidFile: string, port: number): Promise<boolean> {
  if (!fs.existsSync(pidFile)) return false;
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  fs.rmSync(pidFile, { force: true });
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !alive(pid) || !(await checkHealth(port))) return false;
  try { process.kill(pid, 'SIGTERM'); } catch { return false; }
  const deadline = Date.now() + 10000;
  while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  return true;
}
