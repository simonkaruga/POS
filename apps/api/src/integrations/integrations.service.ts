import { Injectable, NotFoundException, Logger, BadGatewayException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createCipheriv, createDecipheriv } from 'crypto';

import { requireString } from '../common/validate';

import { roundQty } from '../common/quantity';
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(private prisma: PrismaService) {}

  private encrypt(data: string): string {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '0'.repeat(64), 'hex');
    const iv = Buffer.alloc(16, 0);
    const cipher = createCipheriv(algorithm, key, iv);
    return cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
  }

  private decrypt(encrypted: string): string {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '0'.repeat(64), 'hex');
    const iv = Buffer.alloc(16, 0);
    const decipher = createDecipheriv(algorithm, key, iv);
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
  }

  async createIntegration(data: {
    businessId: string;
    type: string;
    name: string;
    config: Record<string, unknown>;
  }) {
    requireString(data.type, 'type');
    if (!data.config || typeof data.config !== 'object') {
      throw new BadRequestException('config is required');
    }
    return this.prisma.integration.create({
      data: {
        businessId: data.businessId,
        type: data.type,
        name: data.name,
        config: this.encrypt(JSON.stringify(data.config)),
        isActive: true,
      },
    });
  }

  async updateIntegration(id: string, data: {
    name?: string;
    config?: Record<string, unknown>;
    isActive?: boolean;
  }) {
    return this.prisma.integration.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.config && { config: this.encrypt(JSON.stringify(data.config)) }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async getIntegrations(businessId: string, type?: string) {
    const integrations = await this.prisma.integration.findMany({
      where: {
        businessId,
        ...(type && { type }),
      },
    });

    // One row that will not decrypt (e.g. written under a previous ENCRYPTION_KEY)
    // must not take the whole list down; surface it so the owner can reconnect.
    return integrations.map(i => {
      try {
        return { ...i, config: JSON.parse(this.decrypt(i.config)) };
      } catch {
        this.logger.warn(`Integration ${i.id} config could not be decrypted`);
        return { ...i, config: null, configError: 'Stored credentials could not be read. Reconnect this integration.' };
      }
    });
  }

  /** Look up the active integration record for a given businessId + type, decrypt config */
  private async resolveConfig(businessId: string, type: string): Promise<{ integrationId: string; config: Record<string, any> }> {
    const integration = await this.prisma.integration.findFirst({
      where: { businessId, type, isActive: true },
    });
    if (!integration) throw new NotFoundException(`No active ${type} integration found for this business`);
    const config = JSON.parse(this.decrypt(integration.config));
    return { integrationId: integration.id, config };
  }

  async syncSale(integrationId: string, saleId: string) {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
    });

    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true, payments: true },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    if (!sale) throw new NotFoundException('Sale not found');

    const config = JSON.parse(this.decrypt(integration.config));

    switch (integration.type) {
      case 'QUICKBOOKS':
        return this.syncToQuickBooks(config, sale);
      case 'XERO':
        return this.syncToXero(config, sale);
      case 'WOOCOMMERCE':
        return this.syncToWooCommerce(config, sale);
      case 'SHOPIFY':
        return this.syncToShopify(config, sale);
      default:
        throw new BadRequestException(`Unsupported integration type: ${integration.type}`);
    }
  }

  // ── QuickBooks Online ───────────────────────────────────────────────────────

  /**
   * Sync a single sale to QuickBooks Online as an Invoice.
   * Config fields: clientId, clientSecret, refreshToken, realmId
   */
  async syncToQuickbooksBySaleId(businessId: string, saleId: string) {
    const { integrationId, config } = await this.resolveConfig(businessId, 'QUICKBOOKS');

    // Step 1: Refresh access token
    const tokenResp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken }),
    });
    const tokens = await tokenResp.json() as { access_token?: string; refresh_token?: string; error?: string };
    if (!tokenResp.ok) throw new BadGatewayException(`QB token refresh error: ${tokens.error}`);

    // Persist updated refresh token so it doesn't expire
    if (tokens.refresh_token) {
      const updatedConfig = { ...config, refreshToken: tokens.refresh_token, accessToken: tokens.access_token };
      await this.prisma.integration.update({
        where: { id: integrationId },
        data: { config: this.encrypt(JSON.stringify(updatedConfig)) },
      });
    }

    // Step 2: Fetch sale with line items
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    // Step 3: Build QuickBooks Invoice object
    const qbInvoice = {
      Line: sale.items.map((item, i) => ({
        Id: String(i + 1),
        LineNum: i + 1,
        Amount: item.totalCents / 100,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: '1', name: 'Services' },
          Qty: item.quantity,
          UnitPrice: item.unitPriceCents / 100,
        },
      })),
      CustomerRef: { value: '1' }, // Walk-in / generic customer
      TotalAmt: sale.totalCents / 100,
      DocNumber: sale.receiptNumber ?? sale.id.slice(0, 8),
      TxnDate: sale.createdAt.toISOString().split('T')[0],
    };

    // Use sandbox URL for now; production would be quickbooks.api.intuit.com
    const baseUrl = config.sandbox === false
      ? `https://quickbooks.api.intuit.com/v3/company/${config.realmId}`
      : `https://sandbox-quickbooks.api.intuit.com/v3/company/${config.realmId}`;

    const resp = await fetch(`${baseUrl}/invoice`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ Invoice: qbInvoice }),
    });

    const result = await resp.json() as { Invoice?: { Id: string }; Fault?: unknown };
    if (!resp.ok) {
      this.logger.error(`QB Invoice creation failed for sale ${saleId}: ${JSON.stringify(result.Fault)}`);
      throw new BadGatewayException(`QB API error: ${JSON.stringify(result.Fault)}`);
    }

    await this.prisma.integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date() } });

    return { success: true, externalId: result.Invoice?.Id, provider: 'quickbooks' };
  }

  /** Internal method used by syncSale() (integration-id based dispatch) */
  private async syncToQuickBooks(config: Record<string, any>, sale: any) {
    // Get access token via refresh_token grant
    const tokenResp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken }),
    });
    const tokens = await tokenResp.json() as { access_token?: string; error?: string };
    if (!tokenResp.ok) throw new BadGatewayException(`QB token error: ${tokens.error}`);

    if (!sale) throw new NotFoundException('Sale not found');

    const qbInvoice = {
      Line: (sale.items ?? []).map((item: any, i: number) => ({
        Id: String(i + 1),
        LineNum: i + 1,
        Amount: item.totalCents / 100,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: '1', name: 'Services' },
          Qty: item.quantity,
          UnitPrice: item.unitPriceCents / 100,
        },
      })),
      CustomerRef: { value: '1' },
      TotalAmt: sale.totalCents / 100,
      DocNumber: sale.receiptNumber ?? sale.id.slice(0, 8),
      TxnDate: sale.createdAt.toISOString().split('T')[0],
    };

    const baseUrl = config.sandbox === false
      ? `https://quickbooks.api.intuit.com/v3/company/${config.realmId}`
      : `https://sandbox-quickbooks.api.intuit.com/v3/company/${config.realmId}`;

    const resp = await fetch(`${baseUrl}/invoice`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ Invoice: qbInvoice }),
    });

    const result = await resp.json() as { Invoice?: { Id: string }; Fault?: unknown };
    if (!resp.ok) throw new BadGatewayException(`QB API error: ${JSON.stringify(result.Fault)}`);
    return { success: true, externalId: result.Invoice?.Id, provider: 'quickbooks' };
  }

  // ── Xero ───────────────────────────────────────────────────────────────────

  /**
   * Sync a single sale to Xero as an Authorised Invoice.
   * Config fields: clientId, clientSecret, refreshToken, tenantId
   */
  async syncToXeroBySaleId(businessId: string, saleId: string) {
    const { integrationId, config } = await this.resolveConfig(businessId, 'XERO');

    // Refresh access token
    const tokenResp = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken }),
    });
    const tokens = await tokenResp.json() as { access_token?: string; refresh_token?: string; error?: string };
    if (!tokenResp.ok) throw new BadGatewayException(`Xero token refresh error: ${tokens.error}`);

    // Persist updated tokens
    if (tokens.refresh_token) {
      const updatedConfig = { ...config, refreshToken: tokens.refresh_token };
      await this.prisma.integration.update({
        where: { id: integrationId },
        data: { config: this.encrypt(JSON.stringify(updatedConfig)) },
      });
    }

    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const xeroInvoice = {
      Type: 'ACCREC',
      InvoiceNumber: sale.receiptNumber ?? `FAIDA-${sale.id.slice(0, 8)}`,
      Status: 'AUTHORISED',
      Date: sale.createdAt.toISOString().split('T')[0],
      DueDate: sale.createdAt.toISOString().split('T')[0],
      LineItems: sale.items.map(item => ({
        Description: item.name ?? `Item ${item.itemId}`,
        Quantity: item.quantity,
        UnitAmount: item.unitPriceCents / 100,
        LineAmount: item.totalCents / 100,
        AccountCode: '200', // Revenue account (standard Xero chart of accounts)
        TaxType: 'OUTPUT',
      })),
      SubTotal: (sale.subtotalCents ?? sale.totalCents) / 100,
      TotalTax: sale.vatCents / 100,
      Total: sale.totalCents / 100,
    };

    const resp = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'xero-tenant-id': config.tenantId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ Invoices: [xeroInvoice] }),
    });

    const result = await resp.json() as { Invoices?: Array<{ InvoiceID: string; Status: string }> };
    if (!resp.ok) {
      this.logger.error(`Xero invoice creation failed for sale ${saleId}: ${resp.status}`);
      throw new BadGatewayException(`Xero API error: ${resp.status}`);
    }

    await this.prisma.integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date() } });

    return {
      success: true,
      externalId: result.Invoices?.[0]?.InvoiceID,
      status: result.Invoices?.[0]?.Status,
      provider: 'xero',
    };
  }

  /** Internal method used by syncSale() */
  private async syncToXero(config: Record<string, any>, sale: any) {
    const tokenResp = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken }),
    });
    const tokens = await tokenResp.json() as { access_token?: string; error?: string };
    if (!tokenResp.ok) throw new BadGatewayException(`Xero token error: ${tokens.error}`);

    if (!sale) throw new NotFoundException('Sale not found');

    const xeroInvoice = {
      Type: 'ACCREC',
      InvoiceNumber: sale.receiptNumber ?? `FAIDA-${sale.id.slice(0, 8)}`,
      Status: 'AUTHORISED',
      Date: sale.createdAt.toISOString().split('T')[0],
      DueDate: sale.createdAt.toISOString().split('T')[0],
      LineItems: (sale.items ?? []).map((item: any) => ({
        Description: item.name ?? `Item ${item.itemId}`,
        Quantity: item.quantity,
        UnitAmount: item.unitPriceCents / 100,
        LineAmount: item.totalCents / 100,
        AccountCode: '200',
        TaxType: 'OUTPUT',
      })),
      SubTotal: (sale.subtotalCents ?? sale.totalCents) / 100,
      TotalTax: sale.vatCents / 100,
      Total: sale.totalCents / 100,
    };

    const resp = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'xero-tenant-id': config.tenantId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ Invoices: [xeroInvoice] }),
    });

    const result = await resp.json() as { Invoices?: Array<{ InvoiceID: string }> };
    if (!resp.ok) throw new BadGatewayException(`Xero API error: ${resp.status}`);
    return { success: true, externalId: result.Invoices?.[0]?.InvoiceID, provider: 'xero' };
  }

  // ── Shopify ─────────────────────────────────────────────────────────────────

  /**
   * Sync POS inventory levels to Shopify by matching SKU/barcode.
   * Config fields: shopDomain, accessToken, locationId
   */
  async syncInventoryToShopify(businessId: string) {
    const { integrationId, config } = await this.resolveConfig(businessId, 'SHOPIFY');

    const items = await this.prisma.item.findMany({
      where: { businessId },
      select: { id: true, name: true, barcode: true },
    });

    const baseUrl = `https://${config.shopDomain}/admin/api/2024-01`;
    const headers: Record<string, string> = {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
    };

    // Fetch Shopify products (up to 250 — page through in production)
    const shopifyResp = await fetch(`${baseUrl}/products.json?limit=250`, { headers });
    if (!shopifyResp.ok) {
      const errText = await shopifyResp.text();
      throw new BadGatewayException(`Shopify products fetch failed: ${shopifyResp.status} ${errText}`);
    }
    const { products } = await shopifyResp.json() as {
      products: Array<{
        variants: Array<{ id: number; sku: string; barcode: string; inventory_item_id: number }>;
      }>;
    };

    const results: Array<{ itemId: string; shopifyVariantId: number; qty: number }> = [];

    for (const item of items.slice(0, 50)) {
      // Match by barcode
      const shopifyProduct = products.find(p =>
        p.variants.some(v => item.barcode && v.barcode === item.barcode),
      );

      if (!shopifyProduct) continue;

      const variant = shopifyProduct.variants.find(v => item.barcode && v.barcode === item.barcode);
      if (!variant) continue;

      // Calculate current stock from movements
      const stock = await this.prisma.inventoryMovement.aggregate({
        where: { itemId: item.id, businessId },
        _sum: { quantity: true },
      });
      const qty = roundQty(stock._sum.quantity ?? 0);

      // Update inventory level in Shopify
      const setResp = await fetch(`${baseUrl}/inventory_levels/set.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          location_id: config.locationId,
          inventory_item_id: variant.inventory_item_id,
          available: qty,
        }),
      });

      if (!setResp.ok) {
        this.logger.warn(`Shopify inventory set failed for item ${item.id}: ${setResp.status}`);
        continue;
      }

      results.push({ itemId: item.id, shopifyVariantId: variant.id, qty });
    }

    await this.prisma.integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date() } });

    return { success: true, synced: results.length, results, provider: 'shopify' };
  }

  /**
   * Push a completed POS sale as an order to Shopify.
   * Config fields: shopDomain, accessToken
   */
  async pushOrderToShopify(businessId: string, saleId: string) {
    const { integrationId, config } = await this.resolveConfig(businessId, 'SHOPIFY');

    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const baseUrl = `https://${config.shopDomain}/admin/api/2024-01`;
    const headers: Record<string, string> = {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
    };

    const order = {
      line_items: sale.items.map(item => ({
        title: item.name ?? `Item ${item.itemId}`,
        quantity: item.quantity,
        price: (item.unitPriceCents / 100).toFixed(2),
      })),
      financial_status: 'paid',
      note: `Faida Receipt: ${sale.receiptNumber ?? sale.id}`,
      tags: 'faida-pos',
    };

    const resp = await fetch(`${baseUrl}/orders.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ order }),
    });

    const result = await resp.json() as { order?: { id: number; order_number: number }; errors?: unknown };
    if (!resp.ok) {
      this.logger.error(`Shopify order push failed for sale ${saleId}: ${JSON.stringify(result.errors)}`);
      throw new BadGatewayException(`Shopify order error: ${JSON.stringify(result.errors)}`);
    }

    await this.prisma.integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date() } });

    return {
      success: true,
      externalId: String(result.order?.id),
      orderNumber: result.order?.order_number,
      provider: 'shopify',
    };
  }

  /** Internal method used by syncSale() */
  private async syncToShopify(config: Record<string, any>, sale: any) {
    if (!sale) throw new NotFoundException('Sale not found');

    const baseUrl = `https://${config.shopDomain}/admin/api/2024-01`;
    const headers: Record<string, string> = {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
    };

    const order = {
      line_items: (sale.items ?? []).map((item: any) => ({
        title: item.name ?? `Item ${item.itemId}`,
        quantity: item.quantity,
        price: (item.unitPriceCents / 100).toFixed(2),
      })),
      financial_status: 'paid',
      note: `Faida Receipt: ${sale.receiptNumber ?? sale.id}`,
      tags: 'faida-pos',
    };

    const resp = await fetch(`${baseUrl}/orders.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ order }),
    });

    const result = await resp.json() as { order?: { id: number }; errors?: unknown };
    if (!resp.ok) throw new BadGatewayException(`Shopify order error: ${JSON.stringify(result.errors)}`);
    return { success: true, externalId: String(result.order?.id), provider: 'shopify' };
  }

  // ── WooCommerce ─────────────────────────────────────────────────────────────

  /**
   * Push a completed POS sale as an order to WooCommerce REST API.
   * Config fields: siteUrl, consumerKey, consumerSecret
   */
  async syncToWooCommerceBySaleId(businessId: string, saleId: string) {
    const { integrationId, config } = await this.resolveConfig(businessId, 'WOOCOMMERCE');

    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const baseUrl = `${config.siteUrl}/wp-json/wc/v3`;
    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    };

    const wcOrder = {
      status: 'completed',
      set_paid: true,
      meta_data: [{ key: '_faida_receipt', value: sale.receiptNumber ?? sale.id }],
      line_items: sale.items.map(item => ({
        product_id: 0, // A product mapping table would be required for full automation
        name: item.name ?? `Item ${item.itemId}`,
        quantity: item.quantity,
        subtotal: (item.totalCents / 100).toFixed(2),
        total: (item.totalCents / 100).toFixed(2),
      })),
      payment_method: 'faida_pos',
      payment_method_title: 'Faida POS',
      total: (sale.totalCents / 100).toFixed(2),
      customer_note: `Faida Receipt: ${sale.receiptNumber ?? sale.id}`,
    };

    const resp = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify(wcOrder),
    });

    const result = await resp.json() as { id?: number; number?: string; message?: string; code?: string };
    if (!resp.ok) {
      this.logger.error(`WooCommerce order creation failed for sale ${saleId}: ${result.message}`);
      throw new BadGatewayException(`WooCommerce API error: ${result.message ?? resp.status}`);
    }

    await this.prisma.integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date() } });

    return {
      success: true,
      externalId: String(result.id),
      orderNumber: result.number,
      provider: 'woocommerce',
    };
  }

  /** Internal method used by syncSale() */
  private async syncToWooCommerce(config: Record<string, any>, sale: any) {
    if (!sale) throw new NotFoundException('Sale not found');

    const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const baseUrl = `${config.siteUrl}/wp-json/wc/v3`;
    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    };

    const wcOrder = {
      status: 'completed',
      set_paid: true,
      meta_data: [{ key: '_faida_receipt', value: sale.receiptNumber ?? sale.id }],
      line_items: (sale.items ?? []).map((item: any) => ({
        product_id: 0,
        name: item.name ?? `Item ${item.itemId}`,
        quantity: item.quantity,
        subtotal: (item.totalCents / 100).toFixed(2),
        total: (item.totalCents / 100).toFixed(2),
      })),
      payment_method: 'faida_pos',
      payment_method_title: 'Faida POS',
      total: (sale.totalCents / 100).toFixed(2),
      customer_note: `Faida Receipt: ${sale.receiptNumber ?? sale.id}`,
    };

    const resp = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify(wcOrder),
    });

    const result = await resp.json() as { id?: number; message?: string };
    if (!resp.ok) throw new BadGatewayException(`WooCommerce API error: ${result.message ?? resp.status}`);
    return { success: true, externalId: String(result.id), provider: 'woocommerce' };
  }

  // ── Inventory sync (generic) ────────────────────────────────────────────────

  async syncInventory(integrationId: string, itemId: string) {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
    });

    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
    });

    const stock = await this.prisma.inventoryMovement.aggregate({
      where: { itemId },
      _sum: { quantity: true },
    });

    await this.prisma.integration.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date() },
    });

    return {
      success: true,
      item: item?.name,
      stock: roundQty(stock._sum.quantity ?? 0),
      syncedAt: new Date(),
    };
  }

  // ── Webhook handlers ────────────────────────────────────────────────────────

  async webhookHandler(type: string, payload: Record<string, unknown>) {
    switch (type) {
      case 'WOOCOMMERCE_ORDER':
        return this.handleWooCommerceOrder(payload);
      case 'SHOPIFY_ORDER':
        return this.handleShopifyOrder(payload);
      default:
        throw new BadRequestException(`Unsupported webhook type: ${type}`);
    }
  }

  private async handleWooCommerceOrder(payload: Record<string, unknown>) {
    // Future: map WooCommerce order fields to a Faida Sale record
    this.logger.log(`Received WooCommerce order webhook: order_id=${payload['id']}`);
    return { success: true, saleId: null, message: 'WooCommerce order received (mapping pending)' };
  }

  private async handleShopifyOrder(payload: Record<string, unknown>) {
    // Future: map Shopify order fields to a Faida Sale record
    this.logger.log(`Received Shopify order webhook: order_id=${payload['id']}`);
    return { success: true, saleId: null, message: 'Shopify order received (mapping pending)' };
  }
}
