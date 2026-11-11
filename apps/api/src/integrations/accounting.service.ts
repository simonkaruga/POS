import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** Accounting-specific integration service for QuickBooks Online and Sage */
@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);
  private readonly algorithm = 'aes-256-cbc';

  constructor(private prisma: PrismaService) {}

  private encrypt(data: string): string {
    const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '0'.repeat(64), 'hex');
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, key, iv);
    return iv.toString('hex') + ':' + cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
  }

  private decrypt(encrypted: string): string {
    const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '0'.repeat(64), 'hex');
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts.shift()!, 'hex');
    const decipher = createDecipheriv(this.algorithm, key, iv);
    return decipher.update(parts.join(':'), 'hex', 'utf8') + decipher.final('utf8');
  }

  // ── QuickBooks Online ─────────────────────────────────────────────────────

  /** Step 1: Generate the QuickBooks OAuth2 authorization URL */
  getQuickBooksAuthUrl(businessId: string): string {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID ?? '';
    const redirectUri = `${process.env.API_URL ?? 'http://localhost:3010/api/v1'}/integrations/quickbooks/callback`;
    const state = Buffer.from(JSON.stringify({ businessId })).toString('base64');
    const scope = 'com.intuit.quickbooks.accounting';

    return `https://appcenter.intuit.com/connect/oauth2?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`;
  }

  /** Step 2: Exchange authorization code for tokens */
  async handleQuickBooksCallback(code: string, realmId: string, state: string): Promise<string> {
    const { businessId } = JSON.parse(Buffer.from(state, 'base64').toString());
    const clientId = process.env.QUICKBOOKS_CLIENT_ID ?? '';
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET ?? '';
    const redirectUri = `${process.env.API_URL ?? 'http://localhost:3010/api/v1'}/integrations/quickbooks/callback`;

    const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });

    const tokens = await res.json() as { access_token: string; refresh_token: string; expires_in: number };

    const config = { realmId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };

    await this.upsertIntegration(businessId, 'QUICKBOOKS', 'QuickBooks Online', config);
    this.logger.log(`QuickBooks connected for business ${businessId}`);

    return businessId;
  }

  /** Export a date range of sales as QuickBooks journal entries */
  async exportToQuickBooks(businessId: string, startDate: Date, endDate: Date) {
    const integration = await this.getIntegration(businessId, 'QUICKBOOKS');
    const config = JSON.parse(this.decrypt(integration.config));

    const sales = await this.prisma.sale.findMany({
      where: { businessId, status: 'PAID', createdAt: { gte: startDate, lte: endDate } },
      include: { items: true, payments: true },
    });

    const accessToken = await this.refreshQBTokenIfNeeded(integration.id, config);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${config.realmId}`;

    const results = [];
    for (const sale of sales) {
      const entry = this.buildQBJournalEntry(sale);
      const res = await fetch(`${baseUrl}/journalentry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(entry),
      });

      if (!res.ok) {
        this.logger.warn(`QB export failed for sale ${sale.id}: ${res.status}`);
        results.push({ saleId: sale.id, success: false });
      } else {
        results.push({ saleId: sale.id, success: true });
      }
    }

    await this.prisma.integration.update({ where: { id: integration.id }, data: { lastSyncAt: new Date() } });
    return { exported: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results };
  }

  private buildQBJournalEntry(sale: any) {
    const totalKES = sale.totalCents / 100;
    const vatKES = sale.vatCents / 100;
    const revenueKES = totalKES - vatKES;

    return {
      DocNumber: sale.receiptNumber ?? sale.id.slice(0, 8),
      TxnDate: sale.createdAt.toISOString().split('T')[0],
      PrivateNote: `Faida POS Sale ${sale.receiptNumber ?? sale.id}`,
      Line: [
        {
          Description: 'Sales Revenue',
          Amount: revenueKES,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { name: 'Sales of Product Income' } },
        },
        {
          Description: 'VAT Payable',
          Amount: vatKES,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { name: 'Sales Tax Payable' } },
        },
        {
          Description: 'Cash / Bank',
          Amount: totalKES,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { name: 'Undeposited Funds' } },
        },
      ],
    };
  }

  private async refreshQBTokenIfNeeded(integrationId: string, config: any): Promise<string> {
    // Simple passthrough — in production you'd check expiry and refresh
    return config.accessToken;
  }

  // ── Sage ─────────────────────────────────────────────────────────────────

  /** Configure Sage credentials (username + password or API key) */
  async configureSage(businessId: string, apiKey: string, companyId: string) {
    await this.upsertIntegration(businessId, 'SAGE', 'Sage Accounting', { apiKey, companyId });
    return { connected: true };
  }

  /** Export sales as Sage sales invoices */
  async exportToSage(businessId: string, startDate: Date, endDate: Date) {
    const integration = await this.getIntegration(businessId, 'SAGE');
    const config = JSON.parse(this.decrypt(integration.config));

    const sales = await this.prisma.sale.findMany({
      where: { businessId, status: 'PAID', createdAt: { gte: startDate, lte: endDate } },
      include: { items: true },
    });

    const results = [];
    for (const sale of sales) {
      const invoice = this.buildSageInvoice(sale);
      try {
        const res = await fetch(
          `https://api.accounting.sage.com/v3.1/sales_invoices?company_id=${config.companyId}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(invoice),
          },
        );
        results.push({ saleId: sale.id, success: res.ok });
        if (!res.ok) this.logger.warn(`Sage export failed for sale ${sale.id}: ${res.status}`);
      } catch (err: any) {
        results.push({ saleId: sale.id, success: false });
        this.logger.error(`Sage export error for sale ${sale.id}: ${err.message}`);
      }
    }

    await this.prisma.integration.update({ where: { id: integration.id }, data: { lastSyncAt: new Date() } });
    return { exported: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length };
  }

  private buildSageInvoice(sale: any) {
    return {
      contact_id: null,
      date: sale.createdAt.toISOString().split('T')[0],
      invoice_number: sale.receiptNumber ?? `POS-${sale.id.slice(0, 8)}`,
      line_items: sale.items.map((item: any) => ({
        description: item.name,
        quantity: item.quantity,
        unit_price: item.unitPriceCents / 100,
        tax_rate_id: null,
      })),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getIntegration(businessId: string, type: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { businessId, type, isActive: true },
    });
    if (!integration) throw new BadRequestException(`${type} integration not configured`);
    return integration;
  }

  private async upsertIntegration(businessId: string, type: string, name: string, config: Record<string, unknown>) {
    const existing = await this.prisma.integration.findFirst({ where: { businessId, type } });
    const encConfig = this.encrypt(JSON.stringify(config));

    if (existing) {
      return this.prisma.integration.update({ where: { id: existing.id }, data: { config: encConfig, isActive: true, lastSyncAt: null } });
    }
    return this.prisma.integration.create({ data: { businessId, type, name, config: encConfig } });
  }

  async getAccountingStatus(businessId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { businessId, type: { in: ['QUICKBOOKS', 'SAGE', 'XERO'] } },
      select: { type: true, name: true, isActive: true, lastSyncAt: true, createdAt: true },
    });
    return integrations;
  }
}
