// ============================================================
// @pos/shared — Single source of truth for types, enums, utils
// ============================================================

// ─── ENUMS ───────────────────────────────────────────────────

export enum SaleStatus {
  DRAFT = 'DRAFT',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  CREDIT = 'CREDIT',
  PARTIAL_PAYMENT = 'PARTIAL_PAYMENT',
  RESERVED = 'RESERVED',
  PROFORMA = 'PROFORMA',
  VOIDED = 'VOIDED',
  AMENDED = 'AMENDED',
}

export enum SaleType {
  NORMAL = 'NORMAL',
  CREDIT = 'CREDIT',
  LAYAWAY = 'LAYAWAY',
  PROFORMA = 'PROFORMA',
  SERVICE = 'SERVICE',
  INTEGRATION = 'INTEGRATION',
}

export enum ItemType {
  PRODUCT = 'PRODUCT',
  SERVICE = 'SERVICE',
  WEIGHTED = 'WEIGHTED',
  BUNDLE = 'BUNDLE',
  RECIPE = 'RECIPE',
}

export enum InventoryMovementType {
  INITIAL = 'INITIAL',
  SALE = 'SALE',
  RETURN = 'RETURN',
  VOID = 'VOID',
  ADJUSTMENT = 'ADJUSTMENT',
  IMPORT = 'IMPORT',
  INTEGRATION_SALE = 'INTEGRATION_SALE',
  LAYAWAY_RESERVE = 'LAYAWAY_RESERVE',
  LAYAWAY_RELEASE = 'LAYAWAY_RELEASE',
  LAYAWAY_CANCEL = 'LAYAWAY_CANCEL',
  BUNDLE_SALE = 'BUNDLE_SALE',
  RECIPE_DEDUCTION = 'RECIPE_DEDUCTION',
  BATCH_RECEIPT = 'BATCH_RECEIPT',
  EXPIRY_WRITE_OFF = 'EXPIRY_WRITE_OFF',
  GRN_RECEIPT = 'GRN_RECEIPT',
  TRANSFER = 'TRANSFER',
}

export enum OrderStatus {
  OPEN = 'OPEN',
  BILL_REQUESTED = 'BILL_REQUESTED',
  PAID = 'PAID',
  VOIDED = 'VOIDED',
}

export enum POSMode {
  RETAIL = 'RETAIL',
  HOSPITALITY = 'HOSPITALITY',
  FAST_FOOD = 'FAST_FOOD',
  SUPERMARKET = 'SUPERMARKET',
  SALON = 'SALON',
  CLINIC = 'CLINIC',
  FUEL_PUMP = 'FUEL_PUMP',
  CYBERCAFE = 'CYBERCAFE',
}

export enum TableStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  BILL_REQUESTED = 'BILL_REQUESTED',
  RESERVED = 'RESERVED',
}

export enum POStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

export enum VoidType {
  FULL_VOID = 'FULL_VOID',
  LINE_ITEM_VOID = 'LINE_ITEM_VOID',
}

export enum PrintJobType {
  KOT_FOOD = 'KOT_FOOD',
  KOT_DRINKS = 'KOT_DRINKS',
  KOT_DESSERTS = 'KOT_DESSERTS',
  BILL = 'BILL',
  RECEIPT = 'RECEIPT',
  AMENDED_RECEIPT = 'AMENDED_RECEIPT',
  PROFORMA = 'PROFORMA',
  LABEL = 'LABEL',
  X_REPORT = 'X_REPORT',
  Z_REPORT = 'Z_REPORT',
}

export enum UserRole {
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  ACCOUNTANT = 'ACCOUNTANT',
  CASHIER = 'CASHIER',
  WAITER = 'WAITER',
  KITCHEN = 'KITCHEN',
  /** Delivery driver — signs in on the Faida Driver app with email + password. */
  DRIVER = 'DRIVER',
  /** Field sales agent — signs in on the Faida Agent app with email + password. */
  SALES_AGENT = 'SALES_AGENT',
}

/** Roles whose staff work exclusively in a companion mobile app. */
export const FIELD_ROLES: UserRole[] = [UserRole.DRIVER, UserRole.SALES_AGENT];

export enum ExpenseApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum LeaveType {
  ANNUAL = 'ANNUAL',
  SICK = 'SICK',
  UNPAID = 'UNPAID',
}

export enum BatchStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  RECALLED = 'RECALLED',
}

export enum PriceLevel {
  RETAIL = 'RETAIL',
  WHOLESALE = 'WHOLESALE',
  VIP = 'VIP',
}

export enum PaymentMethod {
  CASH = 'CASH',
  MPESA_STK = 'MPESA_STK',
  MPESA_QR = 'MPESA_QR',
  CARD = 'CARD',
  CREDIT = 'CREDIT',
  STORE_CREDIT = 'STORE_CREDIT',
  ROOM_CHARGE = 'ROOM_CHARGE',
  LAYAWAY_DEPOSIT = 'LAYAWAY_DEPOSIT',
  GIFT_CARD = 'GIFT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

export enum TaxType {
  VAT = 'VAT',
  TOT = 'TOT',
  NONE = 'NONE',
}

export enum NegativeStockPolicy {
  BLOCK = 'BLOCK',
  WARN = 'WARN',
  ALLOW = 'ALLOW',
}

// ─── SUBSCRIPTION FEATURES ──────────────────────────────────

export * from './src/permissions/subscription-features';

// ─── PERMISSIONS ─────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  [UserRole.OWNER]: ['*'],
  [UserRole.MANAGER]: [
    'pos.*', 'inventory.*', 'reports.*', 'cash-drawer.*',
    'customers.*', 'expenses.read', 'expenses.create',
    'voids.*', 'hr.read', 'suppliers.read',
  ],
  [UserRole.ACCOUNTANT]: [
    'reports.financial.*',
    'reports.sales.read',
    'expenses.read',
    'suppliers.ledger.read',
  ],
  [UserRole.CASHIER]: [
    'pos.*', 'customers.read', 'customers.create',
    'cash-drawer.own.*', 'reports.own.*',
  ],
  [UserRole.WAITER]: [
    'hospitality.orders.*',
    'hospitality.tables.read',
  ],
  [UserRole.KITCHEN]: [
    'hospitality.kds.read',
    'hospitality.kds.update',
  ],
  [UserRole.DRIVER]: [
    'delivery.own.*',
    'delivery.runs.read',
    'delivery.proof.create',
    'customers.read',
  ],
  [UserRole.SALES_AGENT]: [
    'field-sales.own.*',
    'field-sales.orders.create',
    'field-sales.customers.*',
    'customers.read', 'customers.create',
    'inventory.read',
  ],
};

// ─── MONEY UTILS ─────────────────────────────────────────────

/** Format cents as KES string. KES 150.00 stored as 15000 cents. */
export function formatKES(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function decimalToCents(amount: number): number {
  return Math.round(amount * 100);
}

export function centsToDec(cents: number): number {
  return cents / 100;
}

/** Weight pricing: weight in grams × price per KG. Rounds to nearest KES 0.50 */
export function calculateWeightedPrice(
  weightGrams: number,
  pricePerKgCents: number,
): number {
  const rawCents = Math.round((weightGrams / 1000) * pricePerKgCents);
  return Math.round(rawCents / 50) * 50;
}

// ─── TAX UTILS ───────────────────────────────────────────────

/** Extract the VAT component from a VAT-inclusive amount (16% rate). */
export function calculateVAT(inclusiveAmountCents: number): number {
  return Math.round(inclusiveAmountCents * 16 / 116);
}

/** Extract the TOT component from a TOT-inclusive amount. Rate defaults to KRA Finance Act 2023 rate of 3%. */
export function calculateTOT(inclusiveAmountCents: number, ratePct = 3): number {
  return Math.round(inclusiveAmountCents * ratePct / (100 + ratePct));
}

// ─── TAX CLASSES ─────────────────────────────────────────────
//
// Kenya taxes supplies at different rates, and the tax invoice must say which: flour and unprocessed foods
// are exempt, many medicines are exempt or zero-rated, most goods are standard-rated at 16%. An item carries
// one class, and every sale line snapshots it, so a later change to the item never rewrites a past invoice.

/** A = exempt, B = standard rate (16%), C = zero-rated (0%), D = not subject to VAT. The letters are eTIMS's. */
export type TaxClass = 'A' | 'B' | 'C' | 'D';

export const TAX_CLASSES: readonly TaxClass[] = ['A', 'B', 'C', 'D'];

export const STANDARD_VAT_RATE_PCT = 16;

export const TAX_CLASS_INFO: Record<TaxClass, { label: string; short: string; ratePct: number }> = {
  A: { label: 'Exempt', short: 'Exempt', ratePct: 0 },
  B: { label: 'Standard rate (16%)', short: '16%', ratePct: STANDARD_VAT_RATE_PCT },
  C: { label: 'Zero-rated (0%)', short: '0%', ratePct: 0 },
  D: { label: 'Not subject to VAT', short: 'Non-VAT', ratePct: 0 },
};

export function isTaxClass(value: unknown): value is TaxClass {
  return typeof value === 'string' && (TAX_CLASSES as readonly string[]).includes(value);
}

/**
 * An item's tax class: its own class, else standard-rated. The older yes/no `vatApplicable` flag is NOT consulted:
 * the create form defaulted it to unchecked, so `false` usually means nobody chose, not "exempt". Treating it as
 * exempt would under-declare VAT. (The parameter still accepts it so callers can pass a whole item.)
 */
export function taxClassOf(item: { taxClass?: string | null; vatApplicable?: boolean | null }): TaxClass {
  return isTaxClass(item.taxClass) ? item.taxClass : 'B';
}

/**
 * A tax class typed by a person (a spreadsheet column): the letter, or the word. Blank is "not said" (undefined);
 * anything unrecognised returns null so the caller can reject the row instead of guessing.
 */
export function parseTaxClass(input: unknown): TaxClass | undefined | null {
  const t = String(input ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!t) return undefined;
  if (['a', 'exempt', 'vat exempt', 'exempted'].includes(t)) return 'A';
  if (['b', 'standard', 'standard rate', 'standard rated', 'vat', '16', '16%', 'taxable'].includes(t)) return 'B';
  if (['c', 'zero', 'zero rated', 'zero rate', '0', '0%'].includes(t)) return 'C';
  if (['d', 'none', 'non vat', 'not vat', 'no vat', 'out of scope', 'not subject to vat'].includes(t)) return 'D';
  return null;
}

export interface TaxLineInput { totalCents: number; taxClass: TaxClass }
export interface TaxLineResult {
  /** The class the line was taxed under: `D` for every line when the business is not VAT-registered. */
  taxClass: TaxClass;
  /** This line's share of the sale-level discount. */
  discountCents: number;
  /** What the customer pays for the line after its discount share, VAT included. */
  netCents: number;
  vatCents: number;
}
export interface TaxSummary {
  lines: TaxLineResult[];
  vatCents: number;
  byClass: Record<TaxClass, { netCents: number; vatCents: number }>;
}

/**
 * Split `amountCents` across lines in proportion to `values`, to the cent: the shares always add up to the
 * amount (largest remainder), never more than a line is worth. Used to spread a sale-level discount.
 */
export function allocateByValue(values: number[], amountCents: number): number[] {
  const weights = values.map((v) => Math.max(0, v));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(amountCents > 0) || total <= 0) return values.map(() => 0);
  const amount = Math.min(Math.round(amountCents), total);
  const exact = weights.map((w) => (w * amount) / total);
  const shares = exact.map((e) => Math.floor(e));
  let left = amount - shares.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((x, y) => y.r - x.r || x.i - y.i);
  for (let k = 0; left > 0 && k < byRemainder.length; k++, left--) shares[byRemainder[k].i] += 1;
  // A line can never take more than it is worth.
  return shares.map((sh, i) => Math.min(sh, weights[i]));
}

/**
 * VAT for a sale, line by line. Prices include VAT, so VAT is extracted (16/116) from standard-rated lines only,
 * after each line's share of the discount. Exempt, zero-rated and non-VAT lines carry none. A business that is
 * not VAT-registered charges no VAT on anything, and every line is class D.
 */
export function computeTaxes(lines: TaxLineInput[], discountCents: number, opts: { vatRegistered: boolean }): TaxSummary {
  const shares = allocateByValue(lines.map((l) => l.totalCents), discountCents);
  const byClass: TaxSummary['byClass'] = { A: { netCents: 0, vatCents: 0 }, B: { netCents: 0, vatCents: 0 }, C: { netCents: 0, vatCents: 0 }, D: { netCents: 0, vatCents: 0 } };
  const results = lines.map((l, i): TaxLineResult => {
    const taxClass: TaxClass = opts.vatRegistered ? l.taxClass : 'D';
    const netCents = l.totalCents - shares[i];
    const vatCents = taxClass === 'B' ? Math.round((netCents * STANDARD_VAT_RATE_PCT) / (100 + STANDARD_VAT_RATE_PCT)) : 0;
    byClass[taxClass].netCents += netCents;
    byClass[taxClass].vatCents += vatCents;
    return { taxClass, discountCents: shares[i], netCents, vatCents };
  });
  return { lines: results, vatCents: results.reduce((a, r) => a + r.vatCents, 0), byClass };
}

export function calculateServiceCharge(
  subtotalCents: number,
  rate: number, // e.g. 10 for 10%
): number {
  return Math.round(subtotalCents * (rate / 100));
}

// ─── DATE UTILS ──────────────────────────────────────────────

export function isExpired(expiryDate: Date | null | undefined): boolean {
  if (!expiryDate) return false;
  return new Date() > new Date(expiryDate);
}

export function isExpiringSoon(
  expiryDate: Date | null | undefined,
  daysThreshold: number,
): boolean {
  if (!expiryDate) return false;
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + daysThreshold);
  return new Date(expiryDate) <= threshold;
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── RECEIPT NUMBER UTILS ─────────────────────────────────────
// Generated server-side only. Formats shown here for display purposes.

export function formatReceiptNumber(
  storeCode: string,
  year: number,
  sequence: number,
): string {
  return `${storeCode}-${year}-${String(sequence).padStart(7, '0')}`;
}

export function formatPONumber(year: number, sequence: number): string {
  return `PO-${year}-${String(sequence).padStart(5, '0')}`;
}

// ─── KITCHEN TICKETS (KOT) ────────────────────────────────────
// One ticket per preparation station, so the bar can mark drinks ready without
// touching the kitchen's food. Shared so the API (which splits tickets), the web
// printer (which routes them) and the displays agree on one vocabulary.

export const KOT_STATIONS = ['KITCHEN', 'BAR', 'DESSERT'] as const;
export type KotStation = (typeof KOT_STATIONS)[number];

export const KOT_STATION_LABELS: Record<KotStation, string> = {
  KITCHEN: 'Kitchen',
  BAR: 'Bar',
  DESSERT: 'Dessert',
};

/** The printer handle (Settings -> Printers) that serves each station. */
export const KOT_STATION_PRINTER_HANDLE: Record<KotStation, string> = {
  KITCHEN: 'KOT_FOOD',
  BAR: 'KOT_DRINKS',
  DESSERT: 'KOT_DESSERTS',
};

export function normalizeStation(raw?: string | null): KotStation | null {
  const upper = (raw ?? '').trim().toUpperCase();
  return (KOT_STATIONS as readonly string[]).includes(upper) ? (upper as KotStation) : null;
}

const DESSERT_WORDS = ['dessert', 'cake', 'ice cream', 'icecream', 'sweet', 'pastry', 'pudding', 'brownie', 'cheesecake', 'gelato', 'sundae'];
const DRINK_WORDS = [
  'drink', 'beverage', 'juice', 'soda', 'water', 'beer', 'lager', 'cider', 'wine', 'spirit', 'whisky', 'whiskey',
  'vodka', 'gin', 'rum', 'brandy', 'tequila', 'liqueur', 'cognac', 'champagne', 'cocktail', 'mocktail', 'shot',
  'coffee', 'espresso', 'latte', 'cappuccino', 'tea', 'chai', 'dawa', 'milk', 'smoothie', 'shake',
  'coke', 'coca', 'fanta', 'sprite', 'pepsi', 'mirinda', 'stoney', 'krest', 'schweppes', 'minute maid', 'predator',
  'red bull', 'redbull', 'monster', 'tusker', 'pilsner', 'guinness', 'white cap', 'whitecap', 'balozi', 'castle',
  'heineken', 'smirnoff', 'savanna', 'hunters', 'kenya cane', 'chrome', 'johnnie', 'jameson', 'jack daniel',
  'captain morgan', 'bacardi', 'gilbey', 'amarula', 'baileys',
];

function matchesAny(target: string, words: string[]): boolean {
  // Match at the start of a word so "tea" finds "tea" and "teas" but not "steak",
  // and "gin" finds "gin and tonic" but not "ginger".
  return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?\\b`, 'i').test(target));
}

/**
 * Work out which station makes an item when nobody has set one.
 *
 * The category is the stronger signal (a "Beverages" shelf holds drinks whatever
 * they are called), so it is tried first and the name is the fallback. Anything
 * unrecognised goes to the kitchen: a food ticket in the wrong place is noticed
 * at once, a missing one is not.
 */
export function inferStation(name: string, category?: string | null): KotStation {
  for (const target of [category ?? '', name]) {
    if (!target) continue;
    if (matchesAny(target, DESSERT_WORDS)) return 'DESSERT';
    if (matchesAny(target, DRINK_WORDS)) return 'BAR';
  }
  return 'KITCHEN';
}

/** The station an item belongs to: the one set on it, else the best guess. */
export function stationForItem(item: { name: string; category?: string | null; station?: string | null }): KotStation {
  return normalizeStation(item.station) ?? inferStation(item.name, item.category);
}

export type KotStatus = 'PENDING' | 'IN_PROGRESS' | 'READY' | 'SERVED' | 'CANCELLED';

/** Tickets that still need someone's attention (anything else is finished). */
export const OPEN_KOT_STATUSES: readonly KotStatus[] = ['PENDING', 'IN_PROGRESS', 'READY'];

/**
 * Where a ticket may go from each status. READY -> IN_PROGRESS is a recall (the
 * dish was bumped by mistake or sent back); PENDING -> READY lets a bar tap once
 * for a drink that needs no cooking. SERVED and CANCELLED are final.
 */
export const KOT_TRANSITIONS: Record<KotStatus, readonly KotStatus[]> = {
  PENDING: ['IN_PROGRESS', 'READY', 'CANCELLED'],
  IN_PROGRESS: ['READY', 'CANCELLED'],
  READY: ['SERVED', 'IN_PROGRESS', 'CANCELLED'],
  SERVED: [],
  CANCELLED: [],
};

export function isKotStatus(value: unknown): value is KotStatus {
  return typeof value === 'string' && value in KOT_TRANSITIONS;
}

export function canTransitionKot(from: KotStatus, to: KotStatus): boolean {
  return KOT_TRANSITIONS[from].includes(to);
}

// ─── OPTIONAL MODULES ─────────────────────────────────────────
// A business has one posMode (its main till), but real businesses are mixed: a
// fuel station with a restaurant, a hotel with a shop. A module switches a
// capability on for a business whatever its posMode, instead of forcing the
// owner to pick one vertical.

export const OPTIONAL_MODULES = ['RESTAURANT', 'HOTEL'] as const;
export type OptionalModule = (typeof OPTIONAL_MODULES)[number];

export const OPTIONAL_MODULE_LABELS: Record<OptionalModule, { label: string; description: string }> = {
  RESTAURANT: {
    label: 'Restaurant & kitchen',
    description: 'Tables, bar tabs, kitchen tickets and the kitchen display, alongside your main till.',
  },
  HOTEL: {
    label: 'Hotel & rooms',
    description: 'Rooms, bookings, guest folios and housekeeping, alongside your main till.',
  },
};

/** posModes whose main till already is the restaurant. */
export const RESTAURANT_POS_MODES: readonly string[] = ['HOSPITALITY', 'FAST_FOOD', 'BAR_TAB'];

/** posModes whose main till already includes the hotel. */
export const HOTEL_POS_MODES: readonly string[] = ['HOSPITALITY'];

/** True when the main till already provides the module, so it needs no switch of its own. */
export function moduleIncludedByMode(module: OptionalModule, posMode?: string | null): boolean {
  const mode = (posMode ?? '').toUpperCase();
  return module === 'RESTAURANT' ? RESTAURANT_POS_MODES.includes(mode) : HOTEL_POS_MODES.includes(mode);
}

/** Parse the stored JSON list, ignoring anything that is not a known module. */
export function parseEnabledModules(raw?: string | string[] | null): OptionalModule[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list.filter((m): m is OptionalModule => (OPTIONAL_MODULES as readonly string[]).includes(m as string));
}

function hasModule(module: OptionalModule, posMode?: string | null, enabledModules?: string | string[] | null): boolean {
  return moduleIncludedByMode(module, posMode) || parseEnabledModules(enabledModules).includes(module);
}

/** True when tables, bar tabs and kitchen tickets are available to this business. */
export function hasRestaurantAccess(posMode?: string | null, enabledModules?: string | string[] | null): boolean {
  return hasModule('RESTAURANT', posMode, enabledModules);
}

/** True when rooms, bookings, folios and housekeeping are available to this business. */
export function hasHotelAccess(posMode?: string | null, enabledModules?: string | string[] | null): boolean {
  return hasModule('HOTEL', posMode, enabledModules);
}
