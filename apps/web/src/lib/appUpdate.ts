/**
 * Updating the desktop app: the checks and the install are done by the desktop program (src-tauri/src/app_update.rs); this
 * file is the web side. A newer version is looked for a little after start-up and every few hours, and the owner decides when
 * to install it, because installing closes the app (and the shop's server) for a minute.
 *
 * Nothing here talks to the API, so it also works on a till whose server is down. Outside the desktop app everything is a no-op.
 */
import { create } from 'zustand';
import { call, inDesktopApp } from './desktopServer';

export interface AppUpdateInfo {
  version: string;
  currentVersion: string;
  notes?: string | null;
  date?: string | null;
}

/** `stage` is idle until an install starts, then downloading, stopping (the shop's server), installing, or error. */
export interface UpdateProgress {
  stage: 'idle' | 'downloading' | 'stopping' | 'installing' | 'error';
  downloaded: number;
  total?: number | null;
  error?: string | null;
}

const IDLE: UpdateProgress = { stage: 'idle', downloaded: 0 };

/** Only the people who run the shop decide when the whole app closes; a cashier mid-sale must not. */
export const canInstallUpdate = (role?: string): boolean => role === 'OWNER' || role === 'MANAGER';

export const isInstalling = (p: UpdateProgress): boolean => p.stage === 'downloading' || p.stage === 'stopping' || p.stage === 'installing';

export function percentDone(p: UpdateProgress): number | null {
  if (p.stage !== 'downloading' || !p.total) return null;
  return Math.min(100, Math.floor((p.downloaded / p.total) * 100));
}

/** One line for the banner while an install is running. */
export function describeProgress(p: UpdateProgress): string {
  switch (p.stage) {
    case 'downloading': {
      const pct = percentDone(p);
      return pct === null ? 'Downloading the update' : `Downloading the update, ${pct}%`;
    }
    case 'stopping':
      return 'Saving your data before the update';
    case 'installing':
      return 'Installing. Faida will restart by itself in a moment';
    case 'error':
      return p.error || 'The update did not finish. Nothing was changed.';
    default:
      return '';
  }
}

/** How long ago a check was made, for the "last checked" line. */
export function checkedAgo(at: number | undefined, now = Date.now()): string {
  if (!at) return 'not yet';
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

const asMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface AppUpdateState {
  version?: string;
  found: AppUpdateInfo | null;
  checking: boolean;
  checkedAt?: number;
  /** Set only by a check the owner asked for: a failed background check (no internet) stays quiet. */
  checkError?: string;
  progress: UpdateProgress;
  /** "Later" hides the banner until the next check finds it again. */
  dismissed: boolean;
  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

let polling = false;

export const useAppUpdate = create<AppUpdateState>((set, get) => ({
  found: null,
  checking: false,
  progress: IDLE,
  dismissed: false,

  check: async (manual = false) => {
    if (!inDesktopApp() || get().checking || isInstalling(get().progress)) return;
    set({ checking: true, checkError: undefined });
    try {
      if (!get().version) set({ version: await call<string>('app_version') });
      const found = await call<AppUpdateInfo | null>('app_update_check');
      // The same version found again keeps "Later" in force; a newer one shows the banner again.
      set((s) => ({ found, checkedAt: Date.now(), dismissed: found && s.found?.version === found.version ? s.dismissed : false }));
    } catch (e) {
      set({ checkedAt: Date.now(), checkError: manual ? asMessage(e) : undefined });
    } finally {
      set({ checking: false });
    }
  },

  install: async () => {
    if (!inDesktopApp() || isInstalling(get().progress)) return;
    set({ progress: { stage: 'downloading', downloaded: 0 } });
    try {
      await call<void>('app_update_install');
    } catch (e) {
      set({ progress: { ...IDLE, stage: 'error', error: asMessage(e) } });
      return;
    }
    if (polling) return;
    polling = true;
    // The desktop program does the work in the background; follow it until it fails. On success it ends this program.
    const tick = async () => {
      try {
        const p = await call<UpdateProgress>('app_update_status');
        set({ progress: p });
        if (p.stage === 'error' || p.stage === 'idle') {
          polling = false;
          return;
        }
      } catch {
        // The program is restarting for the update: keep waiting, there is nothing to show but the last stage.
      }
      setTimeout(tick, 700);
    };
    void tick();
  },

  dismiss: () => set({ dismissed: true }),
}));

const FIRST_CHECK_MS = 20 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

/** Start the background checks (once per mounting of the banner). A no-op outside the desktop app. */
export function startUpdateChecks(): () => void {
  if (!inDesktopApp()) return () => undefined;
  const first = setTimeout(() => void useAppUpdate.getState().check(), FIRST_CHECK_MS);
  const every = setInterval(() => void useAppUpdate.getState().check(), EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
