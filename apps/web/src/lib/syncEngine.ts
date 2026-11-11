/**
 * Sync Engine — handles offline ↔ online synchronisation
 * - Detects online/offline status
 * - Caches server data to IndexedDB
 * - Processes the sync queue when back online
 */
import api, { ApiError, getToken, getApiUrl } from './api';
import {
  db,
  cacheItems,
  cacheCustomers,
  getPendingCount,
  getPendingQueue,
  getRejectedCount,
  purgeDone,
  type CachedItem,
  type CachedCustomer,
  type SyncQueueEntry,
} from './db';
import { useAuthStore } from '../stores/auth';
import { useSyncStore } from '../stores/sync';

const API_BASE = getApiUrl();

// ─── Network check ────────────────────────────────────────────────────────────

export function isOnline(): boolean {
  return navigator.onLine;
}

// ─── Cache refreshers ─────────────────────────────────────────────────────────

export async function refreshItemsCache(businessId: string, storeId: string): Promise<void> {
  if (!isOnline()) return;
  try {
    const token = getToken();
    const res = await fetch(
      `${API_BASE}/items?businessId=${businessId}&storeId=${storeId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return;
    const items = (await res.json()) as Array<Record<string, unknown>>;
    const cached: CachedItem[] = items.map((item) => ({
      id: item.id as string,
      businessId: item.businessId as string,
      storeId: item.storeId as string,
      name: item.name as string,
      category: item.category as string | undefined,
      barcode: item.barcode as string | undefined,
      type: item.type as string,
      retailPriceCents: item.retailPriceCents as number,
      wholesalePriceCents: item.wholesalePriceCents as number | undefined,
      vipPriceCents: item.vipPriceCents as number | undefined,
      costPriceCents: item.costPriceCents as number | undefined,
      vatApplicable: Boolean(item.vatApplicable),
      taxClass: (item.taxClass as string | undefined) ?? undefined,
      totApplicable: Boolean(item.totApplicable),
      trackStock: Boolean(item.trackStock),
      currentStock: item.currentStock as number ?? 0,
      syncedAt: Date.now(),
    }));
    await cacheItems(cached);
    await db.meta.put({ key: `items-synced:${businessId}:${storeId}`, value: Date.now() });
  } catch (err) {
    console.warn('[SyncEngine] Failed to refresh items cache:', err);
  }
}

export async function refreshCustomersCache(businessId: string): Promise<void> {
  if (!isOnline()) return;
  try {
    const token = getToken();
    const res = await fetch(
      `${API_BASE}/customers?businessId=${businessId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return;
    const customers = (await res.json()) as Array<Record<string, unknown>>;
    const cached: CachedCustomer[] = customers.map((c) => ({
      id: c.id as string,
      businessId: c.businessId as string,
      name: c.name as string,
      phone: c.phone as string | undefined,
      email: c.email as string | undefined,
      creditLimitCents: c.creditLimitCents as number ?? 0,
      balanceCents: c.balanceCents as number ?? 0,
      loyaltyPoints: c.loyaltyPoints as number ?? 0,
      syncedAt: Date.now(),
    }));
    await cacheCustomers(cached);
    await db.meta.put({ key: `customers-synced:${businessId}`, value: Date.now() });
  } catch (err) {
    console.warn('[SyncEngine] Failed to refresh customers cache:', err);
  }
}

// ─── Queue processor ──────────────────────────────────────────────────────────
//
// Uploads what was saved while offline (sales above all). Rules that matter for money:
//  - A LOST CONNECTION never costs an entry its place: it stays PENDING and the run stops, instead of burning
//    attempts. Only a server answer can change an entry's fate.
//  - A 4xx means the SERVER REFUSED it (out of stock, invalid item). Retrying the same request cannot help, so
//    the entry becomes FAILED and shows in the offline-sales list for a person. It is never dropped.
//  - The sale carries its own idempotency key, so uploading twice (a second tab, a crash between upload and
//    bookkeeping, a lost response) cannot record it twice.
//  - A sale belongs to the cashier who rang it up. It uploads under that cashier's login, or under an
//    owner/manager's, who uploads it on their behalf so reports stay right. A different cashier leaves it alone.

export type FailureVerdict = 'rejected' | 'retry' | 'server-error' | 'auth';

/** What a failed upload means. See the rules above. */
export function classifyFailure(err: unknown): FailureVerdict {
  const status = err instanceof ApiError ? err.status : undefined;
  if (status === undefined) return 'retry'; // no HTTP answer at all: offline, DNS, timeout, server restarting
  if (status === 401) return 'auth';
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) return 'retry';
  if (status >= 500) return 'server-error';
  return 'rejected';
}

/** Server errors on one entry back off and give up after this many attempts (then it waits for a person). */
export const MAX_SERVER_ERROR_ATTEMPTS = 10;
const SERVER_ERROR_BACKOFF_MS = 30_000;
const PURGE_AFTER_MS = 7 * 24 * 3600 * 1000;

export interface SyncUser {
  id: string;
  role?: string;
}

const isManager = (u: SyncUser) => u.role === 'OWNER' || u.role === 'MANAGER';

/** May this person upload that entry? Their own, or anyone's if they are an owner or manager. */
export function canUpload(entry: SyncQueueEntry, user: SyncUser): boolean {
  return !entry.userId || entry.userId === user.id || isManager(user);
}

export interface SyncRunResult {
  synced: number;
  rejected: number;
  /** Entries left waiting: offline, backing off, or belonging to a cashier who has not signed in. */
  waiting: number;
}

let _running: Promise<SyncRunResult> | null = null;

/**
 * Upload everything that is ready, oldest first. Safe to call from anywhere at any time: callers while a run is
 * going share it, and across browser tabs only one runs (Web Locks), so a sale is not uploaded twice at once.
 */
export function processSyncQueue(user?: SyncUser | null, options: { uploadTimeoutMs?: number } = {}): Promise<SyncRunResult> {
  if (!_running) {
    _running = runExclusive(user ?? currentUser(), options.uploadTimeoutMs ?? uploadTimeoutMs).finally(() => { _running = null; });
  }
  return _running;
}

/**
 * One upload may not hold the whole queue hostage: a server that accepts the connection and never answers would
 * otherwise block every later run until the page is reloaded. A timeout is a lost connection (the entry keeps its
 * place); if the request did reach the server, the idempotency key makes the retry harmless.
 */
export const UPLOAD_TIMEOUT_MS = 30_000;
let uploadTimeoutMs = UPLOAD_TIMEOUT_MS;

/** Test seam: shorten the upload timeout so a deliberately hung request does not outlive its test. */
export function setUploadTimeoutForTests(ms: number): void {
  uploadTimeoutMs = ms;
}

/** Resolves when no upload run is in progress. */
export function whenIdle(): Promise<unknown> {
  return _running ?? Promise.resolve();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server did not answer in time')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function currentUser(): SyncUser | null {
  const u = useAuthStore.getState().user;
  return u ? { id: u.id, role: u.role } : null;
}

async function runExclusive(user: SyncUser | null, timeoutMs: number): Promise<SyncRunResult> {
  const locks = (typeof navigator !== 'undefined' ? navigator.locks : undefined) as
    | { request: <T>(name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<T>) => Promise<T> }
    | undefined;
  const empty: SyncRunResult = { synced: 0, rejected: 0, waiting: 0 };
  if (!locks) return run(user, timeoutMs);
  return locks.request('faida-sync', { ifAvailable: true }, async (lock) => (lock ? run(user, timeoutMs) : empty));
}

async function run(user: SyncUser | null, timeoutMs: number): Promise<SyncRunResult> {
  const result: SyncRunResult = { synced: 0, rejected: 0, waiting: 0 };
  const store = useSyncStore.getState();
  if (!user) return result; // nobody signed in: no token to upload with

  store.setProcessing(true);
  try {
    const pending = await getPendingQueue();
    for (const entry of pending) {
      if (!canUpload(entry, user)) { result.waiting++; continue; }
      const verdict = await uploadEntry(entry, user, timeoutMs);
      if (verdict === 'done') { result.synced++; useSyncStore.getState().incrementSynced(); }
      else if (verdict === 'rejected') result.rejected++;
      else if (verdict === 'stop') { result.waiting += pending.length - pending.indexOf(entry); break; }
      else result.waiting++;
    }
    await purgeDone(PURGE_AFTER_MS);
  } finally {
    const s = useSyncStore.getState();
    s.setProcessing(false);
    await refreshCounts();
  }
  return result;
}

export async function refreshCounts(): Promise<void> {
  const s = useSyncStore.getState();
  s.setPendingCount(await getPendingCount());
  s.setRejectedCount(await getRejectedCount());
}

type UploadVerdict = 'done' | 'rejected' | 'waiting' | 'stop';

async function uploadEntry(entry: SyncQueueEntry, user: SyncUser, timeoutMs: number): Promise<UploadVerdict> {
  const id = entry.id as number;
  await db.syncQueue.update(id, { status: 'SYNCING', attempts: entry.attempts + 1, claimedAt: Date.now() });

  try {
    const body = JSON.parse(entry.body) as Record<string, unknown>;
    // A manager uploading someone else's sale credits it to the cashier who made it.
    if (entry.userId && entry.userId !== user.id) body.onBehalfOfCashierId = entry.userId;
    if (entry.method !== 'POST') throw new Error(`Unsupported queued method ${entry.method}`);
    const data = await withTimeout(api.post<unknown>(entry.endpoint, body), timeoutMs);

    await db.syncQueue.update(id, {
      status: 'DONE',
      resultData: data === undefined ? undefined : JSON.stringify(data),
      processedAt: Date.now(),
      lastError: undefined,
      claimedAt: undefined,
    });
    if (entry.kind === 'SALE') void registerWithKra(data);
    return 'done';
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : 'Upload failed';
    const verdict = classifyFailure(err);
    const attempts = entry.attempts + 1;

    if (verdict === 'rejected') {
      await db.syncQueue.update(id, { status: 'FAILED', lastError: message, claimedAt: undefined });
      return 'rejected';
    }
    if (verdict === 'server-error') {
      const exhausted = attempts >= MAX_SERVER_ERROR_ATTEMPTS;
      await db.syncQueue.update(id, {
        status: exhausted ? 'FAILED' : 'PENDING',
        lastError: message,
        claimedAt: undefined,
        nextAttemptAt: Date.now() + SERVER_ERROR_BACKOFF_MS * attempts,
      });
      return exhausted ? 'rejected' : 'waiting';
    }
    // Lost connection or an expired login: not this entry's fault. Give the attempt back and stop for now.
    await db.syncQueue.update(id, { status: 'PENDING', attempts: entry.attempts, lastError: message, claimedAt: undefined });
    return 'stop';
  }
}

const KRA_REGISTER_TIMEOUT_MS = 15_000;

/**
 * A sale that was recorded late still has to be registered with KRA. Idempotent and best effort: it neither blocks
 * the queue nor can it hang it, and if it fails the batch submit picks the sale up.
 */
async function registerWithKra(saleResult: unknown): Promise<void> {
  const saleId = (saleResult as { id?: string } | undefined)?.id;
  if (!saleId) return;
  try { await withTimeout(api.post(`/etims/submit/${saleId}`), KRA_REGISTER_TIMEOUT_MS); } catch { /* batch submit */ }
}

/** Put a refused entry back in line, for example after the cause (stock, a price) was fixed. */
export async function retryEntry(id: number): Promise<void> {
  await db.syncQueue.update(id, { status: 'PENDING', attempts: 0, lastError: undefined, nextAttemptAt: 0, claimedAt: undefined });
  await refreshCounts();
  void processSyncQueue();
}

/** Remove an entry that can never upload. The sale it holds is NOT recorded anywhere else: callers must confirm. */
export async function discardEntry(id: number): Promise<void> {
  await db.syncQueue.delete(id);
  await refreshCounts();
}

// ─── Auto-sync ────────────────────────────────────────────────────────────────

let _syncInterval: ReturnType<typeof setInterval> | null = null;

export function initSyncEngine(): void {
  const { setOnline } = useSyncStore.getState();
  setOnline(isOnline());

  window.addEventListener('online', () => {
    useSyncStore.getState().setOnline(true);
    void processSyncQueue();
  });
  window.addEventListener('offline', () => setOnline(false));
  // Coming back to the tab after a long time (the laptop slept) is a good moment to upload.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void processSyncQueue();
  });

  // Signing in is when a manager's login becomes available to upload what others left behind.
  useAuthStore.subscribe((state, prev) => {
    if (state.user?.id && state.user.id !== prev.user?.id) void processSyncQueue();
  });

  _syncInterval = setInterval(() => {
    if (isOnline()) void processSyncQueue();
    else setOnline(false);
  }, 30_000);

  void refreshCounts();
  void processSyncQueue();
}

export function destroySyncEngine(): void {
  if (_syncInterval) {
    clearInterval(_syncInterval);
    _syncInterval = null;
  }
}
