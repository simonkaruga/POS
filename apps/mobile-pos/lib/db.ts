/**
 * Offline storage using AsyncStorage (since expo-sqlite is not installed).
 * Queues failed sales for retry and caches items locally.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SALES_QUEUE_KEY = 'faida:sales_queue';
const ITEMS_CACHE_KEY = 'faida:items_cache';

export interface QueuedSale {
  id: number;
  offlineId: string;
  payload: object;
  createdAt: string;
  synced: boolean;
  attempts?: number;
  lastError?: string;
  /** The server refused this sale (a 4xx): retrying the same request cannot help, so it waits for a person. */
  rejected?: boolean;
}

export interface QueueStatus {
  pending: number;
  rejected: Array<{ offlineId: string; createdAt: string; error: string; totalCents?: number }>;
}

type QueueListener = (status: QueueStatus) => void;
const listeners = new Set<QueueListener>();

// ─── Sales Queue ─────────────────────────────────────────────────────────────

async function getSalesQueue(): Promise<QueuedSale[]> {
  try {
    const raw = await AsyncStorage.getItem(SALES_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function statusOf(queue: QueuedSale[]): QueueStatus {
  const open = queue.filter((q) => !q.synced);
  return {
    pending: open.filter((q) => !q.rejected).length,
    rejected: open
      .filter((q) => q.rejected)
      .map((q) => ({
        offlineId: q.offlineId,
        createdAt: q.createdAt,
        error: q.lastError ?? 'Rejected by the server',
        totalCents: (q.payload as { payments?: Array<{ amountCents?: number }> }).payments?.reduce((s, p) => s + (p.amountCents ?? 0), 0),
      })),
  };
}

async function saveSalesQueue(queue: QueuedSale[]): Promise<void> {
  await AsyncStorage.setItem(SALES_QUEUE_KEY, JSON.stringify(queue));
  const status = statusOf(queue);
  listeners.forEach((l) => l(status));
}

export async function getQueueStatus(): Promise<QueueStatus> {
  return statusOf(await getSalesQueue());
}

/** Calls back with the current status now and after every change. Returns the unsubscribe function. */
export function subscribeSalesQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  void getQueueStatus().then(listener);
  return () => { listeners.delete(listener); };
}

export async function queueSale(offlineId: string, payload: object): Promise<void> {
  const queue = await getSalesQueue();
  // Avoid duplicates
  if (queue.some((q) => q.offlineId === offlineId)) return;
  const newEntry: QueuedSale = {
    id: Date.now(),
    offlineId,
    payload,
    createdAt: new Date().toISOString(),
    synced: false,
  };
  queue.push(newEntry);
  await saveSalesQueue(queue);
}

/** Sales still waiting to reach the server and worth trying again (oldest first). */
export async function getPendingSales(): Promise<QueuedSale[]> {
  const queue = await getSalesQueue();
  return queue.filter((q) => !q.synced && !q.rejected);
}

/** Remember why an attempt failed. `rejected` parks the sale for a person instead of retrying it forever. */
export async function recordSaleFailure(offlineId: string, error: string, rejected: boolean): Promise<void> {
  const queue = await getSalesQueue();
  await saveSalesQueue(
    queue.map((q) => (q.offlineId === offlineId ? { ...q, attempts: (q.attempts ?? 0) + 1, lastError: error.slice(0, 300), rejected } : q)),
  );
}

/** Put a rejected sale back in line, e.g. after the cause (stock, a price) was fixed on the server. */
export async function requeueRejectedSale(offlineId: string): Promise<void> {
  const queue = await getSalesQueue();
  await saveSalesQueue(queue.map((q) => (q.offlineId === offlineId ? { ...q, rejected: false, lastError: undefined } : q)));
}

export async function markSaleSynced(offlineId: string): Promise<void> {
  const queue = await getSalesQueue();
  const updated = queue.map((q) =>
    q.offlineId === offlineId ? { ...q, synced: true } : q
  );
  await saveSalesQueue(updated);
}

export async function clearSyncedSales(): Promise<void> {
  const queue = await getSalesQueue();
  const pending = queue.filter((q) => !q.synced);
  await saveSalesQueue(pending);
}

// ─── Items Cache ──────────────────────────────────────────────────────────────

export async function cacheItems(items: object[]): Promise<void> {
  try {
    await AsyncStorage.setItem(ITEMS_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Silently fail cache writes
  }
}

export async function getCachedItems(): Promise<object[]> {
  try {
    const raw = await AsyncStorage.getItem(ITEMS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearItemsCache(): Promise<void> {
  await AsyncStorage.removeItem(ITEMS_CACHE_KEY);
}
