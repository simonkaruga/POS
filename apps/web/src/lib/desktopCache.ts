/**
 * The desktop app carries its own screens inside the installer, so it must never run them from a browser-style offline cache.
 * The website registers a service worker that answers every page from a copy saved on the first visit; inside the desktop app
 * that copy outlives an install or an update, so the app opened on the PREVIOUS version's screens (an update looked like it
 * did nothing, and new screens such as the update banner did not appear until a second launch). Here the desktop app removes
 * that worker and its saved copies, and reloads once if the worker was in charge of the current page.
 *
 * Takes its environment as a parameter so the rules are tested without a browser.
 */
export interface CacheEnv {
  serviceWorker?: {
    controller: unknown;
    getRegistrations: () => Promise<readonly { unregister: () => Promise<boolean> }[]>;
  };
  caches?: { keys: () => Promise<string[]>; delete: (key: string) => Promise<boolean> };
  /** sessionStorage-like: remembers that we already reloaded in this window, so a failure can never loop. */
  flag: { get: () => string | null; set: () => void };
  reload: () => void;
}

/** Returns what it did, for the tests and for a log line. */
export async function dropOfflineShell(env: CacheEnv): Promise<{ unregistered: number; cachesDeleted: number; reloaded: boolean }> {
  const worker = env.serviceWorker;
  const wasControlled = !!worker?.controller;
  let unregistered = 0;
  let cachesDeleted = 0;
  try {
    for (const registration of (await worker?.getRegistrations()) ?? []) {
      if (await registration.unregister()) unregistered++;
    }
    for (const key of (await env.caches?.keys()) ?? []) {
      if (await env.caches?.delete(key)) cachesDeleted++;
    }
  } catch {
    // Not being able to clean up must not stop the app from starting.
  }
  const reloaded = wasControlled && !env.flag.get();
  if (reloaded) {
    env.flag.set();
    env.reload();
  }
  return { unregistered, cachesDeleted, reloaded };
}

/** The real browser environment. */
export function browserCacheEnv(): CacheEnv {
  const KEY = 'faida-shell-purged';
  return {
    serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    caches: 'caches' in window ? window.caches : undefined,
    flag: { get: () => sessionStorage.getItem(KEY), set: () => sessionStorage.setItem(KEY, '1') },
    reload: () => window.location.reload(),
  };
}
