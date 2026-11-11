import { EtimsOscuService } from '../etims/oscu/etims-oscu.service';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionLimitsService } from '../subscription/subscription-limits.service';
import { LedgerService } from '../ledger/ledger.service';
import { postVerticalOpeningBalances } from '../sales/opening-balances';
import * as bcrypt from 'bcrypt';
import { assertPinAvailable } from '../auth/pin.util';
import { assertCanManageUser } from '../auth/access-policy';
import { createCipheriv, randomBytes } from 'crypto';
import { UserRole, parseEnabledModules } from '@pos/shared';

import { requireString } from '../common/validate';
import { validateLevies } from '../common/hotel-levies';

interface UpdateBusinessDto {
  name?: string;
  taxType?: 'VAT' | 'TOT' | 'NONE';
  totRate?: number;
  serviceChargeRate?: number;
  serviceChargeDefault?: boolean;
  negativePolicyDefault?: 'BLOCK' | 'WARN' | 'ALLOW';
  posMode?: string;
  /** Optional modules switched on next to the main till, e.g. ["RESTAURANT"]. */
  enabledModules?: string[] | string;
  expiredItemPolicy?: string;
  expenseApprovalThresholdCents?: number;
  expiryAlertDays?: number;
  exchangeRates?: string;    // JSON: { USD: 130.5, EUR: 141.2 }
  displayCurrencies?: string; // JSON: ["USD","EUR"]
  paystackPublicKey?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  bankBranch?: string;
  idleMessage?: string;
  idleLogoUrl?: string;
  tablePrefix?: string;
  receiptHeader?: string;
  receiptFooter?: string;
  enableCashDrawer?: boolean;
  enableBarcodeScanner?: boolean;
  enablePoleDisplay?: boolean;
  /** Owner only: on = fuel, hotel, pharmacy and cyber takings become real sales from now. */
  verticalSalesEnabled?: boolean;
  /** Levies a hotel adds to a stay: [{ name, ratePct, base: "ROOM" | "ALL" }], as a list or JSON. Empty = none. */
  hotelLevies?: unknown;
}

interface CreateStoreDto {
  name: string;
  storeCode: string;
}

interface CreateUserDto {
  name: string;
  email?: string;
  phone?: string;
  role: UserRole;
  pin?: string;
  deliveryRateCents?: number;
  deliveryCommissionPercent?: number;
  password?: string;
}

interface UpdateUserDto {
  name?: string;
  phone?: string;
  role?: UserRole;
  pin?: string;
  deliveryRateCents?: number;
  deliveryCommissionPercent?: number;
  password?: string;
}

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    private prisma: PrismaService,
    private subscriptionLimits: SubscriptionLimitsService,
    private ledger: LedgerService,
  ) {}

  private encrypt(data: object): string {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '0'.repeat(64), 'hex');
    const iv = randomBytes(16);
    const cipher = createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(data)),
      cipher.final(),
    ]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  async getSettings(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: {
        stores: { where: { id: { not: undefined } } },
        users: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    if (!business) throw new NotFoundException('Business not found');

    // Strip encrypted secrets from response
    const { etimsCredentialsEncrypted, mpesaCredentialsEncrypted, atCredentialsEncrypted, ...safe } = business;
    return {
      ...safe,
      subscriptionTier: business.subscriptionTier ?? 'FREE',
      hasEtimsCredentials: !!etimsCredentialsEncrypted,
      hasMpesaCredentials: !!mpesaCredentialsEncrypted,
      hasAtCredentials: !!atCredentialsEncrypted,
      // Whether fuel, hotel, pharmacy, cyber and appointment takings are becoming real sales yet, and since when.
      verticalSalesEnabled: !!business.verticalSalesFrom && business.verticalSalesFrom.getTime() <= Date.now(),
    };
  }

  /**
   * Fields a client is allowed to change through the settings endpoint.
   *
   * Mirrors UpdateBusinessDto. Deliberately excludes anything the customer must
   * not set for themselves — id, subscriptionTier, planName, isComped, the
   * encrypted credential columns — so a stray or hostile key cannot reach the
   * update.
   */
  private static readonly SETTINGS_FIELDS = [
    'name', 'taxType', 'totRate', 'serviceChargeRate', 'serviceChargeDefault',
    'negativePolicyDefault', 'posMode', 'expiredItemPolicy',
    'expenseApprovalThresholdCents', 'expiryAlertDays',
    'exchangeRates', 'displayCurrencies', 'paystackPublicKey',
    'bankName', 'bankAccountNumber', 'bankAccountName', 'bankBranch',
    'idleMessage', 'idleLogoUrl', 'tablePrefix',
    'receiptHeader', 'receiptFooter',
    'receiptFormatSale', 'receiptFormatInvoice', 'receiptFormatDelivery', 'receiptFormatEmail',
    'enableCashDrawer', 'enableBarcodeScanner', 'enablePoleDisplay',
  ] as const;

  async updateSettings(businessId: string, dto: UpdateBusinessDto, actorRole?: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) throw new NotFoundException('Business not found');

    // Pick only known columns rather than spreading the request body.
    //
    // The body used to go to Prisma verbatim, and the controller's type declares
    // an index signature, so any extra key travelled with it. The setup wizard
    // reads settings, keeps the response in form state and posts it back, which
    // included `businessId` — not a column on Business — and Prisma rejected the
    // whole update with an "Unknown argument" wall of text in the user's face.
    // There is no ValidationPipe on this API, so nothing upstream strips it.
    const data: Record<string, unknown> = {};
    for (const key of BusinessService.SETTINGS_FIELDS) {
      if (dto[key as keyof UpdateBusinessDto] !== undefined) {
        data[key] = dto[key as keyof UpdateBusinessDto];
      }
    }

    // Stored as a JSON list; anything that is not a known module is dropped.
    if (dto.enabledModules !== undefined) {
      data.enabledModules = JSON.stringify(parseEnabledModules(dto.enabledModules));
    }

    // Checked strictly here, so a bad rate can never reach a guest's bill.
    if (dto.hotelLevies !== undefined) {
      data.hotelLevies = JSON.stringify(validateLevies(dto.hotelLevies));
    }

    // Switching the sales pipeline on or off changes what the books and KRA are told, so only an owner may.
    // Turning it on stamps the moment; no earlier takings are back-filled. Turning it off clears it, and from then
    // on those takings are recorded as before. Asking for the state it is already in changes nothing.
    if (dto.verticalSalesEnabled !== undefined) {
      if (!['OWNER', 'ADMIN'].includes(String(actorRole))) {
        throw new ForbiddenException('Only the owner can change how fuel, hotel, pharmacy and cyber takings are recorded');
      }
      const isOn = !!business.verticalSalesFrom;
      if (dto.verticalSalesEnabled && !isOn) data.verticalSalesFrom = new Date();
      if (!dto.verticalSalesEnabled && isOn) data.verticalSalesFrom = null;
    }

    if (Object.keys(data).length === 0) return business;

    const updated = await this.prisma.business.update({ where: { id: businessId }, data });
    // Switching on: bring in what was already owed (deposits held, fleet balances), so the books do not start at zero.
    if (data.verticalSalesFrom) {
      await postVerticalOpeningBalances(this.prisma, this.ledger, businessId).catch((e: unknown) => this.logger.warn(`Opening balances for ${businessId} failed: ${String(e)}`));
    }
    return updated;
  }

  async getStores(businessId: string) {
    return this.prisma.store.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
    });
  }

  async createStore(businessId: string, dto: CreateStoreDto) {
    const check = await this.subscriptionLimits.canCreateStore(businessId);
    if (!check.allowed) {
      throw new ForbiddenException(check.message);
    }

    requireString(dto?.name, 'name');
    requireString(dto?.storeCode, 'storeCode');
    return this.prisma.store.create({
      data: {
        businessId,
        name: dto.name,
        storeCode: dto.storeCode.toUpperCase(),
      },
    });
  }

  // ─── User Management ─────────────────────────────────────────────────────────

  async getUsers(businessId: string) {
    return this.prisma.user.findMany({
      where: { businessId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        phone: true,
        // Needed so the staff form can show a driver's existing pay rate.
        deliveryRateCents: true,
        deliveryCommissionPercent: true,
        assignedStores: {
          select: { storeId: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  // ─── User-Store Assignment ────────────────────────────────────────────────────

  async assignUserToStore(businessId: string, userId: string, storeId: string) {
    // Verify both user and store belong to this business
    const [user, store] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: userId, businessId } }),
      this.prisma.store.findFirst({ where: { id: storeId, businessId } }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!store) throw new NotFoundException('Store not found');

    await this.prisma.userStore.upsert({
      where: { userId_storeId: { userId, storeId } },
      create: { userId, storeId, businessId },
      update: {},
    });
    return { message: 'Store assigned' };
  }

  async removeUserFromStore(businessId: string, userId: string, storeId: string) {
    await this.prisma.userStore.deleteMany({
      where: { userId, storeId, businessId },
    });
    return { message: 'Store assignment removed' };
  }

  async createUser(businessId: string, dto: CreateUserDto, actorRole: string) {
    assertCanManageUser(actorRole, undefined, dto.role);
    const check = await this.subscriptionLimits.canCreateUser(businessId);
    if (!check.allowed) {
      throw new ForbiddenException(check.message);
    }

    if (dto.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing) throw new ConflictException('Email already in use');
    }

    if (dto.pin) await assertPinAvailable(this.prisma, businessId, dto.pin);
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 12) : null;
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : null;

    const user = await this.prisma.user.create({
      data: {
        businessId,
        name: dto.name,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        role: dto.role,
        passwordHash,
        pinHash,
        deliveryRateCents: dto.deliveryRateCents ?? null,
        deliveryCommissionPercent: dto.deliveryCommissionPercent ?? null,
      },
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
    });

    return user;
  }

  async updateUser(
    businessId: string,
    userId: string,
    dto: UpdateUserDto,
    actor: { id: string; role: string },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, businessId },
    });
    if (!user) throw new NotFoundException('User not found');
    assertCanManageUser(actor.role, user.role, dto.role);
    // Nobody edits their own role: it is how a manager would promote themselves.
    if (dto.role !== undefined && dto.role !== user.role && actor.id === userId) {
      throw new ForbiddenException('You cannot change your own role');
    }

    if (dto.pin) await assertPinAvailable(this.prisma, businessId, dto.pin, userId);
    const passwordHash =
      dto.password !== undefined
        ? dto.password
          ? await bcrypt.hash(dto.password, 12)
          : null
        : undefined;
    const pinHash =
      dto.pin !== undefined
        ? dto.pin
          ? await bcrypt.hash(dto.pin, 10)
          : null
        : undefined;

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone || null }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(passwordHash !== undefined && { passwordHash }),
        ...(pinHash !== undefined && { pinHash }),
        ...(dto.deliveryRateCents !== undefined && {
          deliveryRateCents: dto.deliveryRateCents || null,
        }),
        ...(dto.deliveryCommissionPercent !== undefined && {
          deliveryCommissionPercent: dto.deliveryCommissionPercent || null,
        }),
      },
      select: {
        id: true, name: true, email: true, phone: true, role: true, createdAt: true,
        deliveryRateCents: true, deliveryCommissionPercent: true,
      },
    });
  }

  async deleteUser(businessId: string, userId: string, actorRole: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, businessId },
    });
    if (!user) throw new NotFoundException('User not found');
    assertCanManageUser(actorRole, user.role, undefined);
    if (user.role === UserRole.OWNER) throw new BadRequestException('Cannot delete the owner');

    await this.prisma.user.delete({ where: { id: userId } });
    return { message: 'User deleted' };
  }

  // ─── Credential Management ────────────────────────────────────────────────────

  /**
   * Connect the business to KRA eTIMS: initialise the OSCU device KRA approved and keep the communication key it
   * returns. Saving the PIN, branch and serial alone is not enough; KRA refuses every call without that key.
   */
  async saveEtimsCredentials(
    businessId: string,
    creds: { bhfId: string; tin: string; dvcSrno: string },
  ) {
    try {
      const connected = await new EtimsOscuService(this.prisma).connect(businessId, { tin: creds.tin, bhfId: creds.bhfId, dvcSrlNo: creds.dvcSrno });
      return { message: `Connected to KRA eTIMS as ${connected.tradeNm ?? connected.tin}` };
    } catch (e) {
      throw new BadRequestException(`KRA eTIMS: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async saveMpesaCredentials(
    businessId: string,
    creds: {
      consumerKey: string;
      consumerSecret: string;
      shortcode: string;
      passkey: string;
      callbackUrl: string;
    },
  ) {
    const encrypted = this.encrypt(creds);
    await this.prisma.business.update({
      where: { id: businessId },
      data: { mpesaCredentialsEncrypted: encrypted },
    });
    return { message: 'M-Pesa credentials saved' };
  }

  async saveAtCredentials(
    businessId: string,
    creds: { apiKey: string; username: string; senderId?: string },
  ) {
    const encrypted = this.encrypt(creds);
    await this.prisma.business.update({
      where: { id: businessId },
      data: { atCredentialsEncrypted: encrypted },
    });
    return { message: 'Africa\'s Talking credentials saved' };
  }

  // ─── Exchange Rates ───────────────────────────────────────────────────────────

  async getExchangeRates(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { exchangeRates: true, displayCurrencies: true },
    });
    if (!business) throw new NotFoundException('Business not found');
    return {
      rates: business.exchangeRates ? JSON.parse(business.exchangeRates) : {},
      displayCurrencies: business.displayCurrencies
        ? JSON.parse(business.displayCurrencies)
        : [],
    };
  }

  /** Fetch live rates from open.er-api.com (KES base) and persist. */
  async refreshExchangeRates(businessId: string, currencies: string[]) {
    const resp = await fetch('https://open.er-api.com/v6/latest/KES');
    if (!resp.ok) throw new BadRequestException('Failed to fetch exchange rates');
    const data = (await resp.json()) as { result: string; rates: Record<string, number> };
    if (data.result !== 'success') throw new BadRequestException('Exchange rate API error');

    // open.er-api with base=KES: rates.USD = 0.00773 → invert → 1 USD = 129.4 KES
    const kesPerCurrency: Record<string, number> = {};
    for (const code of currencies) {
      const raw = data.rates[code];
      if (raw) kesPerCurrency[code] = Math.round((1 / raw) * 100) / 100;
    }

    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        exchangeRates: JSON.stringify(kesPerCurrency),
        displayCurrencies: JSON.stringify(currencies),
      },
    });
    return { rates: kesPerCurrency, displayCurrencies: currencies, refreshedAt: new Date() };
  }

  async updateExchangeRates(
    businessId: string,
    dto: { rates?: Record<string, number>; displayCurrencies?: string[] },
  ) {
    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        ...(dto.rates !== undefined && { exchangeRates: JSON.stringify(dto.rates) }),
        ...(dto.displayCurrencies !== undefined && {
          displayCurrencies: JSON.stringify(dto.displayCurrencies),
        }),
      },
    });
    return { message: 'Exchange rates updated' };
  }

  // ─── Subscription ─────────────────────────────────────────────────────────────

  async cancelSubscription(businessId: string, reason: string) {
    const valid = ['PRICE', 'COMPETITOR', 'MISSING_FEATURE', 'POOR_SUPPORT', 'OTHER'];
    const cancelReason = valid.includes(reason) ? reason : 'OTHER';
    return this.prisma.business.update({
      where: { id: businessId },
      data: {
        subscriptionStatus: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason,
      },
      select: { id: true, subscriptionStatus: true, cancelReason: true, cancelledAt: true },
    });
  }

  async getSubscriptionStatus(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: {
        subscriptionTier: true,
        subscriptionStatus: true,
        trialEndsAt: true,
      },
    });

    if (!business) throw new NotFoundException('Business not found');

    const isTrialExpired =
      business.subscriptionStatus === 'TRIAL' &&
      business.trialEndsAt &&
      new Date() > business.trialEndsAt;

    return {
      ...business,
      isTrialExpired,
      daysRemaining: business.trialEndsAt
        ? Math.max(
            0,
            Math.ceil(
              (business.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            ),
          )
        : null,
    };
  }

  // ── Pole Display Config (public) ──────────────────────────────────────────────

  async getPoleConfig(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, idleMessage: true, idleLogoUrl: true },
    });
    return business ?? { name: 'Faida POS', idleMessage: 'Welcome!', idleLogoUrl: null };
  }

  /** Resolve a shortCode (e.g. PREMIE01) or seed-style id (e.g. biz-001) to the real UUID + name */
  async resolveByCode(code: string) {
    const business = await this.prisma.business.findFirst({
      where: {
        OR: [
          { shortCode: code.toUpperCase() },
          { id: code }, // allow seed-style IDs like "biz-001"
        ],
      },
      select: { id: true, name: true, shortCode: true },
    });
    if (!business) return null;
    return business;
  }

  /** Public staff picker — returns only id/name/role for users who have a PIN set */
  async getStaffList(businessId: string) {
    return this.prisma.user.findMany({
      where: { businessId, pinHash: { not: null } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
  }
}
