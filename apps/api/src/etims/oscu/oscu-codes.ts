/**
 * KRA eTIMS (OSCU) code values and the arithmetic KRA expects, from chapter 4 of the OSCU specification v2.0.
 * Small fixed lists live here; big or changing lists (item classes, packaging and quantity units) come from KRA
 * through /selectCodeList and /selectItemClsList.
 */

export type OscuTaxType = 'A' | 'B' | 'C' | 'D' | 'E';
export const OSCU_TAX_TYPES: readonly OscuTaxType[] = ['A', 'B', 'C', 'D', 'E'];

/** Tax type (code class 04): A exempt, B standard 16%, C zero-rated, D non-VAT, E reduced 8%. */
export const OSCU_TAX_RATES: Record<OscuTaxType, number> = { A: 0, B: 16, C: 0, D: 0, E: 8 };

/** Sales receipt type (code class 37). */
export const RECEIPT_SALE = 'S';
export const RECEIPT_CREDIT_NOTE = 'R';
/** Transaction type (code class 14): N normal. */
export const SALES_TYPE_NORMAL = 'N';
/** Transaction status (code class 11): 02 approved. */
export const STATUS_APPROVED = '02';
/** Product type (code class 24); also the 3rd character of an item code. */
export const PRODUCT_FINISHED = '2';
export const PRODUCT_SERVICE = '3';
/** Registration type (code class 31). */
export const REG_MANUAL = 'M';

/** Credit note reason (code class 32). */
export const CREDIT_NOTE_REASON = {
  MISSING_QUANTITY: '01',
  MISSING_DATA: '02',
  DAMAGED: '03',
  WASTED: '04',
  RAW_MATERIAL_SHORTAGE: '05',
  REFUND: '06',
} as const;

/** Stock in/out type (code class 12): 0x incoming, 1x outgoing. */
export const STOCK_IO = {
  IMPORT: '01',
  PURCHASE: '02',
  RETURN_IN: '03',
  MOVE_IN: '04',
  PROCESSING_IN: '05',
  ADJUST_IN: '06',
  SALE: '11',
  RETURN_OUT: '12',
  MOVE_OUT: '13',
  PROCESSING_OUT: '14',
  DISCARD: '15',
  ADJUST_OUT: '16',
} as const;
export type StockIoType = (typeof STOCK_IO)[keyof typeof STOCK_IO];

/**
 * Which KRA stock type a movement in our ledger is. The sign of the quantity decides in or out where a type can go
 * both ways (adjustments, transfers, an opening balance).
 */
export function stockIoTypeFor(movementType: string, quantity: number): StockIoType {
  const incoming = quantity > 0;
  switch (movementType) {
    case 'GRN_RECEIPT':
    case 'BATCH_RECEIPT':
      return incoming ? STOCK_IO.PURCHASE : STOCK_IO.RETURN_OUT;
    case 'IMPORT':
      return incoming ? STOCK_IO.IMPORT : STOCK_IO.ADJUST_OUT;
    case 'SALE':
    case 'BUNDLE_SALE':
    case 'INTEGRATION_SALE':
    case 'LAYAWAY_RESERVE':
      return incoming ? STOCK_IO.RETURN_IN : STOCK_IO.SALE;
    case 'RETURN':
    case 'VOID':
    case 'LAYAWAY_RELEASE':
    case 'LAYAWAY_CANCEL':
      return incoming ? STOCK_IO.RETURN_IN : STOCK_IO.SALE;
    case 'RECIPE_DEDUCTION':
      return incoming ? STOCK_IO.PROCESSING_IN : STOCK_IO.PROCESSING_OUT;
    case 'DAMAGED':
    case 'EXPIRY_WRITE_OFF':
      return incoming ? STOCK_IO.ADJUST_IN : STOCK_IO.DISCARD;
    case 'TRANSFER':
      return incoming ? STOCK_IO.MOVE_IN : STOCK_IO.MOVE_OUT;
    case 'INITIAL':
    case 'ADJUSTMENT':
    default:
      return incoming ? STOCK_IO.ADJUST_IN : STOCK_IO.ADJUST_OUT;
  }
}

/** Payment method (code class 07). */
export const PAYMENT_TYPE = {
  CASH: '01',
  CREDIT: '02',
  CASH_CREDIT: '03',
  BANK_CHECK: '04',
  CARD: '05',
  MOBILE_MONEY: '06',
  OTHER: '07',
} as const;

// ─── Dates: Kenyan time (EAT, UTC+3 all year, no daylight saving) ─────────────

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function eatParts(d: Date) {
  const t = new Date(d.getTime() + EAT_OFFSET_MS);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
}

/** yyyyMMdd in Kenyan time. A sale at 22:30 in Nairobi is dated that day, not the UTC day before or after. */
export function kraDate(d: Date): string {
  const p = eatParts(d);
  return `${p.y}${pad(p.mo)}${pad(p.d)}`;
}

/** yyyyMMddHHmmss in Kenyan time. */
export function kraDateTime(d: Date): string {
  const p = eatParts(d);
  return `${p.y}${pad(p.mo)}${pad(p.d)}${pad(p.h)}${pad(p.mi)}${pad(p.s)}`;
}

/** Parse KRA's yyyyMMddHHmmss (Kenyan time) back to a Date. */
export function parseKraDateTime(s: string | null | undefined): Date | null {
  if (!s || !/^\d{14}$/.test(s.trim())) return null;
  const v = s.trim();
  const utc = Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10), +v.slice(10, 12), +v.slice(12, 14));
  return new Date(utc - EAT_OFFSET_MS);
}

// ─── Money: everything in whole cents until the moment it is sent ─────────────

/** Cents to the KES number KRA wants (at most two decimal places, exact). */
export const kes = (cents: number): number => Math.round(cents) / 100;

/** Round half up to a whole cent (KRA rounds each line half up). */
export const roundCents = (x: number): number => Math.floor(x + 0.5 + 1e-9);

/** The VAT inside a VAT-inclusive amount: amount x rate / (100 + rate), rounded half up to the cent. */
export function taxIncludedCents(amountCents: number, ratePct: number): number {
  if (ratePct === 0) return 0;
  return roundCents((amountCents * ratePct) / (100 + ratePct));
}

/** The amount fields of one invoice line, in cents, the way KRA computes them (all VAT-inclusive). */
export interface OscuLineAmounts {
  supplyCents: number;   // splyAmt = qty x prc
  discountCents: number; // dcAmt
  taxableCents: number;  // taxblAmt = supply - discount (VAT included)
  taxCents: number;      // taxAmt  = the VAT inside taxblAmt
  totalCents: number;    // totAmt  = taxblAmt
}

/**
 * A line from what the customer actually paid. `unitPriceCents` is the shelf price (VAT included) and
 * `paidCents` what the line cost after its discount. KRA checks taxblAmt = splyAmt - dcAmt and totAmt = taxblAmt.
 */
export function lineAmounts(qty: number, unitPriceCents: number, paidCents: number, taxType: OscuTaxType): OscuLineAmounts {
  let supplyCents = roundCents(qty * unitPriceCents);
  // A price raised at the till (or a rounding cent) must not become a negative discount.
  if (supplyCents < paidCents) supplyCents = paidCents;
  const discountCents = supplyCents - paidCents;
  const taxableCents = paidCents;
  return { supplyCents, discountCents, taxableCents, taxCents: taxIncludedCents(taxableCents, OSCU_TAX_RATES[taxType]), totalCents: taxableCents };
}

/** The fifteen per-tax-type fields plus the three totals, from rounded lines (so header and lines always agree). */
export function invoiceTotals(lines: Array<{ taxType: OscuTaxType; amounts: OscuLineAmounts }>) {
  const taxable: Record<OscuTaxType, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const tax: Record<OscuTaxType, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const l of lines) {
    taxable[l.taxType] += l.amounts.taxableCents;
    tax[l.taxType] += l.amounts.taxCents;
  }
  const out: Record<string, number> = {};
  for (const t of OSCU_TAX_TYPES) {
    out[`taxblAmt${t}`] = kes(taxable[t]);
    out[`taxRt${t}`] = OSCU_TAX_RATES[t];
    out[`taxAmt${t}`] = kes(tax[t]);
  }
  const totTaxbl = OSCU_TAX_TYPES.reduce((s, t) => s + taxable[t], 0);
  const totTax = OSCU_TAX_TYPES.reduce((s, t) => s + tax[t], 0);
  out.totTaxblAmt = kes(totTaxbl);
  out.totTaxAmt = kes(totTax);
  out.totAmt = kes(totTaxbl);
  return out;
}

/** A KRA PIN: a letter, nine digits, a letter (e.g. P051234567A). */
export const isKraPin = (pin: string | null | undefined): boolean => !!pin && /^[A-Z]\d{9}[A-Z]$/.test(pin.trim().toUpperCase());

/**
 * KRA's recommended item code (spec 4.19): origin country, product type, packaging unit, quantity unit, then a
 * 7-digit running number. makeItemCode('2', 'NT', 'U', 12) is "KE2NTU0000012".
 */
export function makeItemCode(productType: string, pkgUnitCd: string, qtyUnitCd: string, seq: number, origin = 'KE'): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 9_999_999) throw new Error('Item code sequence must be 1 to 9999999');
  const code = `${origin}${productType}${pkgUnitCd}${qtyUnitCd}${String(seq).padStart(7, '0')}`;
  if (code.length > 20) throw new Error(`Item code ${code} is longer than 20 characters`);
  return code;
}
