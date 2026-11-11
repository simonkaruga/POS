/**
 * Request bodies for KRA eTIMS OSCU, built from plain data so they can be checked without KRA.
 * Field names, lengths and formats follow the OSCU specification v2.0. Amounts are VAT-inclusive, as eTIMS requires.
 */
import {
  OscuTaxType, OscuLineAmounts, lineAmounts, invoiceTotals, kes, kraDate, kraDateTime,
  RECEIPT_CREDIT_NOTE, RECEIPT_SALE, SALES_TYPE_NORMAL, STATUS_APPROVED, REG_MANUAL, StockIoType, roundCents,
} from './oscu-codes';

/** Who registers or changes data at KRA (regrId/regrNm, modrId/modrNm): the app, or the signed-in user. */
export interface OscuOperator {
  id: string;
  name: string;
}

const cut = (s: string | null | undefined, max: number): string | null => {
  const v = (s ?? '').trim();
  return v ? v.slice(0, max) : null;
};
/** Quantities are NUMBER(13,2) at KRA. */
const qty2 = (q: number): number => Math.round(q * 100) / 100;

function operatorFields(op: OscuOperator, registrant = true) {
  const id = cut(op.id, 20) ?? 'system';
  const name = cut(op.name, 60) ?? 'Faida POS';
  return registrant ? { regrId: id, regrNm: name, modrId: id, modrNm: name } : { modrId: id, modrNm: name };
}

// ─── Sales invoice / credit note (/saveTrnsSalesOsdc) ──────────────────────────

export interface OscuSaleLine {
  itemCd: string;
  itemClsCd: string;
  name: string;
  barcode?: string | null;
  pkgUnitCd: string;
  qtyUnitCd: string;
  qty: number;
  /** Shelf price, VAT included. */
  unitPriceCents: number;
  /** What the line cost after its discount, VAT included. */
  paidCents: number;
  taxType: OscuTaxType;
}

export interface OscuSaleInput {
  /** Our own invoice reference (receipt number). */
  tradeInvoiceNo: string;
  /** KRA's invoice number for this branch: 1, 2, 3... with no gaps. */
  invcNo: number;
  /** For a credit note: the KRA invoice number it credits. */
  orgInvcNo?: number | null;
  creditNote?: { reason: string; at?: Date } | null;
  confirmedAt: Date;
  customerPin?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  pmtTyCd: string;
  lines: OscuSaleLine[];
  operator: OscuOperator;
  receipt?: { tradeName?: string | null; address?: string | null; topMsg?: string | null; btmMsg?: string | null };
  remark?: string | null;
}

export function buildSalePayload(s: OscuSaleInput): Record<string, unknown> {
  if (!Number.isInteger(s.invcNo) || s.invcNo < 1) throw new Error('invcNo must be a whole number of 1 or more');
  if (!s.lines.length) throw new Error('An invoice needs at least one line');
  if (s.lines.length > 999) throw new Error('An invoice allows at most 999 lines');
  const isCn = !!s.creditNote;
  if (isCn && (!s.orgInvcNo || s.orgInvcNo < 1)) throw new Error('A credit note needs the KRA invoice number it credits');
  if (isCn && s.orgInvcNo === s.invcNo) throw new Error('A credit note needs its own invoice number');

  const computed = s.lines.map((l) => ({ line: l, amounts: lineAmounts(qty2(l.qty), l.unitPriceCents, l.paidCents, l.taxType) }));
  const totals = invoiceTotals(computed.map((c) => ({ taxType: c.line.taxType, amounts: c.amounts })));
  const pin = cut(s.customerPin?.toUpperCase(), 11);
  const accepted = 'N';

  return {
    trdInvcNo: cut(s.tradeInvoiceNo, 50),
    invcNo: s.invcNo,
    orgInvcNo: isCn ? s.orgInvcNo : 0,
    custTin: pin,
    custNm: cut(s.customerName, 60),
    salesTyCd: SALES_TYPE_NORMAL,
    rcptTyCd: isCn ? RECEIPT_CREDIT_NOTE : RECEIPT_SALE,
    pmtTyCd: s.pmtTyCd,
    salesSttsCd: STATUS_APPROVED,
    cfmDt: kraDateTime(s.confirmedAt),
    salesDt: kraDate(s.confirmedAt),
    stockRlsDt: kraDateTime(s.confirmedAt),
    cnclReqDt: null,
    cnclDt: null,
    rfdDt: isCn ? kraDateTime(s.creditNote!.at ?? s.confirmedAt) : null,
    rfdRsnCd: isCn ? s.creditNote!.reason : null,
    totItemCnt: s.lines.length,
    ...totals,
    prchrAcptcYn: accepted,
    remark: cut(s.remark, 400),
    ...operatorFields(s.operator),
    receipt: {
      custTin: pin,
      custMblNo: cut(s.customerPhone, 20),
      rptNo: null,
      rcptPbctDt: kraDateTime(s.confirmedAt),
      trdeNm: cut(s.receipt?.tradeName, 20),
      adrs: cut(s.receipt?.address, 200),
      topMsg: cut(s.receipt?.topMsg, 20),
      btmMsg: cut(s.receipt?.btmMsg, 20),
      prchrAcptcYn: accepted,
    },
    itemList: computed.map(({ line, amounts }, i) => saleLine(i + 1, line, amounts)),
  };
}

function saleLine(seq: number, l: OscuSaleLine, a: OscuLineAmounts) {
  const q = qty2(l.qty);
  if (q <= 0) throw new Error(`Line ${seq}: quantity must be more than zero`);
  if (!l.itemClsCd) throw new Error(`Line ${seq} (${l.name}): the item has no KRA item class`);
  return {
    itemSeq: seq,
    itemClsCd: cut(l.itemClsCd, 10),
    itemCd: cut(l.itemCd, 20),
    itemNm: cut(l.name, 200) ?? 'Item',
    bcd: cut(l.barcode, 20),
    qtyUnitCd: l.qtyUnitCd,
    qty: q,
    pkgUnitCd: l.pkgUnitCd,
    pkg: q,
    prc: kes(l.unitPriceCents),
    splyAmt: kes(a.supplyCents),
    dcRt: a.supplyCents > 0 ? Math.round((a.discountCents / a.supplyCents) * 10000) / 100 : 0,
    dcAmt: kes(a.discountCents),
    isrccCd: null,
    isrccNm: null,
    isrcRt: null,
    isrcAmt: null,
    taxTyCd: l.taxType,
    taxblAmt: kes(a.taxableCents),
    taxAmt: kes(a.taxCents),
    totAmt: kes(a.totalCents),
  };
}

/** The receipt fields KRA sends back for a signed invoice. Keys in KRA's samples sometimes carry stray spaces. */
export function readSaleReceipt(data: any): { curRcptNo: number | null; totRcptNo: number | null; intrlData: string | null; rcptSign: string | null; sdcDateTime: string | null } {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data ?? {})) raw[String(k).trim()] = v;
  const text = (k: string) => (raw[k] == null || String(raw[k]).trim() === '' ? null : String(raw[k]).trim());
  const int = (k: string) => { const t = text(k); return t && /^\d+$/.test(t) ? Number(t) : null; };
  return { curRcptNo: int('curRcptNo'), totRcptNo: int('totRcptNo'), intrlData: text('intrlData'), rcptSign: text('rcptSign'), sdcDateTime: text('sdcDateTime') };
}

// ─── Item registration (/saveItem) ─────────────────────────────────────────────

export interface OscuItemInput {
  itemCd: string;
  itemClsCd: string;
  productType: string;
  name: string;
  pkgUnitCd: string;
  qtyUnitCd: string;
  taxType: OscuTaxType;
  defaultPriceCents: number;
  barcode?: string | null;
  /** Up to five price levels (e.g. wholesale, contractor), VAT included. */
  groupPricesCents?: Array<number | null | undefined>;
  active?: boolean;
  operator: OscuOperator;
}

export function buildItemPayload(i: OscuItemInput): Record<string, unknown> {
  if (!i.itemClsCd) throw new Error(`${i.name}: choose a KRA item class before registering it`);
  const prices = [...(i.groupPricesCents ?? [])].slice(0, 5);
  while (prices.length < 5) prices.push(null);
  const body: Record<string, unknown> = {
    itemCd: cut(i.itemCd, 20),
    itemClsCd: cut(i.itemClsCd, 10),
    itemTyCd: i.productType,
    itemNm: cut(i.name, 200),
    itemStdNm: null,
    orgnNatCd: 'KE',
    pkgUnitCd: i.pkgUnitCd,
    qtyUnitCd: i.qtyUnitCd,
    taxTyCd: i.taxType,
    btchNo: null,
    bcd: cut(i.barcode, 20),
    dftPrc: kes(i.defaultPriceCents),
  };
  prices.forEach((p, n) => { body[`grpPrcL${n + 1}`] = p == null ? null : kes(p); });
  return { ...body, addInfo: null, sftyQty: null, isrcAplcbYn: 'N', useYn: i.active === false ? 'N' : 'Y', ...operatorFields(i.operator) };
}

// ─── Stock in/out (/insertStockIO) and stock levels (/saveStockMaster) ─────────

export interface OscuStockLine {
  itemCd: string;
  itemClsCd: string;
  name: string;
  barcode?: string | null;
  pkgUnitCd: string;
  qtyUnitCd: string;
  /** Always positive: the stock type says in or out. */
  qty: number;
  unitPriceCents: number;
  taxType: OscuTaxType;
  expiry?: Date | null;
}

export interface OscuStockIoInput {
  /** Our own running number for stock movements: 1, 2, 3... */
  sarNo: number;
  orgSarNo?: number;
  sarTyCd: StockIoType;
  occurredAt: Date;
  lines: OscuStockLine[];
  customerPin?: string | null;
  customerName?: string | null;
  remark?: string | null;
  operator: OscuOperator;
}

export function buildStockIoPayload(s: OscuStockIoInput): Record<string, unknown> {
  if (!Number.isInteger(s.sarNo) || s.sarNo < 1) throw new Error('sarNo must be a whole number of 1 or more');
  if (!s.lines.length) throw new Error('A stock movement needs at least one line');
  const items = s.lines.map((l, idx) => {
    const q = qty2(Math.abs(l.qty));
    if (q <= 0) throw new Error(`Stock line ${idx + 1}: quantity must be more than zero`);
    const supply = roundCents(q * l.unitPriceCents);
    const a = lineAmounts(q, l.unitPriceCents, supply, l.taxType);
    return {
      raw: a,
      taxType: l.taxType,
      body: {
        itemSeq: idx + 1,
        itemCd: cut(l.itemCd, 20),
        itemClsCd: cut(l.itemClsCd, 10),
        itemNm: cut(l.name, 200),
        bcd: cut(l.barcode, 20),
        qtyUnitCd: l.qtyUnitCd,
        qty: q,
        pkgUnitCd: l.pkgUnitCd,
        pkg: q,
        itemExprDt: l.expiry ? kraDate(l.expiry) : null,
        prc: kes(l.unitPriceCents),
        splyAmt: kes(a.supplyCents),
        totDcAmt: 0,
        taxblAmt: kes(a.taxableCents),
        taxTyCd: l.taxType,
        taxAmt: kes(a.taxCents),
        totAmt: kes(a.totalCents),
      },
    };
  });
  const sum = (f: (a: OscuLineAmounts) => number) => kes(items.reduce((t, i) => t + f(i.raw), 0));
  return {
    sarNo: s.sarNo,
    orgSarNo: s.orgSarNo ?? 0,
    regTyCd: REG_MANUAL,
    custTin: cut(s.customerPin?.toUpperCase(), 11),
    custNm: cut(s.customerName, 100),
    custBhfId: null,
    sarTyCd: s.sarTyCd,
    ocrnDt: kraDate(s.occurredAt),
    totItemCnt: items.length,
    totTaxblAmt: sum((a) => a.taxableCents),
    totTaxAmt: sum((a) => a.taxCents),
    totAmt: sum((a) => a.totalCents),
    remark: cut(s.remark, 400),
    ...operatorFields(s.operator),
    itemList: items.map((i) => i.body),
  };
}

export function buildStockMasterPayload(itemCd: string, remainingQty: number, operator: OscuOperator): Record<string, unknown> {
  return { itemCd: cut(itemCd, 20), rsdQty: qty2(Math.max(0, remainingQty)), ...operatorFields(operator) };
}
