import { etimsPaymentType } from './etims-payment';
import { Injectable, BadRequestException, BadGatewayException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';
import { etimsLineTax, etimsTaxTotals } from './etims-tax';

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

// ─── KRA eTIMS API interfaces ─────────────────────────────────────────────────

interface EtimsInvoiceItem {
  itemSeq: number;
  itemCd: string;
  itemClsCd: string;
  itemNm: string;
  pkgUnitCd: string;
  pkg: number;
  qtyUnitCd: string;
  qty: number;
  prc: number;
  splyAmt: number;
  dcRt: number;
  dcAmt: number;
  taxblAmt: number;
  taxTyCd: string;
  taxAmt: number;
  totAmt: number;
}

interface EtimsInvoicePayload {
  invoiceNo: string;
  tpin: string;
  branchId: string;
  tradeTerms: string;
  saleDate: string;
  stockRlsDt?: string;
  cfmDt?: string;
  cnclReqDt?: string;
  cnclDate?: string;
  rfdRsnCd?: string;
  orgInvcNo?: string;
  pmtTyCd: string;
  rcptTyCd: string;
  salesSttsCd?: string;
  totItemCnt?: number;
  prchrAcptcYn?: string;
  prchrTpin?: string;   // buyer KRA PIN — required when prchrAcptcYn = 'Y'
  remark?: string;
  taxblAmtA: number;
  taxblAmtB: number;
  taxblAmtC: number;
  taxblAmtD: number;
  taxAmtA: number;
  taxAmtB: number;
  taxAmtC: number;
  taxAmtD: number;
  totTaxblAmt: number;
  totTaxAmt: number;
  totAmt: number;
  itemList: EtimsInvoiceItem[];
}

interface EtimsProductionOnboardingDto {
  businessId: string;
  kraPin: string;
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

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ─── Production onboarding ────────────────────────────────────────────────

  async initiateProductionOnboarding(dto: EtimsProductionOnboardingDto) {
    const business = await this.prisma.business.findUnique({ where: { id: dto.businessId } });
    if (!business) throw new BadRequestException('Business not found');
    if (business.etimsProductionOnboarded) throw new BadRequestException('Business already onboarded to production');

    if (!/^[A-Z]\d{9}[A-Z]$/.test(dto.kraPin)) {
      throw new BadRequestException('Invalid KRA PIN format (expected: A123456789B)');
    }

    try {
      const response = await this.callEtimsApi('/api/device/initialize', {
        kraPin: dto.kraPin,
        bhfId: '00', // branch ID — default head office
        dvcSrlNo: `FAIDA-${dto.businessId.slice(0, 8).toUpperCase()}`,
        txdtDt: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      });

      const deviceId = response.deviceId ?? response.dvcId ?? `DEV_${Date.now()}`;
      const deviceKey = response.deviceKey ?? response.sdcId ?? crypto.randomBytes(32).toString('hex');

      await this.prisma.business.update({
        where: { id: dto.businessId },
        data: {
          etimsMode: 'PRODUCTION',
          etimsProductionOnboarded: true,
          etimsCredentialsEncrypted: this.encryptCredentials({
            deviceId,
            deviceKey,
            kraPin: dto.kraPin,
            branchId: '00',
          }),
        },
      });

      await this.audit.createEntry({
        businessId: dto.businessId,
        actor: 'system',
        actorType: 'SYSTEM',
        action: 'ETIMS_PRODUCTION_ONBOARDED',
        entity: 'Business',
        entityId: dto.businessId,
        after: { etimsMode: 'PRODUCTION', kraPin: dto.kraPin },
        source: 'SYSTEM',
      });

      return { success: true, deviceId, message: 'Successfully onboarded to eTIMS production' };
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
    if (sale.etimsSubmitted) {
      const biz = await this.prisma.business.findUnique({ where: { id: sale.businessId } });
      if (this.isTestSubmission(biz, sale.etimsControlNumber)) {
        // No proof to show: a QR for a made-up control number would only fail on KRA's verification page.
        return { success: true, controlNumber: sale.etimsControlNumber ?? undefined, testMode: true };
      }
      const sign = (sale as any).etimsIntrlData ?? sale.etimsControlNumber ?? undefined;
      const id = this.etimsIdentity(biz);
      return {
        success: true,
        controlNumber: sale.etimsControlNumber ?? undefined,
        intrlData: sign,
        qrUrl: this.buildEtimsQrUrl(id.kraPin, id.branchId, sign),
        testMode: false,
      };
    }

    const business = await this.prisma.business.findUnique({ where: { id: sale.businessId } });
    let controlNumber: string;
    let intrlData: string;

    if (business?.etimsMode === 'PRODUCTION' && business.etimsCredentialsEncrypted) {
      // Real KRA eTIMS submission
      const result = await this.submitToEtims(sale, business);
      controlNumber = result.controlNumber;
      intrlData = result.intrlData;
    } else {
      // Sandbox: generate realistic mock values
      controlNumber = `ETM${Date.now()}`;
      intrlData = `${sale.receiptNumber}|${controlNumber}|${new Date().toISOString().slice(0,10)}`;
    }

    await this.prisma.sale.update({
      where: { id: saleId },
      data: {
        etimsSubmitted: true,
        etimsControlNumber: controlNumber,
      },
    });

    await this.audit.createEntry({
      businessId: sale.businessId, action: 'ETIMS_SUBMIT',
      entity: 'Sale', entityId: saleId, source: 'SYSTEM',
      actor: 'system', actorType: 'SYSTEM',
      after: { controlNumber },
    });

    if (this.isTestSubmission(business, controlNumber)) return { success: true, controlNumber, testMode: true };
    const identity = this.etimsIdentity(business);
    return {
      success: true,
      controlNumber,
      intrlData,
      qrUrl: this.buildEtimsQrUrl(identity.kraPin, identity.branchId, intrlData),
      testMode: false,
    };
  }

  /** The seller PIN and branch id live inside the encrypted eTIMS credentials. */
  private etimsIdentity(
    business: { etimsCredentialsEncrypted?: string | null } | null,
  ): { kraPin?: string; branchId: string } {
    if (!business?.etimsCredentialsEncrypted) return { branchId: '00' };
    try {
      const creds = this.decryptCredentials(business.etimsCredentialsEncrypted);
      return { kraPin: creds.kraPin, branchId: creds.branchId ?? '00' };
    } catch {
      return { branchId: '00' };
    }
  }

  async submitAmendment(saleId: string): Promise<{ success: boolean }> {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new BadRequestException('Sale not found');

    const business = await this.prisma.business.findUnique({ where: { id: sale.businessId } });
    if (business?.etimsMode === 'PRODUCTION' && business.etimsCredentialsEncrypted && sale.etimsControlNumber) {
      await this.submitToEtimsAmendment(sale, business);
    }

    await this.audit.createEntry({
      businessId: sale.businessId, action: 'ETIMS_AMEND',
      entity: 'Sale', entityId: saleId, source: 'SYSTEM',
      actor: 'system', actorType: 'SYSTEM',
    });

    return { success: true };
  }

  /**
   * Submit a Credit Note (rcptTyCd = 'R') to eTIMS for a processed return.
   * Called non-blocking after the return transaction commits.
   * KRA requires a CN referencing the original invoice for every return.
   */
  async submitCreditNote(returnId: string): Promise<void> {
    const ret = await this.prisma.return.findUnique({
      where: { id: returnId },
      include: {
        sale: {
          include: { items: { include: { item: true } } },
        },
      },
    });
    if (!ret) return;
    if (ret.etimsCreditNoteSubmitted) return;

    const sale = ret.sale;
    if (!sale.etimsSubmitted || !sale.etimsControlNumber) {
      // Original sale was never submitted to eTIMS — no CN needed
      return;
    }

    const business = await this.prisma.business.findUnique({ where: { id: ret.businessId } });

    let creditNoteRef: string;

    if (business?.etimsMode === 'PRODUCTION' && business.etimsCredentialsEncrypted) {
      try {
        creditNoteRef = await this.submitToEtimsCreditNote(ret, sale, business);
      } catch (error) {
        console.error('eTIMS credit note submission failed:', error);
        return;
      }
    } else {
      // Sandbox: generate mock ref
      creditNoteRef = `CN${Date.now()}`;
    }

    await this.prisma.return.update({
      where: { id: returnId },
      data: { etimsCreditNoteSubmitted: true, etimsCreditNoteRef: creditNoteRef },
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

  async voidSale(saleId: string, reason: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new BadRequestException('Sale not found');

    const business = await this.prisma.business.findUnique({ where: { id: sale.businessId } });

    if (business?.etimsMode === 'PRODUCTION' && sale.etimsSubmitted && business.etimsCredentialsEncrypted) {
      try {
        const voidRef = await this.submitEtimsVoid(sale, business, reason);
        await this.prisma.voidRecord.updateMany({
          where: { saleId },
          data: { etimsVoidRef: voidRef },
        });
      } catch (error) {
        console.error('eTIMS void submission failed:', error);
      }
    }

    return { success: true };
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

  // ─── Real KRA eTIMS HTTP calls ────────────────────────────────────────────

  private async submitToEtims(sale: any, business: any): Promise<{ controlNumber: string; intrlData: string }> {
    const creds = this.decryptCredentials(business.etimsCredentialsEncrypted);
    const [saleWithItems, customerRecord] = await Promise.all([
      this.prisma.sale.findUnique({
        where: { id: sale.id },
        include: { items: { include: { item: true } }, payments: true },
      }),
      sale.customerId
        ? this.prisma.customer.findUnique({ where: { id: sale.customerId }, select: { kraPin: true } })
        : null,
    ]);
    // The customer's own PIN, else the one recorded on the sale (a fleet company is not a Customer record).
    const buyerKraPin = customerRecord?.kraPin ?? (sale as { buyerKraPin?: string | null }).buyerKraPin ?? null;

    const saleDateStr = new Date(sale.createdAt).toISOString().slice(0, 10).replace(/-/g, '');

    const lineTaxes = (saleWithItems?.items ?? []).map((si) => etimsLineTax(si));
    const itemList: EtimsInvoiceItem[] = (saleWithItems?.items ?? []).map((si, idx) => {
      const tx = lineTaxes[idx];
      const unitPrice = si.unitPriceCents / 100;
      const qty = si.quantity;
      // Use KRA item classification code stored on item, fall back to generic goods code
      const itemClsCd = (si.item as any)?.kraItemCode ?? '5020230602';

      return {
        itemSeq: idx + 1,
        itemCd: (si.item as any)?.barcode ?? (si.item as any)?.sku ?? `KA${String(idx + 1).padStart(5,'0')}`,
        itemClsCd,
        itemNm: si.item?.name ?? 'Item',
        bcd: (si.item as any)?.barcode ?? '',
        pkgUnitCd: 'NT',
        pkg: qty,
        qtyUnitCd: 'U',
        qty,
        prc: unitPrice,
        splyAmt: tx.supplyCents / 100,
        dcRt: tx.supplyCents > 0 ? Math.round((tx.discountCents / tx.supplyCents) * 10000) / 100 : 0,
        dcAmt: tx.discountCents / 100,
        taxblAmt: tx.taxableCents / 100,
        taxTyCd: tx.taxTyCd,
        taxAmt: tx.taxCents / 100,
        totAmt: tx.amountCents / 100,
      };
    });
    const taxTotals = etimsTaxTotals(lineTaxes);

    const totalAmt = sale.totalCents / 100;
    const pmtTyCd = etimsPaymentType(saleWithItems?.payments ?? [], sale.type === 'CREDIT');

    const payload: EtimsInvoicePayload = {
      invoiceNo: sale.receiptNumber,
      tpin: creds.kraPin,
      branchId: creds.branchId ?? '00',
      tradeTerms: 'CSH',
      saleDate: saleDateStr,
      stockRlsDt: saleDateStr,
      pmtTyCd,
      rcptTyCd: 'S',
      salesSttsCd: '02',           // 02 = Approved/Confirmed
      totItemCnt: itemList.length,
      cfmDt: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      prchrAcptcYn: buyerKraPin ? 'Y' : 'N',
      ...(buyerKraPin ? { prchrTpin: buyerKraPin } : {}),
      ...taxTotals,
      totAmt: totalAmt,
      itemList,
    };

    const response = await this.callEtimsApiWithAuth(creds, '/api/trnsSales/saveTaxInvoice', payload);

    // KRA returns intrlData (the cryptographic receipt signature) — this is what goes in the QR code
    const controlNumber = response.controlNo ?? response.rcptNo ?? `ETM${Date.now()}`;
    const intrlData = response.intrlData ?? response.rcptSign ?? controlNumber;

    return { controlNumber, intrlData };
  }

  private async submitToEtimsAmendment(sale: any, business: any): Promise<void> {
    const creds = this.decryptCredentials(business.etimsCredentialsEncrypted);
    await this.callEtimsApiWithAuth(creds, '/api/trnsSales/saveTaxInvoice', {
      invoiceNo: `${sale.receiptNumber}-AMD`,
      tpin: creds.kraPin,
      branchId: creds.branchId ?? '00',
      orgInvcNo: sale.etimsControlNumber,
      rcptTyCd: 'A', // amendment
      saleDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    });
  }

  private async submitEtimsVoid(sale: any, business: any, reason: string): Promise<string> {
    const creds = this.decryptCredentials(business.etimsCredentialsEncrypted);
    const response = await this.callEtimsApiWithAuth(creds, '/api/trnsSales/saveTaxInvoice', {
      invoiceNo: sale.receiptNumber,
      tpin: creds.kraPin,
      branchId: creds.branchId ?? '00',
      orgInvcNo: sale.etimsControlNumber,
      rcptTyCd: 'C', // cancellation
      cnclReqDt: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      cnclDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      rfdRsnCd: '01', // reason code 01 = wrong entry
      remark: reason,
    });
    return response.voidRef ?? `VOID_${Date.now()}`;
  }

  /**
   * Submit credit note (rcptTyCd = 'R') to KRA eTIMS.
   * References the original sale's eTIMS control number via orgInvcNo.
   * Only the returned items are included in the itemList.
   */
  private async submitToEtimsCreditNote(ret: any, sale: any, business: any): Promise<string> {
    const creds = this.decryptCredentials(business.etimsCredentialsEncrypted);

    const returnedIds: string[] = JSON.parse(ret.returnedItemIds || '[]');
    const itemsToReturn = returnedIds.length > 0
      ? sale.items.filter((i: any) => returnedIds.includes(i.id))
      : sale.items;

    const cnDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const lineTaxes = itemsToReturn.map((si: any) => etimsLineTax(si));
    const itemList = itemsToReturn.map((si: any, idx: number) => {
      const tx = lineTaxes[idx];
      return {
        itemSeq:    idx + 1,
        itemCd:     si.item?.barcode ?? si.item?.sku ?? `KA${String(idx + 1).padStart(5,'0')}`,
        itemClsCd:  si.item?.kraItemCode ?? '5020230602',
        itemNm:     si.item?.name ?? 'Item',
        bcd:        si.item?.barcode ?? '',
        pkgUnitCd:  'NT',
        pkg:        si.quantity,
        qtyUnitCd:  'U',
        qty:        si.quantity,
        prc:        si.unitPriceCents / 100,
        splyAmt:    tx.supplyCents / 100,
        dcRt:       tx.supplyCents > 0 ? Math.round((tx.discountCents / tx.supplyCents) * 10000) / 100 : 0,
        dcAmt:      tx.discountCents / 100,
        taxblAmt:   tx.taxableCents / 100,
        taxTyCd:    tx.taxTyCd,
        taxAmt:     tx.taxCents / 100,
        totAmt:     tx.amountCents / 100,
      };
    });

    // The credit note refunds what was paid for the returned lines: after their share of the discount.
    const totAmt = lineTaxes.reduce((sum: number, l: { amountCents: number }) => sum + l.amountCents, 0) / 100;
    const taxTotals = etimsTaxTotals(lineTaxes);

    const payload = {
      invoiceNo:    `${sale.receiptNumber}-CN`,
      tpin:         creds.kraPin,
      branchId:     creds.branchId ?? '00',
      orgInvcNo:    sale.etimsControlNumber,   // links CN to original invoice
      rcptTyCd:     'R',                        // R = Return / Credit Note
      salesSttsCd:  '02',
      saleDate:     cnDate,
      stockRlsDt:   cnDate,
      cfmDt:        cnDate,
      pmtTyCd:      'CN',                       // credit note payment type
      rfdRsnCd:     '01',                       // 01 = customer return
      tradeTerms:   'CSH',
      prchrAcptcYn: 'N',
      totItemCnt:   itemList.length,
      ...taxTotals,
      totAmt,
      itemList,
    };

    const response = await this.callEtimsApiWithAuth(creds, '/api/trnsSales/saveTaxInvoice', payload);
    return response.controlNo ?? response.rcptNo ?? `CN${Date.now()}`;
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────

  private async callEtimsApi(path: string, body: any): Promise<any> {
    if (!this.isProductionEnv) {
      // Sandbox: return mock response
      return {
        deviceId: `DEV_${Date.now()}`,
        deviceKey: crypto.randomBytes(32).toString('hex'),
        status: 'APPROVED',
      };
    }

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new BadGatewayException(`eTIMS API error ${response.status}: ${text}`);
    }

    const json = await response.json() as any;
    if (json.resultCd !== '000') {
      throw new BadGatewayException(`eTIMS error ${json.resultCd}: ${json.resultMsg}`);
    }

    return json.data ?? json;
  }

  private async callEtimsApiWithAuth(creds: any, path: string, body: any): Promise<any> {
    if (!this.isProductionEnv) {
      return { controlNo: `ETM${Date.now()}`, status: 'APPROVED' };
    }

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'tin': creds.kraPin ?? creds.tin,
        'bhfId': creds.branchId ?? creds.bhfId ?? '00',
        'dvcSrlNo': creds.dvcSrno ?? creds.deviceId ?? '',
      },
      body: JSON.stringify({
        ...body,
        tpin: creds.kraPin ?? creds.tin,
        bhfId: creds.branchId ?? creds.bhfId ?? '00',
        dvcSrlNo: creds.dvcSrno ?? creds.deviceId ?? '',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new BadGatewayException(`eTIMS API error ${response.status}: ${text}`);
    }

    const json = await response.json() as any;
    if (json.resultCd !== '000') {
      throw new BadGatewayException(`eTIMS error ${json.resultCd}: ${json.resultMsg}`);
    }

    return json.data ?? json;
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
