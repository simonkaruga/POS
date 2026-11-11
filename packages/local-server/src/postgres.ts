/**
 * Controls the private PostgreSQL that the offline edition runs.
 *
 * It listens on 127.0.0.1 only (the API is the one thing other computers talk to), has no Unix socket (not needed, and
 * its path length breaks on some machines), and keeps full durability (fsync and synchronous_commit stay ON): a shop
 * PC loses power far more often than a server, and a hard stop must never cost a sale. After a power cut PostgreSQL
 * recovers by itself on the next start; tested by killing it with SIGKILL.
 */
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as nodePath from 'path';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Text written to the process's stdin (not used for secrets on the command line). */
  input?: string;
  timeoutMs?: number;
}

/**
 * Run a program to completion without ever flashing a console window on Windows.
 *
 * It returns when the program EXITS, not when its output pipe closes. A program can start a background process that
 * inherits the pipe and keeps it open for as long as it lives: `pg_ctl start` does exactly that on Windows (the database it
 * launched holds the pipe), so waiting for the pipe to close never ended and the whole server hung. After the exit the
 * pipes get a moment to deliver what was already written, then are closed from our side.
 */
export function run(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: opts.env ?? process.env, cwd: opts.cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    let finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => { if (!finished) { finished = true; if (timer) clearTimeout(timer); reject(e); } });
    // Every pipe closed: the normal case, and the fastest.
    child.on('close', (code) => finish(code));
    // Exited but a leftover child still holds a pipe: give already-written output a moment, then let go of the pipes.
    child.on('exit', (code) => {
      setTimeout(() => {
        if (finished) return;
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code);
      }, 300).unref?.();
    });
    if (opts.timeoutMs) timer = setTimeout(() => child.kill(), opts.timeoutMs);
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

export interface PostgresOptions {
  /** Folder holding initdb, pg_ctl, postgres, pg_dump, pg_restore. */
  binDir: string;
  /** Shared-library folder, only needed where the libraries are not next to the programs (Linux/macOS builds). */
  libDir?: string;
  dataDir: string;
  port: number;
  user: string;
  password: string;
  logFile: string;
}

/**
 * The settings PostgreSQL is started with (passed through `pg_ctl -o`). It listens on this computer only, keeps full
 * durability, and has no Unix-domain socket.
 *
 * The socket is switched off with an empty value on Linux and macOS, where pg_ctl's shell reads '' as "empty". On Windows
 * the setting is LEFT OUT: Windows has no Unix sockets and its default is already empty, and passing '' there hands
 * PostgreSQL two literal quote characters through cmd.exe, which it then tries to use as a folder name ("could not create
 * lock file ''/.s.PGSQL.54700.lock"). That failure only shows on Windows, so it is pinned by a test.
 */
export function serverOptions(port: number, platform: NodeJS.Platform = process.platform): string {
  return [
    `-p ${port}`,
    '-c listen_addresses=127.0.0.1',
    ...(platform === 'win32' ? [] : ["-c unix_socket_directories=''"]),
    '-c max_connections=60',
    '-c fsync=on',
    '-c synchronous_commit=on',
    '-c full_page_writes=on',
    '-c log_timezone=Africa/Nairobi',
    '-c timezone=Africa/Nairobi',
  ].join(' ');
}

export class PostgresManager {
  constructor(private readonly o: PostgresOptions) {}

  private env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: this.o.password };
    if (this.o.libDir) {
      const key = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
      env[key] = [this.o.libDir, process.env[key]].filter(Boolean).join(nodePath.delimiter);
    }
    return env;
  }

  private bin(name: string): string {
    return nodePath.join(this.o.binDir, exe(name));
  }

  /** Has this folder been initialised as a database already? */
  isInitialised(): boolean {
    return fs.existsSync(nodePath.join(this.o.dataDir, 'PG_VERSION'));
  }

  /**
   * Create the database cluster on the first run. Returns true when it was created now. The password is given to
   * initdb through a temporary file, never on a command line where another program could read it.
   */
  async init(): Promise<boolean> {
    if (this.isInitialised()) return false;
    // Never touch a folder that already holds someone's files. Only a missing or empty folder is ours to fill.
    if (fs.existsSync(this.o.dataDir) && fs.readdirSync(this.o.dataDir).length > 0) {
      throw new Error(`The folder ${this.o.dataDir} is not empty and is not a Faida database. Choose an empty or new folder.`);
    }
    const createdByUs = !fs.existsSync(this.o.dataDir);
    fs.mkdirSync(nodePath.dirname(this.o.dataDir), { recursive: true });
    fs.mkdirSync(nodePath.dirname(this.o.logFile), { recursive: true });
    const pwFile = `${this.o.dataDir}.pw-${process.pid}`;
    fs.writeFileSync(pwFile, this.o.password, { mode: 0o600 });
    try {
      const base = ['-D', this.o.dataDir, '-U', this.o.user, '--auth=scram-sha-256', `--pwfile=${pwFile}`, '-E', 'UTF8'];
      // ICU gives case-insensitive, accent-aware sorting like the cloud database; fall back to plain C if this build lacks it.
      let r = await run(this.bin('initdb'), [...base, '--locale-provider=icu', '--icu-locale=en-US', '--locale=C'], { env: this.env(), timeoutMs: 120000 });
      if (r.code !== 0 && /icu/i.test(r.stderr)) {
        this.cleanPartial(createdByUs);
        r = await run(this.bin('initdb'), [...base, '--locale=C'], { env: this.env(), timeoutMs: 120000 });
      }
      if (r.code !== 0) {
        this.cleanPartial(createdByUs);
        throw new Error(`Could not create the database: ${r.stderr.trim() || r.stdout.trim()}`);
      }
    } finally {
      fs.rmSync(pwFile, { force: true });
    }
    return true;
  }

  /** initdb leaves a half-made folder behind when it fails. Remove it only if WE created it and it never became a database. */
  private cleanPartial(createdByUs: boolean): void {
    if (createdByUs && fs.existsSync(this.o.dataDir) && !fs.existsSync(nodePath.join(this.o.dataDir, 'PG_VERSION'))) {
      fs.rmSync(this.o.dataDir, { recursive: true, force: true });
    } else if (fs.existsSync(this.o.dataDir) && !fs.existsSync(nodePath.join(this.o.dataDir, 'PG_VERSION'))) {
      // An empty folder the owner made: empty it again rather than delete the folder itself.
      for (const entry of fs.readdirSync(this.o.dataDir)) fs.rmSync(nodePath.join(this.o.dataDir, entry), { recursive: true, force: true });
    }
  }

  async isRunning(): Promise<boolean> {
    const r = await run(this.bin('pg_ctl'), ['-D', this.o.dataDir, 'status'], { env: this.env(), timeoutMs: 15000 });
    return r.code === 0;
  }

  /** Start and wait until it accepts connections. A stale postmaster.pid after a power cut is handled by pg_ctl itself. */
  async start(): Promise<void> {
    if (await this.isRunning()) return;
    const opts = serverOptions(this.o.port);
    const r = await run(this.bin('pg_ctl'), ['-D', this.o.dataDir, '-l', this.o.logFile, '-w', '-t', '60', '-o', opts, 'start'], {
      env: this.env(),
      timeoutMs: 90000,
    });
    if (r.code !== 0) {
      throw new Error(`The database did not start. ${this.lastLogLines(6) || r.stderr.trim()}`);
    }
  }

  /** Fast shutdown: ends connections, finishes the write-ahead log, leaves nothing to recover. */
  async stop(): Promise<void> {
    if (!(await this.isRunning())) return;
    const r = await run(this.bin('pg_ctl'), ['-D', this.o.dataDir, '-m', 'fast', '-w', '-t', '60', 'stop'], { env: this.env(), timeoutMs: 90000 });
    if (r.code !== 0) throw new Error(`The database did not stop cleanly: ${r.stderr.trim()}`);
  }

  /**
   * Stop without awaiting anything, for the moment this program is already exiting (the desktop app died). Safe to call
   * when the database is not running.
   */
  stopSync(): void {
    spawnSync(this.bin('pg_ctl'), ['-D', this.o.dataDir, '-m', 'fast', '-w', '-t', '20', 'stop'], {
      env: this.env(), windowsHide: true, timeout: 30000, stdio: 'ignore',
    });
  }

  private lastLogLines(n: number): string {
    try {
      return fs.readFileSync(this.o.logFile, 'utf8').trim().split(/\r?\n/).slice(-n).join(' | ');
    } catch {
      return '';
    }
  }

  /** Environment for pg_dump / pg_restore: the same libraries and the password via PGPASSWORD. */
  toolEnv(): NodeJS.ProcessEnv {
    return this.env();
  }

  toolPath(name: string): string {
    return this.bin(name);
  }
}
