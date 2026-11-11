/**
 * The desktop app's side of the local server: thin wrappers over the Rust commands (`local_server_*`) plus the
 * wording the screens use. Everything here is a no-op or a harmless default outside the desktop app.
 */

export type Phase = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface LocalServerStatus {
  phase: Phase;
  message: string;
  apiPort?: number;
  pgPort?: number;
  lanEnabled?: boolean;
  /** Addresses other computers can type to reach this server. */
  addresses: string[];
  dataDir?: string;
  backupDir?: string;
  lastBackup?: { name: string; at: string; bytes: number; reason: string };
}

export interface BackupEntry {
  name: string;
  file: string;
  at: string;
  bytes: number;
  reason: string;
}

export interface FolderResult {
  ok: boolean;
  reason?: string;
}

export interface FolderCheck {
  dataDir: FolderResult;
  backupDir: FolderResult;
}

export interface FolderDefaults {
  rootDir: string;
  dataDir: string;
  backupDir: string;
  platform: string;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function tauriInvoke(): Invoke | null {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: Invoke };
    __TAURI__?: { invoke?: Invoke };
  };
  return w.__TAURI_INTERNALS__?.invoke ?? w.__TAURI__?.invoke ?? null;
}

export const inDesktopApp = (): boolean => tauriInvoke() !== null;

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error('This is only available in the Faida desktop app.');
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    // Rust errors arrive as plain strings.
    throw new Error(typeof e === 'string' ? e : (e as Error)?.message ?? 'Something went wrong.', { cause: e });
  }
}

/** Outside the desktop app (developing the wizard in a browser) these return believable values so the screens work. */
const DEV_DEFAULTS: FolderDefaults = {
  rootDir: 'C:\\ProgramData\\Faida',
  dataDir: 'C:\\ProgramData\\Faida\\pgdata',
  backupDir: 'C:\\Users\\You\\Documents\\Faida Backups',
  platform: 'win32',
};

export const serverDefaults = (): Promise<FolderDefaults> => (inDesktopApp() ? call('local_server_defaults') : Promise.resolve(DEV_DEFAULTS));

export const validateFolders = (dataDir: string, backupDir: string): Promise<FolderCheck> =>
  inDesktopApp()
    ? call('local_server_validate_folders', { dataDir, backupDir })
    : Promise.resolve({ dataDir: { ok: true }, backupDir: { ok: true } });

export const serverSetLan = (enabled: boolean): Promise<boolean> => call('local_server_set_lan', { enabled });
export const getSetupMode = (): Promise<{ mode: string; server_url?: string | null; business_name?: string | null }> => call('get_setup_mode');
export const serverStart = (): Promise<boolean> => call('local_server_start');
export const serverRestart = (): Promise<boolean> => call('local_server_restart');
export const serverStop = (): Promise<boolean> => call('local_server_stop');
export const serverStatus = (): Promise<LocalServerStatus> => call('local_server_status');
export const serverBackup = (): Promise<BackupEntry> => call('local_server_backup');
export const serverBackups = (): Promise<BackupEntry[]> => call('local_server_backups');
export const serverRestore = (file: string): Promise<boolean> => call('local_server_restore', { file });

// ─── Wording ──────────────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** "5 minutes ago", "3 hours ago", "yesterday", "12 Oct". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const mins = Math.round((now.getTime() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export const BACKUP_REASON: Record<string, string> = {
  auto: 'Automatic',
  manual: 'Backed up by you',
  'on-close': 'When the app was closed',
  'pre-upgrade': 'Before an update',
  'pre-restore': 'Before a restore',
};

// ─── Reconfiguring ────────────────────────────────────────────────────────────

/**
 * Forget this computer's setup so the wizard runs again. The local server is stopped first (it saves a backup) and the
 * database on disk is NOT deleted: choosing the same folder again picks the data up where it was.
 */
export async function reconfigureThisComputer(): Promise<void> {
  try { await serverStop(); } catch { /* not running, or not a server computer */ }
  try { await call<boolean>('reset_setup'); } catch { /* ignore: the wizard falls back to local storage */ }
  for (const key of ['desktop-setup-done', 'desktop-device-role', 'desktop-business-name', 'faida-server-url']) localStorage.removeItem(key);
}
