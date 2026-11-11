import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LicenseAuthorityService } from '../licensing/license-authority.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { DbBackupService } from '../backup/db-backup.service';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { normalizeTier, planDisplayName } from '@pos/shared';
import { jwtSecret } from '../common/jwt-secret';

/**
 * Keep `planName` truthful whenever a tier is written.
 *
 * planName is a display label, but it was being written independently of the
 * tier — the admin console happened to send both, and every other caller did
 * not. That is how a business ended up on tier ENTERPRISE labelled "Free", which
 * then locked the customer out of the UI they had paid for and, worse, applied
 * the free-tier transaction cap to them.
 *
 * Deriving it here means no caller can reintroduce the mismatch, and an explicit
 * planName from the caller is deliberately ignored rather than trusted: there is
 * no legitimate reason for the label to disagree with the tier.
 */
function withDerivedPlanName<T extends { subscriptionTier?: string; planName?: string }>(data: T): T {
  if (!data.subscriptionTier) return data;
  return {
    ...data,
    subscriptionTier: normalizeTier(data.subscriptionTier),
    planName: planDisplayName(data.subscriptionTier),
  };
}

// Plan pricing (KES cents / month) — 5-tier
const PLAN_PRICE: Record<string, number> = {
  FREE:       0,
  STARTER:    99900,
  GROWTH:     249900,
  PRO:        499900,
  ENTERPRISE: 1499900,
  TRIAL:      0,
};

@Injectable()
export class SuperAdminService {
  private readonly logger = new Logger(SuperAdminService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private email: EmailService,
    private backup: DbBackupService,
    private licenseAuthority: LicenseAuthorityService,
  ) {}

  async login(email: string, password: string): Promise<{ token: string }> {
    const admin = await this.prisma.superAdmin.findUnique({ where: { email } });
    if (!admin) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const token = this.jwt.sign(
      { sub: admin.id, email: admin.email, role: 'SUPER_ADMIN' },
      { secret: process.env.SUPER_ADMIN_SECRET ?? 'super-admin-change-me', expiresIn: '8h' },
    );

    return { token };
  }

  /** Bootstrap first super admin from env vars (called on module init) */
  async ensureDefaultAdmin() {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!email || !password) return;

    const existing = await this.prisma.superAdmin.findUnique({ where: { email } });
    if (existing) return;

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.superAdmin.create({
      data: { id: uuidv4(), email, name: 'Super Admin', passwordHash },
    });
    this.logger.log(`Super admin created: ${email}`);
  }

  async listBusinesses(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const where = search ? { name: { contains: search } } : {};

    const [businesses, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { users: true, stores: true } },
          users: { where: { role: 'OWNER' }, select: { email: true, name: true }, take: 1 },
        },
      }),
      this.prisma.business.count({ where }),
    ]);

    return { businesses, total, page, limit };
  }

  async getPlatformStats() {
    const since30d = new Date(Date.now() - 30 * 86400000);
    const [
      totalBusinesses,
      activeSubscriptions,
      trialBusinesses,
      expiredBusinesses,
      totalUsers,
      totalSalesAmount,
      sales30d,
      newBusinesses30d,
      referralsConverted,
    ] = await Promise.all([
      this.prisma.business.count(),
      this.prisma.business.count({ where: { subscriptionStatus: 'ACTIVE' } }),
      this.prisma.business.count({ where: { subscriptionStatus: 'TRIAL' } }),
      this.prisma.business.count({ where: { subscriptionStatus: 'EXPIRED' } }),
      this.prisma.user.count(),
      this.prisma.sale.aggregate({ where: { status: 'PAID' }, _sum: { totalCents: true } }),
      this.prisma.sale.aggregate({ where: { status: 'PAID', createdAt: { gte: since30d } }, _sum: { totalCents: true } }),
      this.prisma.business.count({ where: { createdAt: { gte: since30d } } }),
      this.prisma.referral.count({ where: { status: 'CONVERTED' } }),
    ]);

    // Plan breakdown counts (all tiers including FREE). Comped accounts are counted
    // separately: they are real businesses on a real plan, but nobody paid for them,
    // so folding them into the paid mix invents revenue.
    const paid = { subscriptionStatus: 'ACTIVE', isComped: false };
    const [freeCount, starterCount, growthCount, proCount, enterpriseCount, compedCount] =
      await Promise.all([
        this.prisma.business.count({ where: { subscriptionTier: 'FREE' } }),
        this.prisma.business.count({ where: { ...paid, subscriptionTier: 'STARTER' } }),
        this.prisma.business.count({ where: { ...paid, subscriptionTier: 'GROWTH' } }),
        this.prisma.business.count({ where: { ...paid, subscriptionTier: 'PRO' } }),
        this.prisma.business.count({ where: { ...paid, subscriptionTier: 'ENTERPRISE' } }),
        this.prisma.business.count({ where: { isComped: true } }),
      ]);

    // MRR from paying businesses only.
    const estimatedMRRCents =
      starterCount * 99900 +
      growthCount  * 249900 +
      proCount     * 499900 +
      enterpriseCount * 1499900;

    return {
      totalBusinesses,
      activeSubscriptions,
      trialBusinesses,
      expiredBusinesses,
      totalUsers,
      totalGMVCents: totalSalesAmount._sum.totalCents ?? 0,
      gmv30dCents: sales30d._sum.totalCents ?? 0,
      newBusinesses30d,
      referralsConverted,
      estimatedMRRCents,
      estimatedARRCents: estimatedMRRCents * 12,
      // Surfaced so an active-subscription count that includes gifts stays readable.
      compedBusinesses: compedCount,
      planBreakdown: { FREE: freeCount, STARTER: starterCount, GROWTH: growthCount, PRO: proCount, ENTERPRISE: enterpriseCount },
    };
  }

  async updateBusinessSubscription(businessId: string, data: {
    subscriptionStatus?: string;
    subscriptionTier?: string;
    planName?: string;
    trialEndsAt?: Date | null;
    isComped?: boolean;
    compedReason?: string | null;
  }) {
    return this.prisma.business.update({
      where: { id: businessId },
      data: withDerivedPlanName(data),
    });
  }

  /** Issue a short-lived JWT for a business owner — allows super admin to impersonate */
  async impersonate(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: { users: { where: { role: 'OWNER' }, take: 1 }, stores: { take: 1 } },
    });
    if (!business) throw new BadRequestException('Business not found');

    const owner = business.users[0];
    if (!owner) throw new BadRequestException('No owner found for this business');

    const token = this.jwt.sign(
      { sub: owner.id, businessId, role: owner.role, storeId: business.stores[0]?.id, impersonated: true },
      { secret: jwtSecret(), expiresIn: '1h' },
    );

    return { token, businessName: business.name, ownerEmail: owner.email };
  }

  // ── License Keys ─────────────────────────────────────────────────────────

  async listLicenseKeys(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [keys, total] = await Promise.all([
      this.prisma.licenseKey.findMany({ skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.licenseKey.count(),
    ]);

    // Enrich with business name + owner email
    const businessIds = [...new Set(keys.map(k => k.businessId).filter(Boolean))] as string[];
    const businesses = businessIds.length > 0
      ? await this.prisma.business.findMany({
          where: { id: { in: businessIds } },
          select: {
            id: true,
            name: true,
            users: { where: { role: 'OWNER' }, select: { email: true }, take: 1 },
          },
        })
      : [];
    const bizMap = new Map(businesses.map(b => [b.id, b]));

    const enriched = keys.map(k => ({
      ...k,
      business: k.businessId ? bizMap.get(k.businessId) ?? null : null,
    }));

    return { keys: enriched, total };
  }

  /**
   * A new licence key: KPS- and three groups of 8 random hex characters. The key itself proves nothing; it is only a name the
   * Faida server looks up. What makes a licence unforgeable is the signed token the server issues when the key is activated
   * (see licensing/). The old "machine-bound" keys carried a checksum whose recipe shipped in the desktop app, so anyone
   * could compute a valid one; they are gone.
   */
  private buildLicenseKey(): string {
    const part = () => randomBytes(4).toString('hex');
    return `KPS-${part()}-${part()}-${part()}`;
  }

  async createLicenseKey(data: { tier: string; expiresAt?: Date }) {
    const key = this.buildLicenseKey();
    return this.prisma.licenseKey.create({
      data: {
        key,
        tier: data.tier,
        expiresAt: data.expiresAt,
      },
    });
  }

  /** Free a key from the computer it is bound to, so a shop that replaced its PC can activate it on the new one. */
  releaseLicenseKey(id: string) {
    return this.licenseAuthority.release(id);
  }

  async revokeLicenseKey(id: string) {
    return this.prisma.licenseKey.update({ where: { id }, data: { isActive: false } });
  }

  /** Re-email the existing license key to the business owner. */
  async resendLicenseKey(id: string) {
    const key = await this.prisma.licenseKey.findUnique({ where: { id } });
    if (!key) throw new BadRequestException('License key not found');
    if (!key.businessId) throw new BadRequestException('Key is not linked to a business');

    const business = await this.prisma.business.findUnique({
      where: { id: key.businessId },
      select: { name: true, users: { where: { role: 'OWNER' }, select: { email: true }, take: 1 } },
    });
    const ownerEmail = business?.users[0]?.email;
    if (!ownerEmail) throw new BadRequestException('No owner email found for this business');

    await this.email.sendLicenseKey({
      to: ownerEmail,
      businessName: business!.name,
      plan: key.tier,
      licenseKey: key.key,
      expiresAt: key.expiresAt?.toISOString() ?? null,
    });

    this.logger.log(`Super-admin resent license key ${id} to ${ownerEmail}`);
    return { success: true, sentTo: ownerEmail };
  }

  /** Revoke the existing key, issue a new one, and email it to the business owner. */
  async regenerateLicenseKey(id: string) {
    const oldKey = await this.prisma.licenseKey.findUnique({ where: { id } });
    if (!oldKey) throw new BadRequestException('License key not found');
    if (!oldKey.businessId) throw new BadRequestException('Key is not linked to a business');

    const business = await this.prisma.business.findUnique({
      where: { id: oldKey.businessId },
      select: { name: true, users: { where: { role: 'OWNER' }, select: { email: true }, take: 1 } },
    });
    const ownerEmail = business?.users[0]?.email;
    if (!ownerEmail) throw new BadRequestException('No owner email found for this business');

    // Revoke old key and create replacement in a transaction
    const newKeyStr = this.buildLicenseKey();
    const [, newKey] = await this.prisma.$transaction([
      this.prisma.licenseKey.update({ where: { id }, data: { isActive: false } }),
      this.prisma.licenseKey.create({
        data: {
          key: newKeyStr,
          tier: oldKey.tier,
          businessId: oldKey.businessId,
          isActive: true,
          expiresAt: oldKey.expiresAt,
          activatedAt: new Date(),
        },
      }),
    ]);

    await this.email.sendLicenseKey({
      to: ownerEmail,
      businessName: business!.name,
      plan: newKey.tier,
      licenseKey: newKeyStr,
      expiresAt: newKey.expiresAt?.toISOString() ?? null,
    });

    this.logger.log(`Super-admin regenerated license key for business ${oldKey.businessId}, sent to ${ownerEmail}`);
    return { success: true, newKeyId: newKey.id, newKey: newKeyStr, sentTo: ownerEmail };
  }

  async getRecentSignups(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.prisma.business.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, stores: true } },
        users: { where: { role: 'OWNER' }, select: { email: true, name: true }, take: 1 },
      },
    });
  }

  async getBusinessUsers(businessId: string) {
    const users = await this.prisma.user.findMany({
      where: { businessId },
      select: {
        id: true, name: true, email: true, role: true, createdAt: true,
        loginAttempts: true, lockedUntil: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return users;
  }

  async listAllUsers(page = 1, limit = 30, search?: string, role?: string, businessName?: string, sortBy?: string, sortDir?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (role && role !== 'ALL') where.role = role;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (businessName) {
      where.business = { name: { contains: businessName, mode: 'insensitive' } };
    }

    const dir = sortDir === 'asc' ? 'asc' : 'desc';
    let orderBy: any = { createdAt: 'desc' };
    if (sortBy === 'name')     orderBy = { name: dir };
    if (sortBy === 'role')     orderBy = { role: dir };
    if (sortBy === 'joined')   orderBy = { createdAt: dir };
    if (sortBy === 'business') orderBy = { business: { name: dir } };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true, name: true, email: true, role: true, createdAt: true,
          loginAttempts: true, lockedUntil: true,
          business: { select: { id: true, name: true, planName: true, subscriptionStatus: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users, total, page, limit };
  }

  async deleteUser(userId: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.role === 'OWNER') throw new BadRequestException('Cannot delete the business owner account');
    await this.prisma.user.delete({ where: { id: userId } });
    this.logger.log(`Super-admin deleted user ${userId}`);
    return { success: true };
  }

  async deleteBusiness(businessId: string): Promise<{ success: boolean }> {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new BadRequestException('Business not found');

    const id = businessId;

    // Pass 1 — IDs of records with a direct businessId
    const ids = (q: Promise<{ id: string }[]>) => q.then(r => r.map(x => x.id));
    const [saleIds, orderIds, itemIds, customerIds, giftCardIds,
           employeeIds, poIds, fieldOrderIds, storeIds, userIds,
           payrollRunIds, stocktakeSessionIds, transferIds, hotelRoomIds] = await Promise.all([
      ids(this.prisma.sale.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.order.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.item.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.customer.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.giftCard.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.employee.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.purchaseOrder.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.fieldOrder.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.store.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.user.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.payrollRun.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.stocktakeSession.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.storeTransfer.findMany({ where: { businessId: id }, select: { id: true } })),
      ids(this.prisma.hotelRoom.findMany({ where: { businessId: id }, select: { id: true } })),
    ]);
    // Pass 2 — IDs derived from pass-1 results
    const [grnIds, tableIds] = await Promise.all([
      ids(this.prisma.gRN.findMany({ where: { poId: { in: poIds } }, select: { id: true } })),
      ids(this.prisma.table.findMany({ where: { storeId: { in: storeIds } }, select: { id: true } })),
    ]);

    // ── Deepest leaves first ──────────────────────────────────────────────────
    await this.prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    await this.prisma.payment.deleteMany({ where: { saleId: { in: saleIds } } });
    await this.prisma.voidRecord.deleteMany({ where: { saleId: { in: saleIds } } });
    await this.prisma.loyaltyTransaction.deleteMany({ where: { customerId: { in: customerIds } } });
    await this.prisma.giftCardTransaction.deleteMany({ where: { giftCardId: { in: giftCardIds } } });
    await this.prisma.kOT.deleteMany({ where: { orderId: { in: orderIds } } });
    await this.prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await this.prisma.stocktakeCount.deleteMany({ where: { sessionId: { in: stocktakeSessionIds } } });
    await this.prisma.gRNItem.deleteMany({ where: { grnId: { in: grnIds } } });
    await this.prisma.pOItem.deleteMany({ where: { poId: { in: poIds } } });
    await this.prisma.fieldOrderItem.deleteMany({ where: { fieldOrderId: { in: fieldOrderIds } } });
    await this.prisma.itemVariant.deleteMany({ where: { itemId: { in: itemIds } } });
    await this.prisma.itemUOM.deleteMany({ where: { itemId: { in: itemIds } } });
    await this.prisma.recipeIngredient.deleteMany({ where: { recipeItemId: { in: itemIds } } });
    await this.prisma.bundleComponent.deleteMany({ where: { bundleItemId: { in: itemIds } } });
    await this.prisma.batch.deleteMany({ where: { itemId: { in: itemIds } } });
    await this.prisma.serialRecord.deleteMany({ where: { itemId: { in: itemIds } } });
    await this.prisma.payslip.deleteMany({ where: { payrollRunId: { in: payrollRunIds } } });
    await this.prisma.attendanceRecord.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await this.prisma.leave.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await this.prisma.leaveBalance.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await this.prisma.transferItem.deleteMany({ where: { transferId: { in: transferIds } } });
    await this.prisma.tableReservation.deleteMany({ where: { tableId: { in: tableIds } } });
    await this.prisma.roomBooking.deleteMany({ where: { businessId: id } });
    await this.prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await this.prisma.userStore.deleteMany({ where: { userId: { in: userIds } } });

    // ── Mid-tier (children deleted above) ────────────────────────────────────
    await this.prisma.return.deleteMany({ where: { businessId: id } });
    await this.prisma.sale.deleteMany({ where: { businessId: id } });
    await this.prisma.order.deleteMany({ where: { businessId: id } });
    await this.prisma.giftCard.deleteMany({ where: { businessId: id } });
    await this.prisma.inventoryMovement.deleteMany({ where: { businessId: id } });
    await this.prisma.stocktakeSession.deleteMany({ where: { businessId: id } });
    await this.prisma.gRN.deleteMany({ where: { id: { in: grnIds } } });
    await this.prisma.purchaseOrder.deleteMany({ where: { businessId: id } });
    await this.prisma.fieldOrder.deleteMany({ where: { businessId: id } });
    await this.prisma.item.deleteMany({ where: { businessId: id } });
    await this.prisma.category.deleteMany({ where: { businessId: id } });
    await this.prisma.customer.deleteMany({ where: { businessId: id } });
    await this.prisma.supplier.deleteMany({ where: { businessId: id } });
    await this.prisma.employee.deleteMany({ where: { businessId: id } });
    await this.prisma.payrollRun.deleteMany({ where: { businessId: id } });
    await this.prisma.shift.deleteMany({ where: { businessId: id } });
    await this.prisma.expense.deleteMany({ where: { businessId: id } });
    await this.prisma.promotion.deleteMany({ where: { businessId: id } });
    await this.prisma.loyaltyProgram.deleteMany({ where: { businessId: id } });
    await this.prisma.table.deleteMany({ where: { id: { in: tableIds } } });
    await this.prisma.hotelRoom.deleteMany({ where: { businessId: id } });
    await this.prisma.storeTransfer.deleteMany({ where: { businessId: id } });
    await this.prisma.notification.deleteMany({ where: { businessId: id } });
    await this.prisma.auditLog.deleteMany({ where: { businessId: id } });
    await this.prisma.apiKey.deleteMany({ where: { businessId: id } });
    await this.prisma.webhook.deleteMany({ where: { businessId: id } });
    await this.prisma.integration.deleteMany({ where: { businessId: id } });
    await this.prisma.budget.deleteMany({ where: { businessId: id } });
    await this.prisma.reportSchedule.deleteMany({ where: { businessId: id } });
    await this.prisma.printer.deleteMany({ where: { storeId: { in: storeIds } } });

    // ── Users & stores, then the business itself ──────────────────────────────
    await this.prisma.user.deleteMany({ where: { businessId: id } });
    await this.prisma.store.deleteMany({ where: { businessId: id } });
    await this.prisma.business.delete({ where: { id } });

    this.logger.log(`Super-admin deleted business ${id} (${business.name})`);
    return { success: true };
  }

  async resetUserPassword(userId: string): Promise<{ tempPassword: string; email: string | null }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    // Generate secure temporary password: Faida + 6 random chars + 2 digits + !
    const chars = randomBytes(4).toString('hex').toUpperCase().slice(0, 4);
    const digits = String(Math.floor(Math.random() * 90) + 10);
    const tempPassword = `Faida@${chars}${digits}!`;
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, loginAttempts: 0, lockedUntil: null },
    });

    this.logger.log(`Super-admin reset password for user ${userId} (${user.email ?? 'no email'})`);
    return { tempPassword, email: user.email };
  }

  async unlockUser(userId: string): Promise<{ success: boolean; name: string }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { loginAttempts: 0, lockedUntil: null },
    });
    this.logger.log(`Super-admin unlocked user ${userId}`);
    return { success: true, name: user.name };
  }

  async updateUser(userId: string, data: { name?: string; role?: string; email?: string }) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name  !== undefined && { name: data.name }),
        ...(data.role  !== undefined && { role: data.role as any }),
        ...(data.email !== undefined && { email: data.email }),
      },
      select: { id: true, name: true, email: true, role: true },
    });
    this.logger.log(`Super-admin updated user ${userId}`);
    return user;
  }

  // ── Health Dashboard ──────────────────────────────────────────────────────

  async getSystemHealth() {
    const [
      totalBusinesses,
      activeBusinesses,
      pendingEtims,
      totalEtims24h,
      webhookFailures,
      sales24h,
    ] = await Promise.all([
      this.prisma.business.count(),
      this.prisma.business.count({
        where: { subscriptionStatus: { not: 'CANCELLED' } },
      }),
      this.prisma.sale.count({
        where: {
          etimsSubmitted: false,
          status: { in: ['PAID', 'AMENDED'] },
          type: 'NORMAL',
        },
      }),
      this.prisma.sale.count({
        where: {
          type: 'NORMAL',
          status: { in: ['PAID', 'AMENDED'] },
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
      }),
      this.prisma.webhook.aggregate({ _sum: { failureCount: true } }),
      this.prisma.sale.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 86400000) },
          status: { in: ['PAID', 'AMENDED'] },
        },
      }),
    ]);

    const recentBackups = this.backup.listBackups().slice(0, 5);

    return {
      totalBusinesses,
      activeBusinesses,
      pendingEtimsCount: pendingEtims,
      etimsFailureRate:
        totalEtims24h > 0 ? Math.round((pendingEtims / totalEtims24h) * 100) : 0,
      webhookFailureCount: webhookFailures._sum.failureCount ?? 0,
      sales24h,
      backups: recentBackups,
      lastBackupAt: recentBackups[0]?.createdAt ?? null,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Business Support View ─────────────────────────────────────────────────

  async getBusinessData(businessId: string) {
    const since30d = new Date(Date.now() - 30 * 86400000);
    const [business, recentSales, users, itemCount, storeCount, recentSalesCount, recentGMV] = await Promise.all([
      this.prisma.business.findUnique({
        where: { id: businessId },
        select: {
          id: true,
          name: true,
          subscriptionTier: true,
          subscriptionStatus: true,
          planName: true,
          trialEndsAt: true,
          createdAt: true,
        },
      }),
      this.prisma.sale.findMany({
        where: { businessId, status: { in: ['PAID', 'AMENDED'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, receiptNumber: true, totalCents: true, createdAt: true, type: true, status: true },
      }),
      this.prisma.user.findMany({
        where: { businessId },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      }),
      this.prisma.item.count({ where: { businessId, deletedAt: null } }),
      this.prisma.store.count({ where: { businessId } }),
      this.prisma.sale.count({ where: { businessId, status: { in: ['PAID', 'AMENDED'] }, createdAt: { gte: since30d } } }),
      this.prisma.sale.aggregate({ where: { businessId, status: { in: ['PAID', 'AMENDED'] }, createdAt: { gte: since30d } }, _sum: { totalCents: true } }),
    ]);

    return {
      business,
      recentSales,
      users,
      itemCount,
      storeCount,
      userCount: users.length,
      recentSalesCount,
      recentGMVCents: recentGMV._sum.totalCents ?? 0,
    };
  }

  async listReferrals(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [referrals, total] = await Promise.all([
      this.prisma.referral.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          referrer: { select: { id: true, name: true } },
        },
      }),
      this.prisma.referral.count(),
    ]);
    const stats = await this.prisma.referral.groupBy({
      by: ['status'],
      _count: { id: true },
    });
    return { referrals, total, stats };
  }

  // ── Force Update Notifications ────────────────────────────────────────────

  async triggerForceUpdate(version: string, message: string, isRequired = true) {
    const businesses = await this.prisma.business.findMany({ select: { id: true } });

    await Promise.all(
      businesses.map((biz) =>
        this.prisma.notification.create({
          data: {
            businessId: biz.id,
            type: 'FORCE_UPDATE',
            priority: isRequired ? 'HIGH' : 'MEDIUM',
            title: `App Update Available: v${version}`,
            body: message,
            entityType: 'System',
            entityId: version,
          },
        }),
      ),
    );

    return { sent: businesses.length, version, message };
  }

  async checkForUpdate() {
    const latest = await this.prisma.notification.findFirst({
      where: { type: 'FORCE_UPDATE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) return { updateAvailable: false };

    return {
      updateAvailable: true,
      version: latest.entityId,
      message: latest.body,
      isRequired: latest.priority === 'HIGH',
    };
  }

  // ── Audit Logging ─────────────────────────────────────────────────────────

  async logAction(adminEmail: string, action: string, targetId?: string, targetType?: string, details?: any, ipAddress?: string) {
    try {
      await (this.prisma as any).superAdminAuditLog.create({
        data: {
          id: uuidv4(),
          adminEmail,
          action,
          targetId,
          targetType,
          details: details ? JSON.stringify(details) : null,
          ipAddress,
        },
      });
    } catch { /* non-blocking */ }
  }

  async getSuperAdminAuditLogs(page = 1, limit = 50, adminEmail?: string) {
    const skip = (page - 1) * limit;
    const where: any = adminEmail ? { adminEmail } : {};
    const [logs, total] = await Promise.all([
      (this.prisma as any).superAdminAuditLog.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      (this.prisma as any).superAdminAuditLog.count({ where }),
    ]);
    return { logs, total, page, limit };
  }

  // ── Per-business Audit Log ────────────────────────────────────────────────

  async getBusinessAuditLogs(businessId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { businessId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true, actor: true, actorType: true, action: true, entity: true, entityId: true, createdAt: true },
      }),
      this.prisma.auditLog.count({ where: { businessId } }),
    ]);
    return { logs, total, page, limit };
  }

  // ── Churn Analytics ───────────────────────────────────────────────────────

  async getChurnAnalytics(from?: string, to?: string) {
    const now = new Date();
    const rangeEnd   = to   ? new Date(to)   : now;
    const rangeStart = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth() - 11, 1);

    // Build list of months in the range
    const months: { start: Date; end: Date; label: string }[] = [];
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    while (cursor <= rangeEnd) {
      const start = new Date(cursor);
      const end   = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
      months.push({ start, end, label: start.toISOString().slice(0, 7) });
      cursor.setMonth(cursor.getMonth() + 1);
      if (months.length > 36) break; // safety cap
    }

    const trend: { month: string; cancelled: number; newActive: number; churnRate: number }[] = [];
    for (const { start, end, label } of months) {
      const [cancelled, newActive, activeAtStart] = await Promise.all([
        this.prisma.business.count({ where: { subscriptionStatus: 'CANCELLED', cancelledAt: { gte: start, lte: end } } }),
        this.prisma.business.count({ where: { subscriptionStatus: 'ACTIVE', updatedAt: { gte: start, lte: end } } }),
        this.prisma.business.count({ where: { subscriptionStatus: 'ACTIVE', createdAt: { lt: start } } }),
      ]);
      trend.push({
        month: label,
        cancelled,
        newActive,
        churnRate: activeAtStart > 0 ? Math.round((cancelled / activeAtStart) * 1000) / 10 : 0,
      });
    }

    // Cancellation reasons (within range)
    const reasonRaw = await this.prisma.business.groupBy({
      by: ['cancelReason'],
      where: {
        subscriptionStatus: 'CANCELLED',
        cancelReason: { not: null },
        cancelledAt: { gte: rangeStart, lte: rangeEnd },
      },
      _count: { id: true },
    });
    const reasons = reasonRaw.map(r => ({ reason: r.cancelReason ?? 'OTHER', count: r._count.id }));

    // 30-day churn rate (always from today regardless of range)
    const since30d = new Date(Date.now() - 30 * 86400000);
    const [cancelled30d, activeStart30d] = await Promise.all([
      this.prisma.business.count({ where: { subscriptionStatus: 'CANCELLED', cancelledAt: { gte: since30d } } }),
      this.prisma.business.count({ where: { subscriptionStatus: 'ACTIVE', createdAt: { lt: since30d } } }),
    ]);
    const churnRate30d = activeStart30d > 0 ? Math.round((cancelled30d / activeStart30d) * 1000) / 10 : 0;

    const atRisk = await this.prisma.business.count({
      where: {
        subscriptionStatus: 'ACTIVE',
        subscriptionTier: 'STARTER',
        createdAt: { lt: new Date(Date.now() - 90 * 86400000) },
      },
    });

    return { trend, reasons, churnRate30d, cancelled30d, atRisk, from: rangeStart.toISOString().slice(0, 10), to: rangeEnd.toISOString().slice(0, 10) };
  }

  // ── Trials Expiring Soon ──────────────────────────────────────────────────

  async getTrialsExpiringSoon(days = 7) {
    const now    = new Date();
    const cutoff = new Date(now.getTime() + days * 86400000);
    const businesses = await this.prisma.business.findMany({
      where: { subscriptionStatus: 'TRIAL', trialEndsAt: { gte: now, lte: cutoff } },
      select: {
        id: true, name: true, trialEndsAt: true, createdAt: true,
        users: { where: { role: 'OWNER' }, select: { email: true, name: true }, take: 1 },
      },
      orderBy: { trialEndsAt: 'asc' },
    });
    return businesses.map(b => ({
      ...b,
      daysRemaining: b.trialEndsAt
        ? Math.max(0, Math.ceil((b.trialEndsAt.getTime() - now.getTime()) / 86400000))
        : 0,
    }));
  }

  // ── Dunning (expired / lapsed accounts) ──────────────────────────────────

  async getDunningList() {
    const now      = new Date();
    const since30d = new Date(now.getTime() - 30 * 86400000);

    const [recentlyExpired, expiredTrials] = await Promise.all([
      // Businesses with status EXPIRED in the last 30 days
      this.prisma.business.findMany({
        where: { subscriptionStatus: 'EXPIRED', updatedAt: { gte: since30d } },
        select: {
          id: true, name: true, subscriptionTier: true, trialEndsAt: true, updatedAt: true,
          users: { where: { role: 'OWNER' }, select: { email: true, name: true }, take: 1 },
        },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      // Trials that ran past end date but status not yet updated
      this.prisma.business.findMany({
        where: { subscriptionStatus: 'TRIAL', trialEndsAt: { lt: now } },
        select: {
          id: true, name: true, trialEndsAt: true,
          users: { where: { role: 'OWNER' }, select: { email: true, name: true }, take: 1 },
        },
        orderBy: { trialEndsAt: 'asc' },
        take: 30,
      }),
    ]);

    return {
      recentlyExpired,
      expiredTrials,
      totalAtRisk: recentlyExpired.length + expiredTrials.length,
    };
  }

  // ── Alert Feed ────────────────────────────────────────────────────────────

  async getAlertFeed() {
    const since7d  = new Date(Date.now() - 7  * 86400000);
    const since24h = new Date(Date.now() - 86400000);
    const now      = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);

    type AlertSeverity = 'critical' | 'warning' | 'info';
    const alerts: Array<{
      type: string; severity: AlertSeverity; title: string; body: string;
      timestamp: Date; businessId?: string; businessName?: string;
    }> = [];

    const [enterpriseChurns, newEnterprise, etimsPending, etimsTotal, webhookAgg, expiringCount] = await Promise.all([
      this.prisma.business.findMany({
        where: { subscriptionStatus: 'CANCELLED', subscriptionTier: 'ENTERPRISE', cancelledAt: { gte: since7d } },
        select: { id: true, name: true, cancelledAt: true, cancelReason: true },
      }),
      this.prisma.business.findMany({
        where: { subscriptionTier: 'ENTERPRISE', createdAt: { gte: since7d } },
        select: { id: true, name: true, createdAt: true },
      }),
      this.prisma.sale.count({ where: { etimsSubmitted: false, status: { in: ['PAID', 'AMENDED'] }, type: 'NORMAL', createdAt: { gte: since24h } } }),
      this.prisma.sale.count({ where: { status: { in: ['PAID', 'AMENDED'] }, type: 'NORMAL', createdAt: { gte: since24h } } }),
      this.prisma.webhook.aggregate({ _sum: { failureCount: true } }),
      this.prisma.business.count({ where: { subscriptionStatus: 'TRIAL', trialEndsAt: { lte: tomorrow } } }),
    ]);

    for (const b of enterpriseChurns) {
      alerts.push({ type: 'ENTERPRISE_CHURN', severity: 'critical', title: 'Enterprise account churned', body: `${b.name} cancelled (${b.cancelReason ?? 'no reason given'})`, timestamp: b.cancelledAt!, businessId: b.id, businessName: b.name });
    }
    for (const b of newEnterprise) {
      alerts.push({ type: 'NEW_ENTERPRISE', severity: 'info', title: 'New Enterprise signup', body: `${b.name} joined on Enterprise plan`, timestamp: b.createdAt, businessId: b.id, businessName: b.name });
    }

    const failRate = etimsTotal > 0 ? Math.round((etimsPending / etimsTotal) * 100) : 0;
    if (failRate > 10) {
      alerts.push({ type: 'ETIMS_FAILURE', severity: 'critical', title: `High eTIMS failure rate: ${failRate}%`, body: `${etimsPending} of ${etimsTotal} sales not submitted to KRA (last 24h)`, timestamp: new Date() });
    }

    if (expiringCount > 0) {
      alerts.push({ type: 'TRIALS_EXPIRING', severity: 'warning', title: `${expiringCount} trial(s) expiring within 24h`, body: 'Consider reaching out to convert these accounts', timestamp: new Date() });
    }

    const totalWebhookFails = webhookAgg._sum.failureCount ?? 0;
    if (totalWebhookFails > 10) {
      alerts.push({ type: 'WEBHOOK_FAILURES', severity: 'warning', title: `${totalWebhookFails} webhook failures`, body: 'Multiple webhooks failing — check Platform Settings › Webhooks', timestamp: new Date() });
    }

    alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return alerts.slice(0, 20);
  }

  // ── Lightweight collected revenue (Paystack, KES) ─────────────────────────

  async getCollectedRevenueCents(): Promise<{ available: boolean; totalCents: number; message?: string }> {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) return { available: false, totalCents: 0, message: 'PAYSTACK_SECRET_KEY not set' };
    try {
      const res = await fetch('https://api.paystack.co/transaction?status=success&perPage=200&currency=KES', {
        headers: { Authorization: `Bearer ${secretKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { available: false, totalCents: 0, message: 'Paystack API error' };
      const data: any = await res.json();
      const transactions: any[] = data.data ?? [];
      // Paystack amounts in kobo/cents (100 = KES 1)
      const total = transactions.reduce((s: number, t: any) => s + (t.amount ?? 0), 0);
      return { available: true, totalCents: Math.round(total) };
    } catch {
      return { available: false, totalCents: 0, message: 'Failed to fetch Paystack data' };
    }
  }

  // ── Cohort Analysis ───────────────────────────────────────────────────────

  async getCohortAnalysis() {
    // Get all businesses with their createdAt and subscriptionStatus
    const businesses = await this.prisma.business.findMany({
      select: { id: true, createdAt: true, subscriptionStatus: true, subscriptionTier: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by signup month
    const cohortMap: Record<string, { total: number; active: number; trial: number; cancelled: number; expired: number }> = {};
    for (const biz of businesses) {
      const month = biz.createdAt.toISOString().slice(0, 7);
      if (!cohortMap[month]) cohortMap[month] = { total: 0, active: 0, trial: 0, cancelled: 0, expired: 0 };
      cohortMap[month].total++;
      const s = biz.subscriptionStatus.toLowerCase() as keyof typeof cohortMap[string];
      if (s in cohortMap[month]) (cohortMap[month] as any)[s]++;
    }

    const cohorts = Object.entries(cohortMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12) // last 12 months
      .map(([month, data]) => ({
        month,
        ...data,
        conversionRate: data.total > 0 ? Math.round((data.active / data.total) * 100) : 0,
        churnRate: data.total > 0 ? Math.round((data.cancelled / data.total) * 100) : 0,
      }));

    return { cohorts };
  }

  // ── LTV Per Business ──────────────────────────────────────────────────────

  async getBusinessLTV(page = 1, limit = 20, sortBy: 'ltv' | 'gmv' | 'name' = 'ltv') {
    const skip = (page - 1) * limit;
    const businesses = await this.prisma.business.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, subscriptionTier: true, subscriptionStatus: true,
        createdAt: true, cancelledAt: true, planName: true,
        _count: { select: { users: true, stores: true } },
      },
    });
    const total = await this.prisma.business.count();

    // For each business compute LTV and GMV
    const results = await Promise.all(businesses.map(async (biz) => {
      const endDate = biz.cancelledAt ?? new Date();
      const monthsActive = Math.max(1, Math.round(
        (endDate.getTime() - biz.createdAt.getTime()) / (30 * 86400000)
      ));
      const monthlyPrice = PLAN_PRICE[biz.subscriptionTier] ?? PLAN_PRICE[biz.planName] ?? 0;
      const ltvCents = monthsActive * monthlyPrice;

      const gmv = await this.prisma.sale.aggregate({
        where: { businessId: biz.id, status: { in: ['PAID', 'AMENDED'] } },
        _sum: { totalCents: true },
      });

      return {
        ...biz,
        monthsActive,
        ltvCents,
        totalGMVCents: gmv._sum.totalCents ?? 0,
      };
    }));

    // Sort
    if (sortBy === 'ltv') results.sort((a, b) => b.ltvCents - a.ltvCents);
    else if (sortBy === 'gmv') results.sort((a, b) => b.totalGMVCents - a.totalGMVCents);
    else results.sort((a, b) => a.name.localeCompare(b.name));

    return { businesses: results, total, page, limit };
  }

  // ── Bulk Subscription Changes ─────────────────────────────────────────────

  async bulkUpdateSubscriptions(businessIds: string[], data: {
    subscriptionStatus?: string;
    subscriptionTier?: string;
    trialDays?: number;
  }) {
    const updateData: any = {};
    if (data.subscriptionStatus) updateData.subscriptionStatus = data.subscriptionStatus;
    // Normalise the tier and derive the label together — a bulk change used to
    // write the tier alone, leaving every business it touched with a label from
    // whatever plan they were on before.
    if (data.subscriptionTier) {
      updateData.subscriptionTier = normalizeTier(data.subscriptionTier);
      updateData.planName         = planDisplayName(data.subscriptionTier);
    }
    if (data.trialDays)          updateData.trialEndsAt        = new Date(Date.now() + data.trialDays * 86400000);
    if (data.subscriptionStatus === 'CANCELLED') updateData.cancelledAt = new Date();

    const result = await this.prisma.business.updateMany({
      where: { id: { in: businessIds } },
      data: updateData,
    });
    return { updated: result.count, businessIds };
  }

  // ── IP Whitelist ──────────────────────────────────────────────────────────

  async getIpWhitelist() {
    return (this.prisma as any).superAdminIpWhitelist.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async addIpToWhitelist(ip: string, label?: string, addedBy?: string) {
    return (this.prisma as any).superAdminIpWhitelist.create({
      data: { id: uuidv4(), ip, label, addedBy },
    });
  }

  async removeIpFromWhitelist(id: string) {
    await (this.prisma as any).superAdminIpWhitelist.delete({ where: { id } });
    return { success: true };
  }

  async isIpAllowed(ip: string): Promise<boolean> {
    const count = await (this.prisma as any).superAdminIpWhitelist.count();
    if (count === 0) return true; // whitelist empty = all IPs allowed
    const entry = await (this.prisma as any).superAdminIpWhitelist.findUnique({ where: { ip } });
    return !!entry;
  }

  // ── Webhook Management ────────────────────────────────────────────────────

  async listAllWebhooks(page = 1, limit = 30) {
    const skip = (page - 1) * limit;
    const [webhooks, total] = await Promise.all([
      this.prisma.webhook.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { business: { select: { id: true, name: true } } },
      }),
      this.prisma.webhook.count(),
    ]);
    return { webhooks, total, page, limit };
  }

  async retryWebhook(webhookId: string) {
    const webhook = await this.prisma.webhook.update({
      where: { id: webhookId },
      data: { failureCount: 0 },
    });
    return { success: true, webhook };
  }

  async toggleWebhook(webhookId: string, isActive: boolean) {
    return this.prisma.webhook.update({ where: { id: webhookId }, data: { isActive } });
  }

  // ── Revenue Export (CSV) ──────────────────────────────────────────────────

  async exportRevenueCsv(): Promise<string> {
    const businesses = await this.prisma.business.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, subscriptionTier: true, subscriptionStatus: true,
        planName: true, createdAt: true, cancelledAt: true, trialEndsAt: true,
        paystackSubscriptionId: true, isComped: true,
      },
    });

    const lines: string[] = [
      'Business ID,Business Name,Plan,Status,Comped,Monthly (KES),Months Active,Est. LTV (KES),Trial Ends,Cancelled At,Paystack Sub ID,Joined'
    ];

    for (const biz of businesses) {
      const endDate = biz.cancelledAt ?? new Date();
      const monthsActive = Math.max(1, Math.round(
        (endDate.getTime() - biz.createdAt.getTime()) / (30 * 86400000)
      ));
      // A gifted account bills nothing, so its monthly and LTV are zero — otherwise
      // the export reads as money collected and the totals are wrong.
      const priceCents = biz.isComped ? 0 : (PLAN_PRICE[biz.subscriptionTier] ?? 0);
      const monthlyPrice = priceCents / 100;
      const ltv = (monthsActive * priceCents) / 100;

      lines.push([
        biz.id,
        `"${biz.name.replace(/"/g, '""')}"`,
        biz.subscriptionTier,
        biz.subscriptionStatus,
        biz.isComped ? 'YES' : 'NO',
        monthlyPrice.toFixed(2),
        monthsActive,
        ltv.toFixed(2),
        biz.trialEndsAt?.toISOString().slice(0, 10) ?? '',
        biz.cancelledAt?.toISOString().slice(0, 10) ?? '',
        biz.paystackSubscriptionId ?? '',
        biz.createdAt.toISOString().slice(0, 10),
      ].join(','));
    }

    return lines.join('\n');
  }

  // ── Real Paystack Revenue ─────────────────────────────────────────────────

  async getPaystackRevenue() {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return { available: false, message: 'PAYSTACK_SECRET_KEY not set in environment' };
    }

    try {
      const [txRes, subRes] = await Promise.all([
        fetch('https://api.paystack.co/transaction?status=success&perPage=100&currency=KES', {
          headers: { Authorization: `Bearer ${secretKey}` },
        }),
        fetch('https://api.paystack.co/subscription?perPage=100', {
          headers: { Authorization: `Bearer ${secretKey}` },
        }),
      ]);

      const txData: any  = txRes.ok  ? await txRes.json()  : { data: [] };
      const subData: any = subRes.ok ? await subRes.json() : { data: [] };

      const transactions: any[] = txData.data ?? [];
      const subscriptions: any[] = subData.data ?? [];

      // Aggregate by month (last 12)
      const byMonth: Record<string, number> = {};
      for (const tx of transactions) {
        const month = new Date(tx.paid_at ?? tx.created_at).toISOString().slice(0, 7);
        byMonth[month] = (byMonth[month] ?? 0) + (tx.amount ?? 0);
      }

      const totalCollectedCents = transactions.reduce((s: number, t: any) => s + (t.amount ?? 0), 0);
      const activeSubCount = subscriptions.filter((s: any) => s.status === 'active').length;

      return {
        available: true,
        totalCollectedCents, // KES cents (Paystack KES amounts are in cents)
        totalTransactions: transactions.length,
        activeSubscriptions: activeSubCount,
        monthlyBreakdown: Object.entries(byMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-12)
          .map(([month, amount]) => ({ month, amountCents: amount })),
        rawSubscriptions: subscriptions.slice(0, 20),
      };
    } catch (err) {
      this.logger.error('Paystack revenue fetch failed', err);
      return { available: false, message: 'Failed to fetch Paystack data', error: String(err) };
    }
  }

  // ── Update subscription with cancel reason ────────────────────────────────

  async cancelBusinessSubscription(businessId: string, reason: string) {
    return this.prisma.business.update({
      where: { id: businessId },
      data: {
        subscriptionStatus: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });
  }
}
