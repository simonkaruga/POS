import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { createHmac, randomBytes } from 'node:crypto';
import { normalizeTier, planDisplayName } from '@pos/shared';
import { frontendUrl } from '../common/app-urls';

// Labels come from @pos/shared so the API, the web app and the admin console all
// spell a tier the same way. Only price and the Paystack plan code live here.
export const PLANS = {
  FREE:       { name: planDisplayName('FREE'),       amountKES: 0,     paystackPlanCode: '' },
  STARTER:    { name: planDisplayName('STARTER'),    amountKES: 999,   paystackPlanCode: process.env.PAYSTACK_STARTER_PLAN    ?? '' },
  GROWTH:     { name: planDisplayName('GROWTH'),     amountKES: 2499,  paystackPlanCode: process.env.PAYSTACK_GROWTH_PLAN     ?? '' },
  PRO:        { name: planDisplayName('PRO'),        amountKES: 4999,  paystackPlanCode: process.env.PAYSTACK_PRO_PLAN        ?? '' },
  ENTERPRISE: { name: planDisplayName('ENTERPRISE'), amountKES: 14999, paystackPlanCode: process.env.PAYSTACK_ENTERPRISE_PLAN ?? '' },
};

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly secretKey = process.env.PAYSTACK_SECRET_KEY ?? '';
  private readonly webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET ?? '';

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private affiliate: AffiliateService,
  ) {}

  getPlans() {
    return Object.entries(PLANS).map(([tier, plan]) => ({
      tier,
      name: plan.name,
      amountKES: plan.amountKES,
      features: this.getPlanFeatures(tier),
    }));
  }

  private getPlanFeatures(tier: string): string[] {
    const free     = ['Basic POS (cash)', 'Inventory', 'Customers', 'Sales history', 'Cash drawer'];
    const starter  = [...free,    'Full POS + M-Pesa', 'KRA eTIMS', 'Batch & expiry tracking', 'Full reports suite', 'Offline + PWA'];
    const growth   = [...starter, 'Hospitality (tables/KOT/bar)', 'Suppliers & POs', 'Promotions & gift cards', 'Serials, recipes & bundles', 'Stocktake & damaged goods', 'Delivery management', 'WhatsApp & SMS receipts'];
    const pro      = [...growth,  'HR shifts & leave', 'Kenya payroll (PAYE/SHIF/NSSF)', 'Bank reconciliation', 'Multi-store (5) + transfers', 'Budget & expense approvals', 'Webhooks & API keys', 'Owner dashboard'];
    const ent      = [...pro,     'Field sales & agent dashboard', 'Hotel room management', 'Franchise network', 'AI demand forecasting', 'QuickBooks/Xero/Shopify sync', 'KDPA compliance', 'Multi-currency', 'On-premise desktop', 'Dedicated account manager'];
    if (tier === 'FREE')       return free;
    if (tier === 'STARTER')    return starter;
    if (tier === 'GROWTH')     return growth;
    if (tier === 'PRO')        return pro;
    return ent;
  }

  async initializeCheckout(businessId: string, tier: keyof typeof PLANS, email: string) {
    const plan = PLANS[tier];
    if (!plan) throw new BadRequestException(`Invalid plan tier: ${tier}`);

    // FREE plan needs no payment — activate immediately
    if (tier === 'FREE') {
      await this.activateSubscription(businessId, 'FREE');
      return { authorizationUrl: null, reference: null };
    }

    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new BadRequestException('Business not found');

    const reference = `faida_${businessId}_${tier}_${Date.now()}`;

    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: plan.amountKES * 100, // Paystack uses kobo (NGN) or lowest denomination
        currency: 'KES',
        reference,
        plan: plan.paystackPlanCode || undefined,
        metadata: { businessId, tier, plan: plan.name },
        callback_url: `${frontendUrl()}/settings?tab=subscription&ref=${reference}`,
      }),
    });

    const data = await res.json() as any;
    if (!data.status) throw new BadRequestException(data.message ?? 'Paystack error');

    // Store the customer email if we have a Paystack customer ID
    if (data.data?.customer?.customer_code) {
      await this.prisma.business.update({
        where: { id: businessId },
        data: { paystackCustomerId: data.data.customer.customer_code },
      });
    }

    return { authorizationUrl: data.data.authorization_url, reference };
  }

  async verifyPayment(reference: string): Promise<{ success: boolean; businessId?: string; tier?: string }> {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    const data = await res.json() as any;

    if (!data.status || data.data?.status !== 'success') {
      return { success: false };
    }

    const meta = data.data.metadata as { businessId: string; tier: string; plan: string };
    if (!meta?.businessId) return { success: false };

    await this.activateSubscription(meta.businessId, meta.tier as keyof typeof PLANS, data.data?.subscription?.subscription_code);

    const business = await this.prisma.business.findUnique({ where: { id: meta.businessId }, include: { users: { where: { role: 'OWNER' }, take: 1 } } });
    const ownerEmail = business?.users[0]?.email;
    if (ownerEmail) {
      await this.email.sendSubscriptionConfirmation({
        to: ownerEmail,
        businessName: business.name,
        plan: PLANS[meta.tier]?.name ?? meta.tier,
        amount: `KES ${PLANS[meta.tier]?.amountKES?.toLocaleString() ?? '?'}`,
      });
    }

    return { success: true, businessId: meta.businessId, tier: meta.tier };
  }

  private async activateSubscription(businessId: string, tier: keyof typeof PLANS, subscriptionCode?: string) {
    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        subscriptionStatus: 'ACTIVE',
        subscriptionTier: normalizeTier(tier),
        planName: planDisplayName(tier),
        trialEndsAt: null,
        ...(subscriptionCode ? { paystackSubscriptionId: subscriptionCode } : {}),
      },
    });
    this.logger.log(`Business ${businessId} activated on ${tier} plan`);

    // Recurring affiliate commission — credit the partner (if any) who referred
    // this business, based on the plan price they just paid.
    const amountCents = (PLANS[tier]?.amountKES ?? 0) * 100;
    if (amountCents > 0) {
      await this.affiliate.recordSubscriptionCommission(businessId, amountCents).catch(() => {});
    }

    // Auto-generate a license key for the paying customer
    try {
      await this.generateAndSendLicenseKey(businessId, tier);
    } catch (err: any) {
      this.logger.error(`Failed to generate license key for ${businessId}: ${err.message}`);
    }
  }

  private async generateAndSendLicenseKey(businessId: string, tier: keyof typeof PLANS) {
    // Generate a KPS-XXXX-XXXX-XXXX format key
    const segments = Array.from({ length: 3 }, () => randomBytes(2).toString('hex').toUpperCase());
    const key = `KPS-${segments[0]}-${segments[1]}-${segments[2]}`;

    // 1 year expiry for paid plans
    const expiresAt = new Date(Date.now() + 365 * 86400000);

    await this.prisma.licenseKey.create({
      data: { key, tier, businessId, isActive: true, expiresAt },
    });

    // Send the key via email
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: { users: { where: { role: 'OWNER' }, take: 1 } },
    });
    const ownerEmail = business?.users[0]?.email;
    if (ownerEmail) {
      await this.email.sendLicenseKey({
        to: ownerEmail,
        businessName: business!.name,
        plan: PLANS[tier]?.name ?? tier,
        licenseKey: key,
        expiresAt: expiresAt.toISOString(),
      });
    }

    this.logger.log(`License key ${key} generated and emailed to ${ownerEmail ?? 'unknown'} for business ${businessId}`);
  }

  /** Handle Paystack webhook events */
  async handleWebhook(rawBody: string, signature: string): Promise<void> {
    // Verify signature
    const expected = createHmac('sha512', this.webhookSecret).update(rawBody).digest('hex');
    if (signature !== expected) {
      this.logger.warn('Invalid Paystack webhook signature');
      return;
    }

    const event = JSON.parse(rawBody) as { event: string; data: any };
    this.logger.log(`Paystack event: ${event.event}`);

    switch (event.event) {
      case 'charge.success': {
        const meta = event.data.metadata as { businessId?: string; tier?: string };
        if (meta?.businessId && meta?.tier) {
          await this.activateSubscription(meta.businessId, meta.tier as keyof typeof PLANS, event.data.subscription?.subscription_code);
        }
        break;
      }
      case 'subscription.disable':
      case 'subscription.expiring_cards': {
        const customerId = event.data.customer?.customer_code;
        if (customerId) {
          const business = await this.prisma.business.findFirst({ where: { paystackCustomerId: customerId } });
          if (business) {
            await this.prisma.business.update({
              where: { id: business.id },
              data: { subscriptionStatus: 'EXPIRED' },
            });
            this.logger.log(`Business ${business.id} subscription expired/disabled`);
          }
        }
        break;
      }
    }
  }

  async getStatus(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { subscriptionStatus: true, subscriptionTier: true, planName: true, trialEndsAt: true, paystackCustomerId: true, paystackSubscriptionId: true },
    });
    return business;
  }
}
