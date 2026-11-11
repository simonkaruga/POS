// The one place that decides WHAT is printed and in what order. The serializers
// (escpos.ts, html.ts, star.ts, epson.ts) only decide how a block looks on their
// medium, so they cannot disagree about content.

import type { BillDocument, KotDocument, ReceiptDocument, ReceiptPayment } from './model';
import { formatAmount, formatDateTime, formatKES, formatTime, groupThousands } from './text';

export type Size = 'small' | 'normal' | 'large' | 'xl';
export type Align = 'left' | 'center' | 'right';
export type BannerTone = 'void' | 'credit' | 'pending' | 'copy' | 'test' | 'offline' | 'info';

export type Block =
  /** Boxed, centered notice: VOID, CREDIT SALE, PENDING KRA, COPY. */
  | { kind: 'banner'; text: string; tone: BannerTone }
  /** Wrapped text line. */
  | { kind: 'line'; text: string; align?: Align; bold?: boolean; size?: Size; muted?: boolean; indent?: boolean }
  /** `left` at the left edge, `right` at the right edge. */
  | { kind: 'row'; left: string; right: string; bold?: boolean; size?: Size; muted?: boolean; indent?: boolean }
  | { kind: 'rule'; style: 'dash' | 'double' }
  | { kind: 'qr'; data: string }
  | { kind: 'gap' };

// ─── Payment grouping ─────────────────────────────────────────────────────────
// M-Pesa variants collapse into "M-Pesa", card variants into "Card Payment", and so on.

export interface PaymentGroup {
  label: string;
  totalCents: number;
  lines: ReceiptPayment[];
  isGroup: boolean;
}

const GROUP_LABELS: Record<string, string> = {
  MPESA: 'M-Pesa',
  CARD: 'Card Payment',
  CASH: 'Cash',
  BANK: 'Bank Transfer',
  GIFT: 'Gift Card',
  LOYALTY: 'Loyalty Points',
  ROOM: 'Room Charge',
  OTHER: 'Other',
};

function classifyPayment(method: string): string {
  const m = method.toUpperCase();
  if (m.includes('MPESA') || m.includes('M-PESA') || m.includes('M_PESA') || m === 'MOBILE_MONEY' || m.includes('QR')) return 'MPESA';
  if (m.includes('CARD') || m.includes('VISA') || m.includes('MASTERCARD') || m.includes('PAYSTACK') || m === 'DEBIT' || m === 'CREDIT') return 'CARD';
  if (m === 'CASH' || m === 'CASH_EXACT') return 'CASH';
  if (m.includes('BANK') || m.includes('EFT') || m.includes('TRANSFER')) return 'BANK';
  if (m.includes('GIFT')) return 'GIFT';
  if (m.includes('LOYALTY') || m.includes('POINTS')) return 'LOYALTY';
  if (m.includes('ROOM')) return 'ROOM';
  return 'OTHER';
}

export function groupPayments(payments: ReceiptPayment[]): PaymentGroup[] {
  const buckets = new Map<string, ReceiptPayment[]>();
  for (const p of payments) {
    const key = classifyPayment(p.method);
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  return Array.from(buckets.entries()).map(([key, lines]) => ({
    label: GROUP_LABELS[key] ?? key,
    totalCents: lines.reduce((s, l) => s + l.amountCents, 0),
    lines,
    isGroup: lines.length > 1,
  }));
}

/** True when the sale was (partly) paid in cash, so the drawer should open. */
export function hasCashPayment(doc: ReceiptDocument): boolean {
  return doc.payments.some((p) => p.method === 'CASH' || p.method === 'CASH_EXACT');
}

// ─── Receipt ──────────────────────────────────────────────────────────────────

export function layoutReceipt(doc: ReceiptDocument): Block[] {
  const b: Block[] = [];
  const voided = !!doc.voided;

  // Status banners come first so a voided, credit, pending or copy receipt can never be mistaken for the original.
  if (voided) b.push({ kind: 'banner', text: '*** VOID ***', tone: 'void' });
  if (doc.offlineSale && !voided) {
    b.push({ kind: 'banner', text: '*** OFFLINE SALE - PROVISIONAL RECEIPT ***', tone: 'offline' });
  }
  if ((doc.copyNumber ?? 0) > 0) {
    b.push({ kind: 'banner', text: `*** COPY ${doc.copyNumber} - NOT THE ORIGINAL ***`, tone: 'copy' });
  }
  if (doc.isCreditSale && !voided) {
    b.push({ kind: 'banner', text: `*** CREDIT SALE - AMOUNT DUE: ${formatKES(doc.totalCents)} ***`, tone: 'credit' });
    if (doc.customerName) b.push({ kind: 'line', text: `Debtor: ${doc.customerName}`, align: 'center', bold: true });
  }
  if (doc.etimsSubmitted === false && !voided) {
    b.push({ kind: 'banner', text: '*** PENDING KRA SUBMISSION ***', tone: 'pending' });
  }
  if (doc.etimsTestMode && !voided) {
    b.push({ kind: 'banner', text: '*** TEST MODE - NOT A TAX INVOICE ***', tone: 'test' });
  }

  // Header
  b.push({ kind: 'line', text: doc.businessName, align: 'center', bold: true, size: 'large' });
  if (doc.storeName) b.push({ kind: 'line', text: doc.storeName, align: 'center' });
  if (doc.storeAddress) b.push({ kind: 'line', text: doc.storeAddress, align: 'center', size: 'small' });
  if (doc.storePhone) b.push({ kind: 'line', text: doc.storePhone, align: 'center', size: 'small' });
  b.push({ kind: 'rule', style: 'double' });

  // Receipt info
  b.push({ kind: 'row', left: 'Receipt:', right: doc.receiptNumber, bold: true, size: 'small' });
  b.push({ kind: 'row', left: 'Date:', right: formatDateTime(doc.date), size: 'small' });
  if (doc.cashierName) b.push({ kind: 'row', left: 'Cashier:', right: doc.cashierName, size: 'small' });
  if (doc.customerName) b.push({ kind: 'row', left: 'Customer:', right: doc.customerName, size: 'small' });
  if (doc.customerKraPin) b.push({ kind: 'row', left: 'Buyer PIN:', right: doc.customerKraPin, size: 'small' });
  b.push({ kind: 'rule', style: 'double' });

  // Items
  for (const item of doc.items) {
    b.push({ kind: 'line', text: item.name, bold: true });
    b.push({ kind: 'row', left: `${item.quantity} x ${formatKES(item.unitPriceCents)}`, right: formatKES(item.totalCents), size: 'small' });
    if (item.discountPercent && item.discountPercent > 0) {
      b.push({ kind: 'line', text: `Discount: -${item.discountPercent}%`, size: 'small', indent: true });
    }
  }
  b.push({ kind: 'rule', style: 'dash' });

  // Totals
  const vat = doc.vatCents ?? 0;
  const tot = doc.totCents ?? 0;
  const subtotalLabel = vat > 0 ? 'Subtotal (ex-VAT):' : tot > 0 ? 'Subtotal (ex-TOT):' : 'Subtotal:';
  b.push({ kind: 'row', left: subtotalLabel, right: formatKES(doc.subtotalCents - vat - tot) });
  if (doc.serviceChargeCents && doc.serviceChargeCents > 0) {
    b.push({ kind: 'row', left: 'Service (10%):', right: formatKES(doc.serviceChargeCents) });
  }
  if (vat > 0) b.push({ kind: 'row', left: 'VAT (16%):', right: formatKES(vat) });
  if (tot > 0) b.push({ kind: 'row', left: 'TOT (3%):', right: formatKES(tot) });
  if (doc.tipCents && doc.tipCents > 0) b.push({ kind: 'row', left: 'Tip/Gratuity:', right: formatKES(doc.tipCents) });
  b.push({ kind: 'rule', style: 'dash' });
  b.push({ kind: 'row', left: 'TOTAL:', right: formatKES(doc.totalCents), bold: true, size: 'large' });
  b.push({ kind: 'rule', style: 'dash' });

  // Payments
  if (doc.isCreditSale && !voided) {
    b.push({ kind: 'row', left: 'CREDIT THIS SALE:', right: formatKES(doc.totalCents), bold: true });
    if (doc.previousBalanceCents !== undefined && doc.previousBalanceCents < 0) {
      b.push({ kind: 'row', left: 'PREV BALANCE OWED:', right: formatKES(Math.abs(doc.previousBalanceCents)) });
    }
    if (doc.newBalanceCents !== undefined) {
      b.push({ kind: 'rule', style: 'dash' });
      b.push({ kind: 'row', left: 'TOTAL OUTSTANDING:', right: formatKES(Math.abs(doc.newBalanceCents)), bold: true });
    }
  } else {
    for (const group of groupPayments(doc.payments)) {
      if (group.isGroup) {
        b.push({ kind: 'row', left: `${group.label}:`, right: formatKES(group.totalCents), bold: true });
        for (const p of group.lines) {
          b.push({
            kind: 'row',
            left: p.method + (p.reference ? ` (${p.reference})` : ''),
            right: formatKES(p.amountCents),
            muted: true,
            indent: true,
            size: 'small',
          });
        }
      } else {
        const p = group.lines[0];
        b.push({ kind: 'row', left: group.label + (p.reference ? ` (${p.reference})` : ''), right: formatKES(p.amountCents) });
      }
    }
    if (doc.changeCents && doc.changeCents > 0) {
      b.push({ kind: 'row', left: 'CHANGE:', right: formatKES(doc.changeCents), bold: true });
    }
  }

  // Loyalty
  const earned = doc.pointsEarned ?? 0;
  const balance = doc.loyaltyBalance ?? 0;
  if (earned > 0 || balance > 0) {
    b.push({ kind: 'rule', style: 'dash' });
    if (earned > 0) b.push({ kind: 'line', text: `+${groupThousands(earned)} LOYALTY POINTS EARNED`, align: 'center', bold: true });
    b.push({ kind: 'line', text: `Loyalty balance: ${groupThousands(balance)} pts`, align: 'center' });
  }

  // KRA eTIMS
  const kraRef = doc.etimsControlNumber ?? doc.kraControlNumber;
  if (voided) {
    // A voided sale is reversed with KRA through a credit note, so it must not read as verified.
    if (kraRef) {
      b.push({ kind: 'rule', style: 'dash' });
      b.push({ kind: 'line', text: `Original control No: ${kraRef}`, align: 'center', size: 'small' });
    }
  } else if (doc.etimsTestMode && doc.etimsSubmitted !== false) {
    // Nothing was sent to KRA, so there is no control number to verify and no QR to scan.
    b.push({ kind: 'rule', style: 'double' });
    b.push({ kind: 'line', text: 'KRA eTIMS: TEST MODE', align: 'center', bold: true });
    b.push({ kind: 'line', text: 'Not registered with KRA', align: 'center', size: 'small' });
    b.push({ kind: 'rule', style: 'dash' });
  } else if (doc.etimsSubmitted && kraRef) {
    b.push({ kind: 'rule', style: 'double' });
    b.push({ kind: 'line', text: 'KRA eTIMS VERIFIED', align: 'center', bold: true });
    b.push({ kind: 'line', text: `Control No: ${kraRef}`, align: 'center' });
    if (doc.kraQRCode) {
      b.push({ kind: 'qr', data: doc.kraQRCode });
      b.push({ kind: 'line', text: 'Scan QR to verify on KRA portal', align: 'center', size: 'small' });
    }
    b.push({ kind: 'rule', style: 'dash' });
  } else if (doc.etimsSubmitted === false) {
    b.push({ kind: 'gap' });
    b.push({ kind: 'line', text: '** PENDING KRA SUBMISSION **', align: 'center', size: 'small' });
  }

  // Footer
  b.push({ kind: 'gap' });
  if (doc.receiptHeader) b.push({ kind: 'line', text: doc.receiptHeader, align: 'center', size: 'small' });
  b.push({ kind: 'line', text: 'Thank you for your business!', align: 'center' });
  if (doc.receiptFooter) b.push({ kind: 'line', text: doc.receiptFooter, align: 'center', size: 'small' });
  b.push({ kind: 'line', text: 'Powered by: Faida Systems', align: 'center', size: 'small', muted: true });
  return b;
}

// ─── Kitchen order ticket ─────────────────────────────────────────────────────

export function layoutKot(kot: KotDocument): Block[] {
  const b: Block[] = [];
  b.push({ kind: 'line', text: 'KITCHEN ORDER', align: 'center', bold: true, size: 'large' });
  b.push({ kind: 'line', text: `T${kot.tableNumber}`, align: 'center', bold: true, size: 'xl' });
  let meta = formatTime(kot.createdAt);
  if (kot.waiterName) meta += ` - ${kot.waiterName}`;
  if (kot.kotNumber) meta += ` - KOT #${kot.kotNumber}`;
  b.push({ kind: 'line', text: meta, align: 'center', size: 'small' });
  b.push({ kind: 'banner', text: kot.orderType === 'ADDITION' ? '+ ADDITION' : 'NEW ORDER', tone: 'info' });
  b.push({ kind: 'rule', style: 'double' });
  for (const item of kot.items) {
    b.push({ kind: 'line', text: `${item.quantity}x ${item.name}`, bold: true, size: 'large' });
    if (item.specialInstructions) b.push({ kind: 'line', text: `!! ${item.specialInstructions}`, indent: true });
    for (const mod of item.modifiers ?? []) b.push({ kind: 'line', text: `+ ${mod}`, indent: true, size: 'small' });
  }
  b.push({ kind: 'rule', style: 'double' });
  return b;
}

// ─── Table bill (printed before the sale exists) ──────────────────────────────

export function layoutBill(bill: BillDocument): Block[] {
  const b: Block[] = [];
  const vat = bill.vatCents ?? 0;
  const tot = bill.totCents ?? 0;
  const tax = tot > 0 ? tot : vat;
  const taxName = tot > 0 ? 'TOT' : 'VAT';
  const taxRate = tot > 0 ? '3%' : '16%';

  b.push({ kind: 'banner', text: 'BILL', tone: 'info' });
  b.push({ kind: 'line', text: bill.businessName, align: 'center', bold: true, size: 'large' });
  b.push({ kind: 'line', text: `Table ${bill.tableNumber}`, align: 'center', bold: true, size: 'xl' });
  b.push({
    kind: 'line',
    text: formatDateTime(bill.date) + (bill.waiterName ? ` - Served by: ${bill.waiterName}` : ''),
    align: 'center',
    size: 'small',
  });
  b.push({ kind: 'rule', style: 'dash' });
  for (const item of bill.items) {
    b.push({ kind: 'line', text: item.name, bold: true });
    b.push({ kind: 'row', left: `${item.quantity} x ${formatAmount(item.unitPriceCents)}`, right: formatAmount(item.totalCents), size: 'small' });
  }
  b.push({ kind: 'rule', style: 'dash' });
  b.push({
    kind: 'row',
    left: tax > 0 ? `TOTAL (${taxName} incl.):` : 'TOTAL:',
    right: formatKES(bill.totalCents),
    bold: true,
    size: 'large',
  });
  if (tax > 0) b.push({ kind: 'row', left: `${taxName} (${taxRate}) included:`, right: formatKES(tax), muted: true, size: 'small' });
  b.push({ kind: 'rule', style: 'dash' });
  if (bill.footer) b.push({ kind: 'line', text: bill.footer, align: 'center', size: 'small' });
  b.push({ kind: 'line', text: 'Please check your bill and inform staff of any errors.', align: 'center', size: 'small' });
  b.push({ kind: 'line', text: 'Thank you for dining with us!', align: 'center', size: 'small' });
  b.push({ kind: 'line', text: 'Powered by: Faida Systems', align: 'center', size: 'small', muted: true });
  return b;
}
