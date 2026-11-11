import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { etimsPaymentType } from '../etims-payment';
import { etimsLineTax } from '../etims-tax';
import { OscuClient, OscuError, OscuIdentity, OscuEnvironment, OscuCallLog } from './oscu-client';
import { OscuTaxType, OSCU_TAX_TYPES, PRODUCT_FINISHED, PRODUCT_SERVICE, makeItemCode, stockIoTypeFor, STOCK_IO, CREDIT_NOTE_REASON, isKraPin } from './oscu-codes';
import { buildSalePayload, buildItemPayload, buildStockIoPayload, buildStockMasterPayload, readSaleReceipt, OscuOperator, OscuSaleLine } from './oscu-payloads';

/** What a business stores (encrypted) once its KRA device is initialised. */
export interface OscuCredentials {
  version: 2;
  tin: string;
  bhfId: string;
  dvcSrlNo: string;
  cmcKey: string;
  sdcId?: string | null;
  mrcNo?: string | null;
  tradeNm?: string | null;
}

export interface SignedInvoice {
  invcNo: number;
  controlNumber: string;
  rcptSign: string | null;
  intrlData: string | null;
  signedAt: string | null;
  qrUrl: string | null;
}

const APP_OPERATOR: OscuOperator = { id: 'faida-pos', name: 'Faida POS' };
/** Stock movements are reported a little after they happen, so a sale's own invoice always reaches KRA first. */
const STOCK_DELAY_MS = 2 * 60_000;
const STOCK_BATCH = 200;

/**
 * Everything that reaches the real KRA eTIMS (OSCU) for a live business: device setup, item registration, signed
 * invoices and credit notes, stock movements, and KRA's item class list.
 *
 * KRA invoice numbers (invcNo) run 1, 2, 3... per branch with no gaps. A number is allocated only when an invoice is
 * about to be sent, kept on the sale while KRA is unreachable (the retry sends the same number), and handed back if
 * KRA refuses the invoice itself, so a refused sale never leaves a hole. Submissions for one business run one at a
 * time so two tills cannot interleave numbers.
 */
@Injectable()
export class EtimsOscuService {
  private readonly logger = new Logger(EtimsOscuService.name);
  private readonly locks = new Map<string, Promise<unknown>>();
  private stockRunning = false;

  constructor(private prisma: PrismaService) {}

  get environment(): OscuEnvironment {
    return process.env.ETIMS_ENV === 'production' ? 'production' : 'sandbox';
  }

  client(businessId: string): OscuClient {
    return new OscuClient({
      environment: this.environment,
      baseUrl: process.env.ETIMS_API_URL || undefined,
      onCall: (log) => this.logCall(businessId, log),
    });
  }

  // ─── Credentials ────────────────────────────────────────────────────────────

  /** The device credentials of a business that is really connected to KRA, or null (sandbox / not set up). */
  credentialsOf(business: { etimsMode?: string | null; etimsCredentialsEncrypted?: string | null } | null): OscuCredentials | null {
    if (business?.etimsMode !== 'PRODUCTION' || !business.etimsCredentialsEncrypted) return null;
    try {
      const c = decrypt(business.etimsCredentialsEncrypted);
      return c?.version === 2 && c.cmcKey && c.tin ? (c as OscuCredentials) : null;
    } catch {
      return null;
    }
  }

  isLive(business: Parameters<EtimsOscuService['credentialsOf']>[0]): boolean {
    return this.credentialsOf(business) !== null;
  }

  private identity(c: OscuCredentials): OscuIdentity {
    return { tin: c.tin, bhfId: c.bhfId, cmcKey: c.cmcKey };
  }

  /**
   * Initialise the KRA device for a business and keep its communication key. The serial and branch come from the
   * eTIMS portal, where the owner registers the OSCU device; they are never invented here.
   */
  async connect(businessId: string, input: { tin: string; bhfId: string; dvcSrlNo: string }): Promise<OscuCredentials> {
    const tin = input.tin.trim().toUpperCase();
    const bhfId = (input.bhfId || '00').trim().padStart(2, '0');
    const dvcSrlNo = input.dvcSrlNo.trim();
    if (!isKraPin(tin)) throw new OscuError('Enter the KRA PIN as on the certificate, e.g. P051234567A', 'rejected');
    if (!dvcSrlNo) throw new OscuError('Enter the device serial number KRA gave you on the eTIMS portal', 'rejected');
    const { cmcKey, info } = await this.client(businessId).initDevice(tin, bhfId, dvcSrlNo);
    const creds: OscuCredentials = {
      version: 2, tin, bhfId, dvcSrlNo, cmcKey,
      sdcId: (info.sdcId ?? info.sdicId ?? null) as string | null,
      mrcNo: (info.mrcNo ?? null) as string | null,
      tradeNm: (info.tradeNm ?? info.bhfNm ?? null) as string | null,
    };
    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        etimsMode: 'PRODUCTION',
        etimsProductionOnboarded: true,
        etimsCredentialsEncrypted: encrypt(creds),
        etimsLiveSince: new Date(),
      },
    });
    return creds;
  }

  // ─── One submission at a time per business ──────────────────────────────────

  private serial<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(businessId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(businessId, next.catch(() => undefined));
    return next;
  }

  private async nextInvcNo(businessId: string): Promise<number> {
    const b = await this.prisma.business.update({ where: { id: businessId }, data: { etimsInvcSeq: { increment: 1 } }, select: { etimsInvcSeq: true } });
    return b.etimsInvcSeq;
  }

  /** Give a number back when KRA refused the invoice, but only if nothing was allocated after it. */
  private async releaseInvcNo(businessId: string, invcNo: number): Promise<boolean> {
    const r = await this.prisma.business.updateMany({ where: { id: businessId, etimsInvcSeq: invcNo }, data: { etimsInvcSeq: invcNo - 1 } });
    return r.count === 1;
  }

  // ─── Items ──────────────────────────────────────────────────────────────────

  /** The KRA item class for an item: its own, else the business default. */
  classOf(item: { kraItemCode?: string | null } | null, business: { etimsDefaultItemClsCd?: string | null }): string | null {
    return item?.kraItemCode?.trim() || business.etimsDefaultItemClsCd?.trim() || null;
  }

  private units(item: { etimsPkgUnitCd?: string | null; etimsQtyUnitCd?: string | null }) {
    return { pkgUnitCd: item.etimsPkgUnitCd || 'NT', qtyUnitCd: item.etimsQtyUnitCd || 'U' };
  }

  private taxTypeOf(taxClass: string | null | undefined): OscuTaxType {
    return (OSCU_TAX_TYPES as readonly string[]).includes(taxClass ?? '') ? (taxClass as OscuTaxType) : 'B';
  }

  /**
   * Register (or re-send after a change) every item in the list that KRA does not have yet. KRA refuses a sale of an
   * item it has never seen, and a changed name, price or tax class must reach it too.
   */
  async ensureItemsRegistered(business: any, creds: OscuCredentials, itemIds: string[]): Promise<void> {
    const ids = [...new Set(itemIds.filter(Boolean))];
    if (!ids.length) return;
    const items = await this.prisma.item.findMany({ where: { id: { in: ids }, businessId: business.id } });
    const client = this.client(business.id);
    for (const item of items) {
      const stale = !item.etimsItemCd || !item.etimsRegisteredAt || item.updatedAt > item.etimsRegisteredAt;
      if (!stale) continue;
      const itemClsCd = this.classOf(item, business);
      if (!itemClsCd) {
        const msg = `Choose a KRA item class for "${item.name}" (Settings → KRA eTIMS)`;
        await this.prisma.item.update({ where: { id: item.id }, data: { etimsRegisterError: msg } });
        throw new OscuError(msg, 'rejected');
      }
      const { pkgUnitCd, qtyUnitCd } = this.units(item);
      const productType = item.type === 'SERVICE' || !item.trackStock ? PRODUCT_SERVICE : PRODUCT_FINISHED;
      let itemCd = item.etimsItemCd;
      if (!itemCd) {
        const b = await this.prisma.business.update({ where: { id: business.id }, data: { etimsItemSeq: { increment: 1 } }, select: { etimsItemSeq: true } });
        itemCd = makeItemCode(productType, pkgUnitCd, qtyUnitCd, b.etimsItemSeq);
      }
      const body = buildItemPayload({
        itemCd, itemClsCd, productType, name: item.name, pkgUnitCd, qtyUnitCd,
        taxType: this.taxTypeOf(item.taxClass), defaultPriceCents: item.retailPriceCents, barcode: item.barcode,
        groupPricesCents: [item.wholesalePriceCents, item.vipPriceCents], active: item.isActive && !item.deletedAt, operator: APP_OPERATOR,
      });
      try {
        await client.call(this.identity(creds), '/saveItem', body);
      } catch (e) {
        if (!(e instanceof OscuError && e.kind === 'duplicate')) {
          await this.prisma.item.update({ where: { id: item.id }, data: { etimsItemCd: itemCd, etimsRegisterError: String((e as Error).message) } });
          throw e;
        }
      }
      // updatedAt moves with this write, so stamp registration a moment after it.
      await this.prisma.item.update({ where: { id: item.id }, data: { etimsItemCd: itemCd, etimsRegisterError: null } });
      await this.prisma.item.update({ where: { id: item.id }, data: { etimsRegisteredAt: new Date(Date.now() + 1000) } });
    }
  }

  // ─── Sales invoices and credit notes ────────────────────────────────────────

  private saleLines(items: any[], business: any): OscuSaleLine[] {
    return items.map((si) => {
      const tx = etimsLineTax(si);
      return {
        itemCd: si.item?.etimsItemCd ?? '',
        itemClsCd: this.classOf(si.item, business) ?? '',
        name: si.item?.name ?? si.name ?? 'Item',
        barcode: si.item?.barcode ?? null,
        ...this.units(si.item ?? {}),
        qty: si.quantity,
        unitPriceCents: si.unitPriceCents,
        paidCents: tx.amountCents,
        taxType: this.taxTypeOf(tx.taxTyCd),
      };
    });
  }

  private controlNumber(creds: OscuCredentials, invcNo: number, curRcptNo: number | null): string {
    return `${creds.sdcId ?? creds.dvcSrlNo}/${curRcptNo ?? invcNo}`;
  }

  /** Sign a sale with KRA. Throws OscuError; `unavailable` means try again later with the same invoice number. */
  async submitSale(saleId: string): Promise<SignedInvoice> {
    const head = await this.prisma.sale.findUnique({ where: { id: saleId }, select: { businessId: true } });
    if (!head) throw new OscuError('Sale not found', 'rejected');
    return this.serial(head.businessId, () => this.submitSaleNow(saleId));
  }

  private async submitSaleNow(saleId: string): Promise<SignedInvoice> {
    const sale: any = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { item: true } }, payments: true, customer: { select: { name: true, phone: true, kraPin: true } } },
    });
    if (!sale) throw new OscuError('Sale not found', 'rejected');
    const business: any = await this.prisma.business.findUnique({ where: { id: sale.businessId } });
    const creds = this.credentialsOf(business);
    if (!creds) throw new OscuError('This business is not connected to KRA eTIMS', 'auth');
    if (sale.etimsSubmitted && sale.etimsInvcNo) return this.signedOf(sale, creds);

    const client = this.client(business.id);
    const fail = async (e: unknown, invcNo: number | null) => {
      const err = e instanceof OscuError ? e : new OscuError(String((e as Error)?.message ?? e), 'rejected');
      const data: any = { etimsAttempts: { increment: 1 }, etimsLastError: err.message.slice(0, 500) };
      if (!err.retryable) {
        data.etimsNeedsAttention = true;
        if (invcNo && (await this.releaseInvcNo(business.id, invcNo))) data.etimsInvcNo = null;
      }
      await this.prisma.sale.update({ where: { id: saleId }, data });
      throw err;
    };

    try {
      await this.ensureItemsRegistered(business, creds, sale.items.map((i: any) => i.itemId));
    } catch (e) {
      return fail(e, null);
    }
    // Item codes were just written; read them back.
    const items = await this.prisma.saleItem.findMany({ where: { saleId }, include: { item: true } });
    const pin = sale.customer?.kraPin ?? sale.buyerKraPin ?? null;
    const input = (invcNo: number) => ({
      tradeInvoiceNo: sale.receiptNumber, invcNo, confirmedAt: new Date(sale.createdAt),
      customerPin: isKraPin(pin) ? pin : null,
      customerName: sale.customer?.name ?? sale.customerName ?? null,
      customerPhone: sale.customer?.phone ?? null,
      pmtTyCd: etimsPaymentType(sale.payments ?? [], sale.type === 'CREDIT'),
      lines: this.saleLines(items, business),
      operator: { id: String(sale.cashierId ?? 'faida-pos').slice(0, 20), name: 'Faida POS' },
      receipt: { tradeName: creds.tradeNm ?? business.name, address: business.address ?? null, btmMsg: 'Asante! Karibu tena' },
    });

    // Check the invoice before a number is spent on it: a bad invoice must not leave a gap.
    try { buildSalePayload(input(sale.etimsInvcNo ?? 1)); } catch (e) { return fail(new OscuError((e as Error).message, 'rejected'), null); }

    const invcNo: number = sale.etimsInvcNo ?? (await this.nextInvcNo(business.id));
    if (!sale.etimsInvcNo) await this.prisma.sale.update({ where: { id: saleId }, data: { etimsInvcNo: invcNo } });

    let receipt: ReturnType<typeof readSaleReceipt>;
    try {
      const env = await client.call(this.identity(creds), '/saveTrnsSalesOsdc', buildSalePayload(input(invcNo)));
      receipt = readSaleReceipt(env.data);
    } catch (e) {
      // KRA already holds this invoice number for us (an earlier attempt got through): it is signed.
      if (e instanceof OscuError && e.kind === 'duplicate') receipt = { curRcptNo: null, totRcptNo: null, intrlData: null, rcptSign: null, sdcDateTime: null };
      else return fail(e, invcNo);
    }

    const controlNumber = this.controlNumber(creds, invcNo, receipt.curRcptNo);
    await this.prisma.sale.update({
      where: { id: saleId },
      data: {
        etimsSubmitted: true, etimsControlNumber: controlNumber, etimsRcptSign: receipt.rcptSign, etimsIntrlData: receipt.intrlData,
        etimsSignedAt: receipt.sdcDateTime, etimsLastError: null, etimsNeedsAttention: false, etimsAttempts: { increment: 1 },
      },
    });
    return { invcNo, controlNumber, rcptSign: receipt.rcptSign, intrlData: receipt.intrlData, signedAt: receipt.sdcDateTime, qrUrl: receipt.rcptSign ? client.qrUrl(creds.tin, creds.bhfId, receipt.rcptSign) : null };
  }

  signedOf(sale: { etimsInvcNo?: number | null; etimsControlNumber?: string | null; etimsRcptSign?: string | null; etimsIntrlData?: string | null; etimsSignedAt?: string | null; businessId: string }, creds: OscuCredentials): SignedInvoice {
    return {
      invcNo: sale.etimsInvcNo ?? 0,
      controlNumber: sale.etimsControlNumber ?? '',
      rcptSign: sale.etimsRcptSign ?? null,
      intrlData: sale.etimsIntrlData ?? null,
      signedAt: sale.etimsSignedAt ?? null,
      qrUrl: sale.etimsRcptSign ? this.client(sale.businessId).qrUrl(creds.tin, creds.bhfId, sale.etimsRcptSign) : null,
    };
  }

  /**
   * A credit note for some or all of a signed sale's lines. KRA cannot cancel an invoice, so a void, a return and a
   * correction are all credit notes against the original KRA invoice number.
   */
  async creditNote(saleId: string, saleItemIds: string[] | null, reason: string): Promise<SignedInvoice> {
    const head = await this.prisma.sale.findUnique({ where: { id: saleId }, select: { businessId: true } });
    if (!head) throw new OscuError('Sale not found', 'rejected');
    return this.serial(head.businessId, async () => {
      const sale: any = await this.prisma.sale.findUnique({ where: { id: saleId }, include: { items: { include: { item: true } }, customer: { select: { name: true, kraPin: true } } } });
      const business: any = await this.prisma.business.findUnique({ where: { id: sale.businessId } });
      const creds = this.credentialsOf(business);
      if (!creds) throw new OscuError('This business is not connected to KRA eTIMS', 'auth');
      if (!sale.etimsSubmitted || !sale.etimsInvcNo) throw new OscuError('The original sale was never signed by KRA, so there is nothing to credit', 'rejected');
      const lines = saleItemIds?.length ? sale.items.filter((i: any) => saleItemIds.includes(i.id)) : sale.items;
      if (!lines.length) throw new OscuError('Nothing to credit', 'rejected');
      const pin = sale.customer?.kraPin ?? sale.buyerKraPin ?? null;
      const input = (invcNo: number) => ({
        tradeInvoiceNo: `${sale.receiptNumber}-CN`, invcNo, orgInvcNo: sale.etimsInvcNo, creditNote: { reason, at: new Date() },
        confirmedAt: new Date(), customerPin: isKraPin(pin) ? pin : null, customerName: sale.customer?.name ?? sale.customerName ?? null,
        pmtTyCd: '01', lines: this.saleLines(lines, business), operator: APP_OPERATOR,
        receipt: { tradeName: creds.tradeNm ?? business.name },
      });
      buildSalePayload(input(sale.etimsInvcNo + 1)); // validate before spending a number
      const invcNo = await this.nextInvcNo(business.id);
      const client = this.client(business.id);
      try {
        const env = await client.call(this.identity(creds), '/saveTrnsSalesOsdc', buildSalePayload(input(invcNo)));
        const r = readSaleReceipt(env.data);
        return { invcNo, controlNumber: this.controlNumber(creds, invcNo, r.curRcptNo), rcptSign: r.rcptSign, intrlData: r.intrlData, signedAt: r.sdcDateTime, qrUrl: r.rcptSign ? client.qrUrl(creds.tin, creds.bhfId, r.rcptSign) : null };
      } catch (e) {
        if (e instanceof OscuError && e.kind === 'duplicate') return { invcNo, controlNumber: this.controlNumber(creds, invcNo, null), rcptSign: null, intrlData: null, signedAt: null, qrUrl: null };
        // Unreachable or refused: nothing was signed, so the number goes back if it is still the latest.
        await this.releaseInvcNo(business.id, invcNo);
        throw e;
      }
    });
  }

  // ─── Stock movements ────────────────────────────────────────────────────────

  /**
   * Report stock movements to KRA: deliveries, sales, damage, counts, transfers. Runs every ten minutes for every live
   * business, oldest first. A sale's movement waits until the sale itself is signed, as KRA requires.
   */
  @Cron('*/10 * * * *')
  async stockSweep(): Promise<void> {
    if (this.stockRunning) return;
    this.stockRunning = true;
    try {
      const live = await this.prisma.business.findMany({ where: { etimsMode: 'PRODUCTION', etimsCredentialsEncrypted: { not: null } } });
      for (const b of live) {
        if (!this.isLive(b)) continue;
        try { await this.serial(b.id, () => this.reportStock(b)); } catch (e) { this.logger.warn(`eTIMS stock report for ${b.id} stopped: ${String(e)}`); }
      }
    } finally {
      this.stockRunning = false;
    }
  }

  async reportStock(business: any): Promise<{ reported: number; failed: number }> {
    const creds = this.credentialsOf(business);
    if (!creds) return { reported: 0, failed: 0 };
    const since = business.etimsLiveSince ?? new Date();
    const movements: any[] = await this.prisma.inventoryMovement.findMany({
      where: { businessId: business.id, etimsReportedAt: null, createdAt: { gte: since, lte: new Date(Date.now() - STOCK_DELAY_MS) } },
      include: { item: true, sale: { select: { etimsSubmitted: true } } },
      orderBy: { createdAt: 'asc' },
      take: STOCK_BATCH,
    });
    const client = this.client(business.id);
    let reported = 0;
    let failed = 0;
    for (const m of movements) {
      if (!m.quantity) { await this.prisma.inventoryMovement.update({ where: { id: m.id }, data: { etimsReportedAt: new Date() } }); continue; }
      if (m.saleId && !m.sale?.etimsSubmitted) continue; // the invoice goes first
      try {
        await this.ensureItemsRegistered(business, creds, [m.itemId]);
        const item = await this.prisma.item.findUnique({ where: { id: m.itemId } });
        if (!item?.etimsItemCd) continue;
        const sarTyCd = stockIoTypeFor(m.type, m.quantity);
        const incomingPurchase = sarTyCd === STOCK_IO.PURCHASE || sarTyCd === STOCK_IO.IMPORT;
        const b = await this.prisma.business.update({ where: { id: business.id }, data: { etimsSarSeq: { increment: 1 } }, select: { etimsSarSeq: true } });
        const sarNo = b.etimsSarSeq;
        const body = buildStockIoPayload({
          sarNo, sarTyCd, occurredAt: new Date(m.createdAt), operator: APP_OPERATOR, remark: `${m.type} ${m.source ?? ''}`.trim(),
          lines: [{
            itemCd: item.etimsItemCd, itemClsCd: this.classOf(item, business) ?? '', name: item.name, barcode: item.barcode, ...this.units(item),
            qty: Math.abs(m.quantity), unitPriceCents: (incomingPurchase ? item.costPriceCents : null) ?? item.retailPriceCents, taxType: this.taxTypeOf(item.taxClass),
          }],
        });
        try {
          await client.call(this.identity(creds), '/insertStockIO', body);
        } catch (e) {
          if (!(e instanceof OscuError && e.kind === 'duplicate')) {
            await this.prisma.business.updateMany({ where: { id: business.id, etimsSarSeq: sarNo }, data: { etimsSarSeq: sarNo - 1 } });
            throw e;
          }
        }
        const level = await this.prisma.inventoryMovement.aggregate({ where: { businessId: business.id, itemId: item.id }, _sum: { quantity: true } });
        await client.call(this.identity(creds), '/saveStockMaster', buildStockMasterPayload(item.etimsItemCd, level._sum.quantity ?? 0, APP_OPERATOR));
        await this.prisma.inventoryMovement.update({ where: { id: m.id }, data: { etimsSarNo: sarNo, etimsReportedAt: new Date(), etimsError: null } });
        reported++;
      } catch (e) {
        failed++;
        await this.prisma.inventoryMovement.update({ where: { id: m.id }, data: { etimsError: String((e as Error).message).slice(0, 500) } });
        if (e instanceof OscuError && e.retryable) break; // KRA is down: stop and try the rest next time
      }
    }
    return { reported, failed };
  }

  // ─── KRA item classes ───────────────────────────────────────────────────────

  /** Download KRA's item class list into our table (needs one connected business to authenticate with). */
  async syncItemClasses(businessId: string): Promise<{ count: number }> {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    const creds = this.credentialsOf(business);
    if (!creds) throw new OscuError('Connect this business to KRA eTIMS first', 'auth');
    const env = await this.client(businessId).call(this.identity(creds), '/selectItemClsList', { lastReqDt: '20180101000000' });
    const list: any[] = env.data?.itemClsList ?? [];
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500).filter((c) => c?.itemClsCd);
      await this.prisma.$transaction(chunk.map((c) => this.prisma.etimsItemClass.upsert({
        where: { itemClsCd: String(c.itemClsCd).trim() },
        create: { itemClsCd: String(c.itemClsCd).trim(), itemClsNm: String(c.itemClsNm ?? '').trim(), itemClsLvl: c.itemClsLvl != null ? Number(c.itemClsLvl) : null, taxTyCd: c.taxTyCd ?? null, useYn: c.useYn !== 'N' },
        update: { itemClsNm: String(c.itemClsNm ?? '').trim(), itemClsLvl: c.itemClsLvl != null ? Number(c.itemClsLvl) : null, taxTyCd: c.taxTyCd ?? null, useYn: c.useYn !== 'N' },
      })));
    }
    return { count: list.length };
  }

  // ─── The call log ───────────────────────────────────────────────────────────

  private async logCall(businessId: string, log: OscuCallLog): Promise<void> {
    await this.prisma.etimsCallLog.create({
      data: {
        businessId, path: log.path, request: log.request as any, response: (log.response ?? undefined) as any,
        resultCd: log.resultCd, ok: log.ok, durationMs: log.durationMs, error: log.error?.slice(0, 1000) ?? null,
      },
    });
  }
}

export { CREDIT_NOTE_REASON };

// ─── Encryption (same scheme as the rest of the eTIMS credentials) ─────────────

function key(): Buffer {
  return Buffer.from(process.env.ENCRYPTION_KEY ?? '0'.repeat(64), 'hex');
}

export function encrypt(value: unknown): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key(), iv);
  return `${iv.toString('hex')}:${cipher.update(JSON.stringify(value), 'utf8', 'hex')}${cipher.final('hex')}`;
}

export function decrypt(encrypted: string): any {
  const [ivHex, data] = encrypted.split(':');
  if (!data) throw new Error('Unsupported credential format');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key(), Buffer.from(ivHex, 'hex'));
  return JSON.parse(decipher.update(data, 'hex', 'utf8') + decipher.final('utf8'));
}
