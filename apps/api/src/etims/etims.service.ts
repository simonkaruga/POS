import { Injectable, BadRequestException, BadGatewayException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';
import { EtimsOscuService, CREDIT_NOTE_REASON } from './oscu/etims-oscu.service';
import { OscuError } from './oscu/oscu-client';

/** What the sandbox generates in place of a KRA control number: ETM + a millisecond timestamp. */
const MOCK_CONTROL_NUMBER = /^ETM\d{10,}$/;

/**
 * KRA's public eTIMS receipt-verification endpoint. Scanning a compliant receipt QR
 * opens this page with the seller PIN + branch + receipt signature, exactly like the
 * QR printed by a KRA-approved control unit.
 */
const ETIMS_VERIFY_BASE =
  process.env.ETIMS_VERIFY_URL ??
  'https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData';

interface EtimsProductionOnboardingDto {
  businessId: string;
  kraPin: string;
  /** The OSCU device serial number KRA issued on the eTIMS portal. */
  dvcSrlNo?: string;
  /** The branch id KRA registered (00 = head office). */
  bhfId?: string;
  businessName: string;
  businessAddress: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  certificateFile?: string;
}

interface ItaxVatReturnDto {
  businessId: string;
  period: string;
  totalSales: number;
  totalPurchases: number;
  vatOnSales: number;
  vatOnPurchases: number;
  netVat: number;
}

@Injectable()
export class EtimsService {
  private readonly ETIMS_SANDBOX_URL = 'https://etims-sbx.kra.go.ke/etims-api';
  private readonly ETIMS_PRODUCTION_URL = 'https://etims-api.kra.go.ke/etims-api';

  private get isProductionEnv(): boolean {
    return process.env.ETIMS_ENV === 'production';
  }

  private get baseUrl(): string {
    return this.isProductionEnv ? this.ETIMS_PRODUCTION_URL : this.ETIMS_SANDBOX_URL;
  }

  private readonly oscu: EtimsOscuService;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    oscu?: EtimsOscuService,
  ) {
    this.oscu = oscu ?? new EtimsOscuService(prisma);
  }

  /** A KRA refusal is the caller's data (400); KRA being unreachable is a gateway problem (502, retried later). */
  private kraError(e: unknown): never {
    if (e instanceof OscuError) {
      if (e.retryable) throw new BadGatewayException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }

  // ─── Production onboarding ────────────────────────────────────────────────

  async initiateProductionOnboarding(dto: EtimsProductionOnboardingDto) {
    const business = await this.prisma.business.findUnique({ where: { id: dto.businessId } });
    if (!business) throw new BadRequestException('Business not found');
    if (business.etimsProductionOnboarded) throw new BadRequestException('Business already onboarded to production');

    if (!/^[A-Z]\d{9}[A-Z]$/.test(dto.kraPin)) {
      throw new BadRequestException('Invalid KRA PIN format (expected: A123456789B)');
    }

    if (!dto.dvcSrlNo?.trim()) {
      throw new BadRequestException('Enter the OSCU device serial number from the KRA eTIMS portal');
    }

    try {
      const creds = await this.oscu.connect(dto.businessId, { tin: dto.kraPin, bhfId: dto.bhfId ?? '00', dvcSrlNo: dto.dvcSrlNo });

      await this.audit.createEntry({
        businessId: dto.businessId,
        actor: 'system',
        actorType: 'SYSTEM',
        action: 'ETIMS_PRODUCTION_ONBOARDED',
        entity: 'Business',
        entityId: dto.businessId,
        after: { etimsMode: 'PRODUCTION', kraPin: creds.tin, branchId: creds.bhfId, device: creds.dvcSrlNo },
        source: 'SYSTEM',
      });

      return { success: true, deviceId: creds.sdcId ?? creds.dvcSrlNo, message: `Connected to KRA eTIMS as ${creds.tradeNm ?? creds.tin}` };
    } catch (error) {
      throw new BadRequestException(`eTIMS onboarding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async switchToProductionMode(businessId: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new BadRequestException('Business not found');
    if (!business.etimsProductionOnboarded) {
      throw new BadRequestException('Business must complete production onboarding first');
    }

    await this.prisma.business.update({ where: { id: businessId }, data: { etimsMode: 'PRODUCTION' } });
    await this.audit.createEntry({
      businessId, actor: 'system', actorType: 'SYSTEM',
      action: 'ETIMS_MODE_SWITCHED', entity: 'Business', entityId: businessId,
      after: { etimsMode: 'PRODUCTION' }, source: 'SYSTEM',
    });

    return { success: true, message: 'Switched to eTIMS production mode' };
  }

  // ─── iTax integration ─────────────────────────────────────────────────────

  async enableItaxIntegration(businessId: string, credentials: {
    username: string;
    password: string;
    kraPin: string;
  }) {
    const isValid = await this.validateItaxCredentials(credentials);
    if (!isValid) throw new BadRequestException('Invalid iTax credentials');

    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        kraItaxIntegrationEnabled: true,
        kraItaxCredentials: this.encryptCredentials(credentials),
      },
    });

    await this.audit.createEntry({
      businessId, actor: 'system', actorType: 'SYSTEM',
      action: 'ITAX_INTEGRATION_ENABLED', entity: 'Business', entityId: businessId,
      source: 'SYSTEM',
    });

    return { success: true, message: 'iTax integration enabled successfully' };
  }

  async submitVatReturn(dto: ItaxVatReturnDto) {
    const business = await this.prisma.business.findUnique({ where: { id: dto.businessId } });
    if (!business?.kraItaxIntegrationEnabled || !business.kraItaxCredentials) {
      throw new BadRequestException('iTax integration not enabled for this business');
    }

    const credentials = this.decryptCredentials(business.kraItaxCredentials);

    try {
      const response = await this.callItaxApi(credentials, {
        kraPin: credentials.kraPin,
        period: dto.period,
        totalSales: dto.totalSales,
        totalPurchases: dto.totalPurchases,
        vatOnSales: dto.vatOnSales,
        vatOnPurchases: dto.vatOnPurchases,
        netVat: dto.netVat,
        submissionDate: new Date().toISOString(),
      });

      await this.audit.createEntry({
        businessId: dto.businessId, actor: 'system', actorType: 'SYSTEM',
        action: 'VAT_RETURN_SUBMITTED', entity: 'Business', entityId: dto.businessId,
        after: { period: dto.period, netVat: dto.netVat, referenceNumber: response.referenceNumber },
        source: 'SYSTEM',
      });

      return { success: true, referenceNumber: response.referenceNumber, message: 'VAT return submitted successfully' };
    } catch (error) {
      throw new BadRequestException(`VAT return submission failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getVatReturnData(businessId: string, period: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) {
      throw new BadRequestException('period must be in YYYY-MM format');
    }
    const [year, month] = period.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const sales = await this.prisma.sale.findMany({
      where: { businessId, status: 'PAID', createdAt: { gte: startDate, lte: endDate } },
      include: { items: true },
    });
    const expenses = await this.prisma.expense.findMany({
      where: { businessId, createdAt: { gte: startDate, lte: endDate }, vatReclaimable: true },
    });

    const totalSales = sales.reduce((s, sale) => s + sale.totalCents, 0);
    const vatOnSales = sales.reduce((s, sale) => s + sale.vatCents, 0);
    const totalPurchases = expenses.reduce((s, e) => s + e.amountCents, 0);
    const vatOnPurchases = expenses.reduce((s, e) => s + e.vatAmountCents, 0);

    return {
      period,
      totalSales: totalSales / 100,
      totalPurchases: totalPurchases / 100,
      vatOnSales: vatOnSales / 100,
      vatOnPurchases: vatOnPurchases / 100,
      netVat: (vatOnSales - vatOnPurchases) / 100,
      salesCount: sales.length,
      expensesCount: expenses.length,
    };
  }

  // ─── Sale submission ──────────────────────────────────────────────────────

  /**
   * Build the QR payload that KRA expects on an eTIMS receipt.
   *
   * A compliant receipt QR is a **link into the KRA verification portal**, not the
   * bare signature — scanning it with any phone camera must land the buyer on the
   * KRA page showing the invoice. The `Data` parameter is the concatenation of the
   * seller PIN, the branch id and the receipt signature returned by KRA.
   */
  private buildEtimsQrUrl(kraPin?: string | null, branchId?: string | null, signature?: string | null): string | undefined {
    const pin = (kraPin ?? '').trim().toUpperCase();
    const branch = (branchId ?? '00').trim().padStart(2, '0');
    const sign = (signature ?? '').trim();
    if (!pin || !sign) return undefined;
    return `${ETIMS_VERIFY_BASE}?Data=${encodeURIComponent(`${pin}${branch}${sign}`)}`;
  }

  /**
   * True when a submission was NOT made to KRA: the business is not in PRODUCTION with credentials, or the
   * control number is one of our generated placeholders (a sale made in sandbox stays a test sale even after
   * the business goes live). Receipts for these must never read as a verified tax invoice.
   */
  private isTestSubmission(
    business: { etimsMode?: string | null; etimsCredentialsEncrypted?: string | null } | null,
    controlNumber?: string | null,
  ): boolean {
    const live = business?.etimsMode === 'PRODUCTION' && !!business.etimsCredentialsEncrypted;
    return !live || (!!controlNumber && MOCK_CONTROL_NUMBER.test(controlNumber));
  }

  async submitSale(saleId: string): Promise<{ success: boolean; controlNumber?: string; intrlData?: string; qrUrl?: string; reason?: string; testMode?: boolean }> {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new BadRequestException('Sale not found');
    const business = await this.prisma.business.findUnique({ where: { id: sale.businessId } });

    if (sale.etimsSubmitted) {
      if (this.isTestSubmission(business, sale.etimsControlNumber)) {
        // No proof to show: a QR for a made-up control number would only fail on KRA's verification page.
        return { success: true, controlNumber: sale.etimsControlNumber ?? undefined, testMode: true };
      }
      const s = sale as typeof sale & { etimsRcptSign?: string | null; etimsIntrlData?: string | null };
      const sign = s.etimsRcptSign ?? s.etimsIntrlData ?? sale.etimsControlNumber ?? undefined;
      const id = this.etimsIdentity(business);
      return {
        success: true,
        controlNumber: sale.etimsControlNumber ?? undefined,
        intrlData: s.etimsIntrlData ?? sign,
        qrUrl: this.buildEtimsQrUrl(id.kraPin, id.branchId, s.etimsRcptSign ?? sign),
        testMode: false,
      };
    }

    // A business connected to KRA: the invoice is signed by KRA, never generated here.
    if (this.oscu.isLive(business)) {
      let signed;
      try { signed = await this.oscu.submitSale(saleId); } catch (e) { this.kraError(e); }
      await this.audit.createEntry({
        businessId: sale.businessId, action: 'ETIMS_SUBMIT', entity: 'Sale', entityId: saleId, source: 'SYSTEM',
        actor: 'system', actorType: 'SYSTEM', after: { invcNo: signed.invcNo, controlNumber: signed.controlNumber },
      });
      return { success: true, controlNumber: signed.controlNumber, intrlData: signed.intrlData ?? undefined, qrUrl: signed.qrUrl ?? undefined, testMode: false };
    }
    if (business?.etimsMode === 'PRODUCTION' && business.etimsCredentialsEncrypted) {
      // Credentials from before the OSCU rebuild carry no communication key: KRA would refuse every call.
      throw new BadRequestException('Reconnect this business to KRA eTIMS (Settings → KRA eTIMS) with the device serial from the eTIMS portal');
    }

    // Sandbox: a realistic placeholder, clearly marked as a test on the receipt.
    const controlNumber = `ETM${Date.now()}`;
    await this.prisma.sale.update({ where: { id: saleId }, data: { etimsSubmitted: true, etimsControlNumber: controlNumber } });
    await this.audit.createEntry({
      businessId: sale.businessId, action: 'ETIMS_SUBMIT', entity: 'Sale', entityId: saleId, source: 'SYSTEM',
      actor: 'system', actorType: 'SYSTEM', after: { controlNumber },
    });
    return { success: true, controlNumber, testMode: true };
  }

  /** The seller PIN and branch id live inside the encrypted eTIMS credentials. */
  private etimsIdentity(
    business: { etimsCredentialsEncrypted?: string | null } | null,
  ): { kraPin?: string; branchId: string } {
    if (!business?.etimsCredentialsEncrypted) return { branchId: '00' };
    try {
      const creds = this.decryptCredentials(business.etimsCredentialsEncrypted);
      return { kraPin: creds.tin ?? creds.kraPin, branchId: creds.bhfId ?? creds.branchId ?? '00' };
    } catch {
      return { branchId: '00' };
    }
  }

  /**
   * Correct a signed sale. KRA has no "amend": the original invoice is credited in full, and the corrected sale is
   * then signed again under a new invoice number.
   */
  async submitAmendment(saleId: string): Promise<{ success: boolean }> {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new BadRequestException('Sale not found');

    const business = await this.prisma.business.findUnique({ where: { id: sale.businessId } });
    const s = sale as typeof sale & { etimsInvcNo?: number | null };
    if (this.oscu.isLive(business) && sale.etimsSubmitted && s.etimsInvcNo) {
      try { await this.oscu.creditNote(saleId, null, CREDIT_NOTE_REASON.MISSING_DATA); } catch (e) { this.kraError(e); }
      await this.prisma.sale.update({
        where: { id: saleId },
        data: { etimsSubmitted: false, etimsControlNumber: null, etimsInvcNo: null, etimsRcptSign: null, etimsIntrlData: null, etimsSignedAt: null } as any,
      });
      await this.submitSale(saleId);
    }

    await this.audit.createEntry({
      businessId: sale.businessId, action: 'ETIMS_AMEND',
      entity: 'Sale', entityId: saleId, source: 'SYSTEM',
      actor: 'system', actorType: 'SYSTEM',
    });

    return { success: true };
  }

  /**
   * Submit a credit note to eTIMS for a processed return. Called non-blocking after the return transaction commits;
   * a failure is kept on the return and retried by the eTIMS retry pass.
   * KRA requires a credit note referencing the original invoice for every return.
   */
  async submitCreditNote(returnId: string): Promise<void> {
    const ret = await this.prisma.return.findUnique({ where: { id: returnId }, include: { sale: true } });
    if (!ret || ret.etimsCreditNoteSubmitted) return;

    const sale = ret.sale;
    if (!sale.etimsSubmitted || !sale.etimsControlNumber) {
      // Original sale was never submitted to eTIMS: no credit note needed
      return;
    }

    const business = await this.prisma.business.findUnique({ where: { id: ret.businessId } });
    let creditNoteRef: string;
    let extra: Record<string, unknown> = {};

    if (this.oscu.isLive(business)) {
      try {
        const returnedIds: string[] = JSON.parse(ret.returnedItemIds || '[]');
        const signed = await this.oscu.creditNote(ret.saleId, returnedIds, CREDIT_NOTE_REASON.REFUND);
        creditNoteRef = signed.controlNumber;
        extra = { etimsCreditNoteInvcNo: signed.invcNo, etimsCreditNoteSign: signed.rcptSign, etimsCreditNoteError: null };
      } catch (error) {
        await this.prisma.return.update({ where: { id: returnId }, data: { etimsCreditNoteError: String((error as Error)?.message ?? error).slice(0, 500) } as any });
        return;
      }
    } else {
      // Sandbox: generate mock ref
      creditNoteRef = `CN${Date.now()}`;
    }

    await this.prisma.return.update({
      where: { id: returnId },
      data: { etimsCreditNoteSubmitted: true, etimsCreditNoteRef: creditNoteRef, ...extra } as any,
    });

    await this.audit.createEntry({
      businessId: ret.businessId,
      actor: 'system',
      actorType: 'SYSTEM',
      action: 'ETIMS_CREDIT_NOTE',
      entity: 'Return',
      entityId: returnId,
      after: { creditNoteRef, originalInvoice: sale.etimsControlNumber },
      source: 'SYSTEM',
    });
  }

  /** A void of a signed sale. KRA cannot cancel an invoice, so the voided lines are credited. */
  async voidSale(saleId: string, reason: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new BadRequestException('Sale not found');

    const business = await this.prisma.business.findUnique({ where: { id: sale.businessId } });

    if (this.oscu.isLive(business) && sale.etimsSubmitted) {
      try {
        const record = await this.prisma.voidRecord.findFirst({ where: { saleId }, orderBy: { createdAt: 'desc' } });
        let ids: string[] | null = null;
        try { const parsed = JSON.parse(record?.voidedItemIds ?? 'null'); ids = Array.isArray(parsed) && parsed.length ? parsed : null; } catch { ids = null; }
        const signed = await this.oscu.creditNote(saleId, ids, CREDIT_NOTE_REASON.REFUND);
        await this.prisma.voidRecord.updateMany({ where: { saleId }, data: { etimsVoidRef: signed.controlNumber } });
      } catch (error) {
        console.error(`eTIMS credit note for void (${reason}) failed:`, error);
      }
    }

    return { success: true };
  }

  // ─── Owner's eTIMS screen ───────────────────────────────────────────────────

  /** A sale belongs to the signed-in user's business, or the route answers "not found". */
  async assertSaleOwned(saleId: string, businessId: string): Promise<void> {
    const sale = await this.prisma.sale.findFirst({ where: { id: saleId, businessId }, select: { id: true } });
    if (!sale) throw new BadRequestException('Sale not found');
  }

  /** Everything the owner needs to know about the KRA connection, in one answer. */
  async status(businessId: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    const creds = this.oscu.credentialsOf(business);
    const legacy = business?.etimsMode === 'PRODUCTION' && !!business.etimsCredentialsEncrypted && !creds;
    const [pending, needsAttention, itemsWithoutClass, itemErrors, stockPending, stockErrors, creditNotesPending, lastCall] = await Promise.all([
      this.prisma.sale.count({ where: { businessId, etimsSubmitted: false, status: { in: ['PAID', 'CREDIT'] }, etimsNeedsAttention: false } as any }),
      this.prisma.sale.count({ where: { businessId, etimsNeedsAttention: true } as any }),
      business?.etimsDefaultItemClsCd ? 0 : this.prisma.item.count({ where: { businessId, isActive: true, deletedAt: null, OR: [{ kraItemCode: null }, { kraItemCode: '' }] } }),
      this.prisma.item.count({ where: { businessId, etimsRegisterError: { not: null } } as any }),
      creds ? this.prisma.inventoryMovement.count({ where: { businessId, etimsReportedAt: null, createdAt: { gte: business?.etimsLiveSince ?? new Date() } } as any }) : 0,
      this.prisma.inventoryMovement.count({ where: { businessId, etimsReportedAt: null, etimsError: { not: null } } as any }),
      this.prisma.return.count({ where: { businessId, etimsCreditNoteSubmitted: false, etimsCreditNoteError: { not: null } } as any }),
      this.prisma.etimsCallLog.findFirst({ where: { businessId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, ok: true, path: true, error: true } }),
    ]);
    return {
      mode: creds ? 'LIVE' : legacy ? 'RECONNECT' : 'SANDBOX',
      environment: this.oscu.environment,
      kraPin: creds?.tin ?? null,
      branchId: creds?.bhfId ?? null,
      device: creds?.dvcSrlNo ?? null,
      tradeName: creds?.tradeNm ?? null,
      liveSince: business?.etimsLiveSince ?? null,
      defaultItemClsCd: business?.etimsDefaultItemClsCd ?? null,
      lastInvoiceNo: business?.etimsInvcSeq ?? 0,
      pending, needsAttention, itemsWithoutClass, itemErrors, stockPending, stockErrors, creditNotesPending,
      lastCall,
    };
  }

  /** The things a person has to fix: refused invoices and items KRA cannot accept yet. */
  async attention(businessId: string) {
    const [sales, items] = await Promise.all([
      this.prisma.sale.findMany({
        where: { businessId, etimsNeedsAttention: true } as any,
        select: { id: true, receiptNumber: true, totalCents: true, createdAt: true, etimsLastError: true, etimsAttempts: true } as any,
        orderBy: { createdAt: 'desc' }, take: 100,
      }),
      this.prisma.item.findMany({
        where: { businessId, isActive: true, deletedAt: null, OR: [{ kraItemCode: null }, { kraItemCode: '' }, { etimsRegisterError: { not: null } }] } as any,
        select: { id: true, name: true, category: true, taxClass: true, kraItemCode: true, etimsQtyUnitCd: true, etimsRegisterError: true } as any,
        orderBy: { name: 'asc' }, take: 500,
      }),
    ]);
    return { sales, items };
  }

  /** Send a refused sale again after the problem (usually an item class) was fixed. */
  async retrySale(saleId: string, businessId: string) {
    await this.assertSaleOwned(saleId, businessId);
    await this.prisma.sale.update({ where: { id: saleId }, data: { etimsNeedsAttention: false } as any });
    return this.submitSale(saleId);
  }

  async searchItemClasses(q: string) {
    const term = (q ?? '').trim();
    return this.prisma.etimsItemClass.findMany({
      where: { useYn: true, ...(term ? { OR: [{ itemClsNm: { contains: term, mode: 'insensitive' } }, { itemClsCd: { startsWith: term } }] } : {}) },
      orderBy: [{ itemClsLvl: 'desc' }, { itemClsNm: 'asc' }],
      take: 50,
    });
  }

  async syncItemClasses(businessId: string) {
    try { return await this.oscu.syncItemClasses(businessId); } catch (e) { this.kraError(e); }
  }

  /** Set the KRA item class (and optionally the KRA units) of one or more items. Re-registers them on the next sale. */
  async setItemsKra(businessId: string, itemIds: string[], data: { itemClsCd?: string; qtyUnitCd?: string; pkgUnitCd?: string }) {
    if (data.itemClsCd !== undefined && !/^\d{10}$/.test(data.itemClsCd)) throw new BadRequestException('A KRA item class is 10 digits');
    const r = await this.prisma.item.updateMany({
      where: { id: { in: itemIds }, businessId },
      data: {
        ...(data.itemClsCd !== undefined ? { kraItemCode: data.itemClsCd } : {}),
        ...(data.qtyUnitCd ? { etimsQtyUnitCd: data.qtyUnitCd } : {}),
        ...(data.pkgUnitCd ? { etimsPkgUnitCd: data.pkgUnitCd } : {}),
        etimsRegisterError: null,
      } as any,
    });
    return { updated: r.count };
  }

  async setDefaultItemClass(businessId: string, itemClsCd: string | null) {
    if (itemClsCd && !/^\d{10}$/.test(itemClsCd)) throw new BadRequestException('A KRA item class is 10 digits');
    await this.prisma.business.update({ where: { id: businessId }, data: { etimsDefaultItemClsCd: itemClsCd || null } as any });
    return { defaultItemClsCd: itemClsCd || null };
  }

  async recentCalls(businessId: string, limit = 50) {
    return this.prisma.etimsCallLog.findMany({
      where: { businessId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 200),
      select: { id: true, createdAt: true, path: true, ok: true, resultCd: true, durationMs: true, error: true },
    });
  }

  async reportStockNow(businessId: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!this.oscu.isLive(business)) throw new BadRequestException('Connect this business to KRA eTIMS first');
    return this.oscu.reportStock(business);
  }

  async getStockStatus(businessId: string): Promise<{ pending: number; submitted: number }> {
    const [pending, submitted] = await Promise.all([
      this.prisma.sale.count({ where: { businessId, etimsSubmitted: false, status: 'PAID' } }),
      this.prisma.sale.count({ where: { businessId, etimsSubmitted: true } }),
    ]);
    return { pending, submitted };
  }

  async getPendingCount(businessId: string): Promise<{ count: number }> {
    const count = await this.prisma.sale.count({ where: { businessId, etimsSubmitted: false, status: 'PAID' } });
    return { count };
  }

  async batchSubmit(businessId: string): Promise<{ submitted: number; failed: number }> {
    const pending = await this.prisma.sale.findMany({
      where: { businessId, etimsSubmitted: false, status: 'PAID' },
      take: 50,
      select: { id: true },
    });
    let submitted = 0;
    let failed = 0;
    for (const sale of pending) {
      try { await this.submitSale(sale.id); submitted++; }
      catch { failed++; }
    }
    return { submitted, failed };
  }

  private async callItaxApi(credentials: any, data: any): Promise<any> {
    if (!this.isProductionEnv) {
      return { referenceNumber: `VAT_${Date.now()}`, status: 'SUBMITTED' };
    }

    const response = await fetch(`https://itax.kra.go.ke/api/vat/return`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new BadGatewayException(`iTax API error ${response.status}`);
    }

    return response.json();
  }

  private async validateItaxCredentials(credentials: any): Promise<boolean> {
    if (!this.isProductionEnv) {
      return !!(credentials.username && credentials.password && credentials.kraPin);
    }

    try {
      const response = await fetch('https://itax.kra.go.ke/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: credentials.username, password: credentials.password }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ─── Encryption helpers ───────────────────────────────────────────────────

  private encryptCredentials(credentials: any): string {
    const keyHex = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(JSON.stringify(credentials), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  private decryptCredentials(encryptedCredentials: string): any {
    const keyHex = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
    const key = Buffer.from(keyHex, 'hex');

    // Support both new IV:ciphertext format and legacy format
    if (encryptedCredentials.includes(':')) {
      const [ivHex, ciphertext] = encryptedCredentials.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    }

    // Legacy: createCipher (no IV) — fallback for old records
    const decipher = crypto.createDecipher('aes-256-cbc', keyHex);
    let decrypted = decipher.update(encryptedCredentials, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }
}
