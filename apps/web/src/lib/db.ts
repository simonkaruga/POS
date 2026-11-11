/**
 * Dexie (IndexedDB) database — offline-first local store
 * Mirrors the server data for offline POS operation.
 */
import Dexie, { type Table } from 'dexie';

// ─── Cached item (from server) ────────────────────────────────────────────────
export interface CachedItem {
  id: string;
  businessId: string;
  storeId: string;
  name: string;
  category?: string;
  barcode?: string;
  type: string;
  retailPriceCents: number;
  wholesalePriceCents?: number;
  vipPriceCents?: number;
  costPriceCents?: number;
  vatApplicable: boolean;
  /** KRA tax class (A/B/C/D); absent on items cached before classes existed. */
  taxClass?: string;
  totApplicable: boolean;
  trackStock: boolean;
  currentStock: number;
  syncedAt: number; // timestamp
}

// ─── Cached customer ──────────────────────────────────────────────────────────
export interface CachedCustomer {
  id: string;
  businessId: string;
  name: string;
  phone?: string;
  email?: string;
  creditLimitCents: number;
  balanceCents: number;
  loyaltyPoints: number;
  syncedAt: number;
}

// ─── Sync queue entry ─────────────────────────────────────────────────────────
export type SyncPriority = 'HIGH' | 'NORMAL';
export type SyncStatus = 'PENDING' | 'SYNCING' | 'DONE' | 'FAILED';

export type SyncKind = 'SALE' | 'OTHER';

/** What the offline-sales list shows, kept on the entry so it needs no network to display. */
export interface OfflineSaleSummary {
  /** The number printed on the provisional receipt, e.g. OFF-3F9A12BC. The real one is assigned when it uploads. */
  provisionalNumber: string;
  totalCents: number;
  itemCount: number;
  customerName?: string;
  paymentMethods: string[];
}

/**
 * Status: PENDING = waiting to upload (offline, or the next retry is due); SYNCING = an upload is in progress;
 * DONE = recorded on the server; FAILED = the SERVER REFUSED it (or it kept erroring), so it waits for a person.
 * A lost connection never moves an entry to FAILED.
 */
export interface SyncQueueEntry {
  id?: number;             // auto-increment PK
  offlineId: string;       // UUID — idempotency key
  priority: SyncPriority;  // HIGH = eTIMS, voids; NORMAL = everything else
  endpoint: string;        // e.g. '/sales/checkout'
  method: 'POST' | 'PATCH' | 'DELETE';
  body: string;            // JSON-encoded request body
  status: SyncStatus;
  attempts: number;
  lastError?: string;
  resultData?: string;     // JSON-encoded response when DONE
  createdAt: number;       // Date.now()
  processedAt?: number;
  kind?: SyncKind;
  /** Who made the sale, so it is credited to them even when someone else signs in and uploads it. */
  userId?: string;
  userName?: string;
  businessId?: string;
  storeId?: string;
  summary?: OfflineSaleSummary;
  /** When the current upload started; an upload silent for a minute is treated as abandoned (tab closed). */
  claimedAt?: number;
  /** Do not try again before this time (server errors back off). */
  nextAttemptAt?: number;
}

// ─── Metadata ─────────────────────────────────────────────────────────────────
export interface MetaEntry {
  key: string;
  value: string | number;
}

// ─── Dexie database ───────────────────────────────────────────────────────────
class POSDatabase extends Dexie {
  items!: Table<CachedItem>;
  customers!: Table<CachedCustomer>;
  syncQueue!: Table<SyncQueueEntry>;
  meta!: Table<MetaEntry>;

  constructor() {
    super('FaidaPOSDB');

    this.version(1).stores({
      items: 'id, businessId, storeId, [businessId+storeId], barcode, category',
      customers: 'id, businessId, phone',
      syncQueue: '++id, offlineId, priority, status, createdAt',
      meta: 'key',
    });
  }
}

export const db = new POSDatabase();

// ─── Convenience helpers ──────────────────────────────────────────────────────

/** Get all items for a store from IndexedDB cache */
export async function getCachedItems(businessId: string, storeId: string): Promise<CachedItem[]> {
  return db.items.where('[businessId+storeId]').equals([businessId, storeId]).toArray();
}

/** Upsert items into IndexedDB cache */
export async function cacheItems(items: CachedItem[]): Promise<void> {
  await db.items.bulkPut(items);
}

/** Get all customers for a business from IndexedDB cache */
export async function getCachedCustomers(businessId: string): Promise<CachedCustomer[]> {
  return db.customers.where('businessId').equals(businessId).toArray();
}

/** Upsert customers into IndexedDB cache */
export async function cacheCustomers(customers: CachedCustomer[]): Promise<void> {
  await db.customers.bulkPut(customers);
}

/** Add an operation to the sync queue */
export async function enqueue(entry: Omit<SyncQueueEntry, 'id' | 'attempts' | 'status' | 'createdAt'>): Promise<void> {
  await db.syncQueue.add({
    ...entry,
    attempts: 0,
    status: 'PENDING',
    createdAt: Date.now(),
  });
}

/** An upload that has been silent this long is assumed dead (tab closed, laptop slept) and may be taken again. */
export const STALE_SYNCING_MS = 60_000;

/** Entries ready to upload now: waiting ones whose retry time has come, plus abandoned uploads. HIGH priority first. */
export async function getPendingQueue(now: number = Date.now()): Promise<SyncQueueEntry[]> {
  const all = await db.syncQueue.where('status').anyOf(['PENDING', 'SYNCING']).toArray();
  const ready = all.filter((e) => {
    if (e.status === 'SYNCING') return now - (e.claimedAt ?? 0) > STALE_SYNCING_MS;
    return (e.nextAttemptAt ?? 0) <= now;
  });
  return ready.sort((a, b) => {
    if (a.priority === 'HIGH' && b.priority !== 'HIGH') return -1;
    if (b.priority === 'HIGH' && a.priority !== 'HIGH') return 1;
    return a.createdAt - b.createdAt;
  });
}

/** Waiting or uploading. */
export async function getPendingCount(): Promise<number> {
  return db.syncQueue.where('status').anyOf(['PENDING', 'SYNCING']).count();
}

/** Refused or exhausted: needs a person. */
export async function getRejectedCount(): Promise<number> {
  return db.syncQueue.where('status').equals('FAILED').count();
}

/** Forget uploads that finished long ago. Recent ones stay so a provisional receipt can be matched to its real number. */
export async function purgeDone(olderThanMs: number, now: number = Date.now()): Promise<void> {
  const cutoff = now - olderThanMs;
  await db.syncQueue.where('status').equals('DONE').and((e) => (e.processedAt ?? e.createdAt) < cutoff).delete();
}
