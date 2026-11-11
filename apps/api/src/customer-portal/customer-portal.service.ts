import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizeKePhone, kePhoneVariants } from '../common/phone';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/** Wrong codes allowed against a single OTP before it is burned. */
const OTP_MAX_ATTEMPTS = 5;
/** Minimum gap between two codes to the same phone — one SMS credit each. */
const OTP_RESEND_COOLDOWN_MS = 60_000;
/** How long a code stays good for. Published to clients so their countdown
 *  cannot drift away from what the server actually enforces. */
const OTP_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class CustomerPortalService {
  private readonly logger = new Logger(CustomerPortalService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async requestOtp(phone: string, businessId: string, name?: string) {
    if (!businessId) throw new BadRequestException('Business is required');
    const canonical = normalizeKePhone(phone);
    if (!canonical) {
      throw new BadRequestException(
        'Enter a valid Kenyan mobile number, e.g. 0712345678.',
      );
    }

    // Self-service registration: find the customer or create one on first contact.
    // A bare phone-only Customer is harmless; phoneVerifiedAt gates "real" identity.
    // Rows written before normalization existed hold whatever the cashier or the
    // CSV typed, so match every shape and rewrite the row once — each row heals
    // the first time its owner logs in, and duplicates stop being created.
    let customer = await this.prisma.customer.findFirst({
      where: { businessId, phone: { in: kePhoneVariants(canonical) } },
      select: { id: true, name: true, phone: true, phoneVerifiedAt: true },
    });
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: { businessId, phone: canonical, name: name?.trim() || 'Customer' },
        select: { id: true, name: true, phone: true, phoneVerifiedAt: true },
      });
    } else if (customer.phone !== canonical) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { phone: canonical },
      });
    }

    // A resend costs an SMS credit and resets the guess counter, so it must not be
    // free to spam. Anyone hammering this is either a bot or a customer tapping twice.
    const pending = await this.prisma.customerPortalSession.findUnique({
      where: { sessionToken: `otp-placeholder-${customer.id}` },
      select: { otpSentAt: true },
    });
    if (pending?.otpSentAt) {
      const waited = Date.now() - pending.otpSentAt.getTime();
      if (waited < OTP_RESEND_COOLDOWN_MS) {
        const seconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - waited) / 1000);
        throw new BadRequestException(
          `A code was just sent. Please wait ${seconds}s before asking for another.`,
        );
      }
    }

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = createHash('sha256').update(otp).digest('hex');
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Upsert the OTP-placeholder session for this customer. A fresh code resets the
    // attempt counter — the limit is per code, not a permanent lockout of the phone.
    await this.prisma.customerPortalSession.upsert({
      where: { sessionToken: `otp-placeholder-${customer.id}` },
      update: {
        phone: canonical,
        otpHash, otpExpiresAt, expiresAt: otpExpiresAt,
        otpAttempts: 0, otpSentAt: new Date(),
      },
      create: {
        customerId: customer.id,
        phone: canonical,
        sessionToken: `otp-placeholder-${customer.id}`,
        otpHash,
        otpExpiresAt,
        expiresAt: otpExpiresAt,
        otpAttempts: 0,
        otpSentAt: new Date(),
      },
    });

    // The SMS *is* the login — a send that fails is a failed request, not a
    // background detail. Fire-and-forget left the customer watching a code screen
    // for a code nobody sent, with nothing on either side saying so.
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    const brand = business?.name ?? 'Faida';
    const isDev = process.env.NODE_ENV !== 'production';
    const sms = await this.notifications.sendSMS(
      businessId,
      canonical,
      `${otp} is your ${brand} verification code. It expires in 10 minutes.`,
      { purpose: 'OTP' },
    );

    if (!sms.success) {
      this.logger.error(
        `Portal OTP SMS failed for business ${businessId}: ${sms.error ?? 'unknown error'}`,
      );
      // Dev has no Africa's Talking credentials and reads the echoed code instead,
      // so keep that code alive. In production there is no code to fall back on.
      if (!isDev) {
        // Burn the code and clear the cooldown — making the customer wait 60s to
        // retry a code we never sent punishes them for our outage.
        await this.prisma.customerPortalSession.update({
          where: { sessionToken: `otp-placeholder-${customer.id}` },
          data: { otpSentAt: null, otpExpiresAt: new Date() },
        });
        // A cap is the caller asking too often (or someone abusing the endpoint), not an outage.
        if (sms.limited) {
          throw new HttpException(
            'Too many login codes have been requested. Please wait a while and try again.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        throw new ServiceUnavailableException(
          sms.error === 'Messaging not configured'
            ? 'We cannot send login codes right now. Please try again later or contact the shop.'
            : 'We could not send your code just now. Please try again in a moment.',
        );
      }
    }

    return {
      sent: true,
      customerId: customer.id,
      // "We still need a name from you" — the clients use this to decide whether
      // to ask for one. Keyed on verification rather than on whether the row was
      // created this second, so abandoning the first attempt no longer leaves the
      // customer called "Customer" forever.
      isNew: !customer.phoneVerifiedAt && (!customer.name || customer.name === 'Customer'),
      // Drives the client countdown and the resend button. Sent by the server so
      // the timer the customer watches is the one actually being enforced.
      expiresInSeconds: OTP_TTL_MS / 1000,
      resendInSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
      ...(isDev ? { otp } : {}),
    };
  }

  async verifyOtp(phone: string, otp: string, businessId: string, name?: string) {
    const canonical = normalizeKePhone(phone);
    if (!canonical) {
      throw new BadRequestException(
        'Enter a valid Kenyan mobile number, e.g. 0712345678.',
      );
    }

    const customer = await this.prisma.customer.findFirst({
      where: { businessId, phone: { in: kePhoneVariants(canonical) } },
      select: { id: true, name: true, shopCode: true, phoneVerifiedAt: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Matched on customerId alone: the placeholder is unique per customer, and a
    // session written before normalization carries the old phone shape.
    const session = await this.prisma.customerPortalSession.findFirst({
      where: {
        customerId: customer.id,
        otpExpiresAt: { gt: new Date() },
        otpHash: { not: null },
      },
    });

    if (!session) {
      // A burned code is expired, so it lands here too. Tell a customer who simply
      // mistyped five times what to do, instead of "expired or not found".
      const burned = await this.prisma.customerPortalSession.findFirst({
        where: { customerId: customer.id, otpAttempts: { gte: OTP_MAX_ATTEMPTS } },
        select: { id: true },
      });
      throw new UnauthorizedException(
        burned
          ? 'Too many incorrect codes. Please request a new one.'
          : 'OTP has expired or not found',
      );
    }

    // Six digits is only a million guesses — trivial to script without a cap. Burn the
    // code once the limit is hit so the attacker has to trigger a new SMS (which the
    // cooldown then paces) rather than carrying on against the same one.
    if (session.otpAttempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        'Too many incorrect codes. Please request a new one.',
      );
    }

    const inputHash = createHash('sha256').update(otp).digest('hex');
    if (inputHash !== session.otpHash) {
      const attempts = session.otpAttempts + 1;
      await this.prisma.customerPortalSession.update({
        where: { id: session.id },
        // Expiring the code on the last strike stops a slow grinder from sitting on
        // one OTP; the row stays so the attempt count is not wiped by retrying.
        data: {
          otpAttempts: attempts,
          ...(attempts >= OTP_MAX_ATTEMPTS ? { otpExpiresAt: new Date() } : {}),
        },
      });
      const left = OTP_MAX_ATTEMPTS - attempts;
      throw new UnauthorizedException(
        left > 0
          ? `Invalid code. ${left} attempt${left === 1 ? '' : 's'} left.`
          : 'Too many incorrect codes. Please request a new one.',
      );
    }

    // First verified login for this phone → treat as a brand-new registration.
    const isNew = !customer.phoneVerifiedAt;

    // Capture/refresh profile: stamp verification, canonicalize the stored number,
    // and set the name if the customer supplied one and we only had the placeholder.
    const shouldSetName = !!name?.trim() && (isNew || !customer.name || customer.name === 'Customer');
    const updated = await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        phone: canonical,
        ...(customer.phoneVerifiedAt ? {} : { phoneVerifiedAt: new Date() }),
        ...(shouldSetName ? { name: name!.trim() } : {}),
      },
      select: { name: true, shopCode: true },
    });

    // Generate real session token
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Replace the OTP-placeholder session with a real session
    await this.prisma.customerPortalSession.delete({ where: { id: session.id } });
    await this.prisma.customerPortalSession.create({
      data: {
        customerId: customer.id,
        phone: canonical,
        sessionToken: tokenHash,
        otpHash: null,
        otpExpiresAt: null,
        expiresAt,
      },
    });

    return {
      sessionToken: rawToken,
      token: rawToken, // alias — web portal reads `token`, mobile reads `sessionToken`
      customerId: customer.id,
      shopCode: updated.shopCode,
      customerName: updated.name,
      isNew,
    };
  }

  /**
   * Sweep dead portal sessions nightly. A placeholder row is only deleted when its
   * code is actually used, so every abandoned login — and every expired 30-day
   * session — otherwise stayed on the table forever.
   */
  @Cron('40 2 * * *')
  async pruneExpiredSessions(): Promise<{ removed: number }> {
    const { count } = await this.prisma.customerPortalSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) this.logger.log(`Pruned ${count} expired portal session(s)`);
    return { removed: count };
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  async getProfile(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        shopCode: true,
        loyaltyPoints: true,
        phoneVerifiedAt: true,
        businessId: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async updateProfile(customerId: string, dto: { name?: string; email?: string }) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim() || null } : {}),
      },
      select: { id: true, name: true, phone: true, email: true, loyaltyPoints: true },
    });
  }

  /** KDPA: customer-initiated data deletion. Creates a PENDING request the business
   *  owner reviews in Settings → KDPA (review cascades to anonymize the customer). */
  async requestAccountDeletion(customerId: string, reason?: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, businessId: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const existing = await this.prisma.dataDeletionRequest.findFirst({
      where: { customerId, status: 'PENDING' },
    });
    if (existing) return { requested: true, status: 'PENDING', id: existing.id };

    const req = await this.prisma.dataDeletionRequest.create({
      data: {
        businessId: customer.businessId,
        requestedBy: 'CUSTOMER',
        customerId,
        reason: reason?.trim() || 'Customer self-service deletion request',
        status: 'PENDING',
      },
    });
    return { requested: true, status: 'PENDING', id: req.id };
  }

  // ─── Saved addresses ──────────────────────────────────────────────────────

  async getAddresses(customerId: string) {
    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async addAddress(
    customerId: string,
    dto: { label?: string; address: string; lat?: number; lng?: number; isDefault?: boolean },
  ) {
    if (!dto.address?.trim()) throw new BadRequestException('Address is required');
    if (dto.isDefault) {
      await this.prisma.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
    }
    return this.prisma.customerAddress.create({
      data: {
        customerId,
        label: dto.label?.trim() || null,
        address: dto.address.trim(),
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async deleteAddress(customerId: string, id: string) {
    const addr = await this.prisma.customerAddress.findFirst({ where: { id, customerId } });
    if (!addr) throw new NotFoundException('Address not found');
    await this.prisma.customerAddress.delete({ where: { id } });
    return { ok: true };
  }

  // ─── Orders (unified: online portal orders + agent field orders) ──────────

  async getPortalOrders(customerId: string) {
    const [online, field] = await Promise.all([
      this.prisma.deliveryOrder.findMany({
        where: { customerId, channel: 'PORTAL' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { items: true },
      }),
      this.prisma.fieldOrder.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { items: true },
      }),
    ]);

    const normalized = [
      ...online.map((o) => this.normalizeOnline(o)),
      ...field.map((o) => this.normalizeField(o)),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return normalized;
  }

  async getPortalOrder(customerId: string, orderId: string) {
    const online = await this.prisma.deliveryOrder.findFirst({
      where: { id: orderId, customerId, channel: 'PORTAL' },
      include: { items: true },
    });
    if (online) return this.normalizeOnline(online);

    const field = await this.prisma.fieldOrder.findFirst({
      where: { id: orderId, customerId },
      include: {
        items: true,
        route: { select: { id: true, name: true } },
        deliveryRunOrders: {
          select: {
            id: true, status: true, deliveredAt: true,
            proof: { select: { id: true, receivedByName: true, capturedAt: true } },
          },
        },
      },
    });
    if (!field) throw new NotFoundException('Order not found');
    return this.normalizeField(field);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizeOnline(o: any) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      channel: 'ONLINE' as const,
      status: o.status,
      paymentStatus: o.paymentStatus,
      fulfillmentType: o.fulfillmentType,
      deliveryAddress: o.deliveryAddress,
      etaMinutes: o.etaMinutes,
      totalCents: o.totalCents,
      invoiceNumber: null as string | null,
      createdAt: o.createdAt,
      deliveredAt: o.deliveredAt,
      items: (o.items ?? []).map((i: any) => ({
        itemId: i.itemId, name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents, totalCents: i.totalCents,
      })),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizeField(o: any) {
    return {
      id: o.id,
      orderNumber: o.orderNumber ?? o.id.slice(0, 8),
      channel: 'AGENT' as const,
      status: o.status,
      paymentStatus: o.paymentStatus,
      fulfillmentType: 'DELIVERY' as const,
      deliveryAddress: null as string | null,
      etaMinutes: null as number | null,
      totalCents: o.totalCents,
      invoiceNumber: o.invoiceNumber ?? null,
      createdAt: o.createdAt,
      deliveredAt: o.deliveredAt ?? null,
      items: (o.items ?? []).map((i: any) => ({
        itemId: i.itemId, name: i.itemName, quantity: i.quantity, unitPriceCents: i.unitPriceCents, totalCents: i.totalCents,
      })),
    };
  }

  // ─── Statement ────────────────────────────────────────────────────────────

  async getPortalStatement(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        creditLimitCents: true,
        paymentTermsDays: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    // Outstanding: sum of unpaid/partial field orders
    const outstandingAgg = await this.prisma.fieldOrder.aggregate({
      where: {
        customerId,
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        status: { notIn: ['CANCELLED', 'DRAFT'] },
      },
      _sum: { totalCents: true },
    });
    const outstandingCents = outstandingAgg._sum.totalCents ?? 0;

    // Recent payments (paid orders)
    const recentPayments = await this.prisma.fieldOrder.findMany({
      where: {
        customerId,
        paymentStatus: 'PAID',
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        orderNumber: true,
        totalCents: true,
        paidAmountCents: true,
        paymentMethod: true,
        mpesaReference: true,
        updatedAt: true,
      },
    });

    return {
      customerId: customer.id,
      customerName: customer.name,
      creditLimitCents: customer.creditLimitCents,
      outstandingCents,
      availableCreditCents: Math.max(
        0,
        (customer.creditLimitCents ?? 0) - outstandingCents,
      ),
      paymentTermsDays: customer.paymentTermsDays,
      recentPayments,
    };
  }

  // ─── Payment ──────────────────────────────────────────────────────────────

  async requestPayment(
    customerId: string,
    fieldOrderId: string,
    method: 'STK_PUSH' | 'PAYBILL',
  ) {
    const order = await this.prisma.fieldOrder.findFirst({
      where: { id: fieldOrderId, customerId },
      include: { customer: { select: { phone: true } } },
    });
    if (!order) throw new NotFoundException('Field order not found');
    if (order.paymentStatus === 'PAID') {
      throw new BadRequestException('Order is already paid');
    }

    if (method === 'PAYBILL') {
      // Return paybill details; actual paybill from business settings (stub)
      return {
        method: 'PAYBILL',
        paybillNumber: '400200', // stub — would come from Business settings
        accountReference: order.orderNumber ?? order.id,
        amountCents: order.totalCents - order.paidAmountCents,
        message: `Pay KES ${((order.totalCents - order.paidAmountCents) / 100).toFixed(2)} via Paybill 400200, Account: ${order.orderNumber ?? order.id}`,
      };
    }

    // STK_PUSH stub — wire to MpesaService when available
    return {
      method: 'STK_PUSH',
      message: 'STK push initiated (stub — integrate with MpesaService)',
      amountCents: order.totalCents - order.paidAmountCents,
    };
  }

  // ─── Reorder ──────────────────────────────────────────────────────────────

  async requestReorder(customerId: string, fieldOrderId: string) {
    const original = await this.prisma.fieldOrder.findFirst({
      where: { id: fieldOrderId, customerId },
      include: {
        items: true,
        customer: { select: { name: true, salesAgentId: true } },
      },
    });
    if (!original) throw new NotFoundException('Field order not found');

    // Duplicate as DRAFT
    const newOrder = await this.prisma.fieldOrder.create({
      data: {
        offlineId: uuidv4(),
        businessId: original.businessId,
        agentId: original.agentId,
        customerId: original.customerId,
        routeId: original.routeId,
        status: 'DRAFT',
        subtotalCents: original.subtotalCents,
        vatCents: original.vatCents,
        totalCents: original.totalCents,
        isSampleOrder: false,
        notes: `Reorder of ${original.orderNumber ?? original.id}`,
        items: {
          create: original.items.map((item) => ({
            itemId: item.itemId,
            itemName: item.itemName,
            itemSku: item.itemSku,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            totalCents: item.totalCents,
            isSample: false,
          })),
        },
      },
      include: { items: true },
    });

    // Notify the agent
    if (original.customer.salesAgentId) {
      await this.notifications.createNotification({
        businessId: original.businessId,
        type: 'REORDER_REQUEST',
        priority: 'NORMAL',
        title: 'Reorder Request',
        body: `Customer ${original.customer.name} has requested a reorder`,
        entityId: newOrder.id,
        entityType: 'FieldOrder',
      });
    }

    return newOrder;
  }
}
