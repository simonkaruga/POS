import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import * as bcrypt from 'bcrypt';
import { usersWithPin } from './pin.util';
import * as speakeasy from 'speakeasy';
import { UserRole } from '@pos/shared';
import { appUrl } from '../common/app-urls';

export interface JwtPayload {
  sub: string;       // userId
  businessId: string;
  role: UserRole;
  storeId?: string;
  assignedStoreIds?: string[]; // for MANAGER: stores they are scoped to
  planName?: string;
  /** The field the API gates on. planName is a display label and drifts from it. */
  subscriptionTier?: string;
  /** Status + trial end travel with the tier: access during a trial depends on
   *  all three, and the client must reach the same verdict as SubscriptionGuard. */
  subscriptionStatus?: string;
  trialEndsAt?: Date | string | null;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  role: UserRole;
  businessId: string;
  storeId?: string;
  assignedStoreIds?: string[]; // populated for MANAGER role
  planName?: string;
  /** The field the API gates on. planName is a display label and drifts from it. */
  subscriptionTier?: string;
  /** Status + trial end travel with the tier: access during a trial depends on
   *  all three, and the client must reach the same verdict as SubscriptionGuard. */
  subscriptionStatus?: string;
  trialEndsAt?: Date | string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private email: EmailService,
    private affiliate: AffiliateService,
  ) {}

  // ─── Password complexity validation ─────────────────────────
  private validatePasswordComplexity(password: string): void {
    if (typeof password !== 'string' || password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }
    if (!/[A-Z]/.test(password)) {
      throw new BadRequestException('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      throw new BadRequestException('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      throw new BadRequestException('Password must contain at least one number');
    }
  }

  // ─── PIN login rate limiting (in-memory, per businessId) ────
  private static readonly MAX_PIN_ATTEMPTS = 5;
  private static readonly PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
  private readonly pinAttempts = new Map<string, { count: number; lockedUntil: number }>();

  private checkPinRateLimit(businessId: string) {
    const now = Date.now();
    const entry = this.pinAttempts.get(businessId);
    if (entry && entry.lockedUntil > now) {
      const minsLeft = Math.ceil((entry.lockedUntil - now) / 60000);
      throw new UnauthorizedException(`Too many failed PIN attempts. Try again in ${minsLeft} minute(s).`);
    }
  }

  private recordPinFailure(businessId: string) {
    const now = Date.now();
    const entry = this.pinAttempts.get(businessId) ?? { count: 0, lockedUntil: 0 };
    const newCount = entry.count + 1;
    const lockedUntil = newCount >= AuthService.MAX_PIN_ATTEMPTS
      ? now + AuthService.PIN_LOCKOUT_MS
      : entry.lockedUntil;
    this.pinAttempts.set(businessId, { count: newCount, lockedUntil });
  }

  private clearPinFailures(businessId: string) {
    this.pinAttempts.delete(businessId);
  }

  // ─── Email + Password login ──────────────────────────────────
  private static readonly MAX_LOGIN_ATTEMPTS = 5;
  private static readonly LOCKOUT_MINUTES = 15;

  async loginWithPassword(
    email: string,
    password: string,
    totpCode?: string,
  ): Promise<{ accessToken: string; user: AuthUser }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        business: true,
        assignedStores: { select: { storeId: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // ── Lockout check ──────────────────────────────────────────
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(
        `Account locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`,
      );
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash ?? '');
    if (!passwordMatch) {
      const newAttempts = (user.loginAttempts ?? 0) + 1;
      const shouldLock = newAttempts >= AuthService.MAX_LOGIN_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          loginAttempts: newAttempts,
          lockedUntil: shouldLock
            ? new Date(Date.now() + AuthService.LOCKOUT_MINUTES * 60 * 1000)
            : null,
        },
      });
      if (shouldLock) {
        throw new UnauthorizedException(
          `Too many failed attempts. Account locked for ${AuthService.LOCKOUT_MINUTES} minutes.`,
        );
      }
      throw new UnauthorizedException(
        `Invalid credentials. ${AuthService.MAX_LOGIN_ATTEMPTS - newAttempts} attempt(s) remaining before lockout.`,
      );
    }

    // ── Reset attempts on successful password match ─────────────
    if ((user.loginAttempts ?? 0) > 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { loginAttempts: 0, lockedUntil: null },
      });
    }

    // Owner/Admin: TOTP mandatory
    if (
      (user.role === UserRole.OWNER || user.role === UserRole.MANAGER) &&
      user.totpSecret
    ) {
      if (!totpCode) {
        throw new UnauthorizedException('TOTP code required');
      }
      const valid = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: totpCode,
        window: 1,
      });
      if (!valid) throw new UnauthorizedException('Invalid TOTP code');
    }

    const assignedStoreIds =
      user.role === UserRole.MANAGER && user.assignedStores.length > 0
        ? user.assignedStores.map((s) => s.storeId)
        : undefined;

    const payload: JwtPayload = {
      sub: user.id,
      businessId: user.businessId,
      role: user.role as UserRole,
      planName: user.business.planName,
      // Ship the tier too. The UI used to gate on planName, a display label the
      // admin console could change independently of the tier — so a business moved
      // to ENTERPRISE kept its old planName and stayed locked out of what it paid for.
      subscriptionTier: user.business.subscriptionTier,
      subscriptionStatus: user.business.subscriptionStatus,
      trialEndsAt: user.business.trialEndsAt,
      ...(assignedStoreIds && { assignedStoreIds }),
    };

    const accessToken = this.jwt.sign(payload, { expiresIn: '15m' });

    // Track session (fire-and-forget — non-critical)
    const tokenHash = require('crypto').createHash('sha256').update(accessToken).digest('hex');
    this.prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    }).catch(() => {});

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
        businessId: user.businessId,
        planName: user.business.planName,
        subscriptionTier: user.business.subscriptionTier,
        subscriptionStatus: user.business.subscriptionStatus,
        trialEndsAt: user.business.trialEndsAt,
        ...(assignedStoreIds && { assignedStoreIds }),
      },
    };
  }

  // ─── PIN login (Cashier / Waiter / Kitchen) ──────────────────
  async loginWithPin(
    pin: string,
    businessIdOrCode: string,
    storeId?: string,
    userId?: string,
  ): Promise<{ accessToken: string; user: AuthUser }> {
    if (typeof pin !== 'string' || !pin || typeof businessIdOrCode !== 'string' || !businessIdOrCode) {
      throw new BadRequestException('pin and businessId are required');
    }
    // Resolve shortCode → real businessId if the input doesn't look like a UUID
    let businessId = businessIdOrCode;
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessIdOrCode);
    if (!looksLikeUuid) {
      const biz = await this.prisma.business.findFirst({
        where: {
          OR: [
            { shortCode: businessIdOrCode.toUpperCase() },
            { id: businessIdOrCode }, // e.g. "biz-001" seed ID
          ],
        },
        select: { id: true },
      });
      if (!biz) throw new UnauthorizedException('Business code not found');
      businessId = biz.id;
    }

    this.checkPinRateLimit(businessId);

    // If userId provided, only check that specific user's PIN
    const users = userId
      ? await this.prisma.user.findMany({ where: { id: userId, businessId, pinHash: { not: null } } })
      : await this.prisma.user.findMany({ where: { businessId, pinHash: { not: null } } });

    const matches = await usersWithPin(users, pin);

    // Two people with the same PIN and no name to tell them apart: signing in as
    // whichever came first would put one person's actions on the other's account.
    // Ask for the name instead (the staff picker passes userId).
    if (matches.length > 1) {
      throw new BadRequestException('More than one person has this PIN. Choose your name first, then enter your PIN.');
    }
    const matchedUser = matches[0];

    if (!matchedUser) {
      this.recordPinFailure(businessId);
      throw new UnauthorizedException('Invalid PIN');
    }

    this.clearPinFailures(businessId);

    const biz = await this.prisma.business.findUnique({
      where: { id: matchedUser.businessId },
      select: {
        planName: true, subscriptionTier: true,
        subscriptionStatus: true, trialEndsAt: true,
      },
    });
    const pinPlanName = biz?.planName ?? 'STARTER';
    const pinTier = biz?.subscriptionTier ?? 'FREE';

    const payload: JwtPayload = {
      sub: matchedUser.id,
      businessId: matchedUser.businessId,
      role: matchedUser.role as UserRole,
      storeId,
      planName: pinPlanName,
      subscriptionTier: pinTier,
      subscriptionStatus: biz?.subscriptionStatus,
      trialEndsAt: biz?.trialEndsAt ?? null,
    };

    const accessToken = this.jwt.sign(payload, { expiresIn: '12h' });

    return {
      accessToken,
      user: {
        id: matchedUser.id,
        name: matchedUser.name,
        email: matchedUser.email,
        role: matchedUser.role as UserRole,
        businessId: matchedUser.businessId,
        storeId,
        planName: pinPlanName,
        subscriptionTier: pinTier,
        subscriptionStatus: biz?.subscriptionStatus,
        trialEndsAt: biz?.trialEndsAt ?? null,
      },
    };
  }

  // ─── Refresh token ───────────────────────────────────────────
  async refreshToken(
    userId: string,
  ): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { assignedStores: { select: { storeId: true } } },
    });

    const assignedStoreIds =
      user.role === UserRole.MANAGER && user.assignedStores.length > 0
        ? user.assignedStores.map((s) => s.storeId)
        : undefined;

    const payload: JwtPayload = {
      sub: user.id,
      businessId: user.businessId,
      role: user.role as UserRole,
      ...(assignedStoreIds && { assignedStoreIds }),
    };

    return { accessToken: this.jwt.sign(payload, { expiresIn: '15m' }) };
  }

  // ─── TOTP setup ──────────────────────────────────────────────
  async setupTotp(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = speakeasy.generateSecret({ name: `Faida POS (${user.email ?? user.name})` });

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret.base32 },
    });

    return { secret: secret.base32, otpauthUrl: secret.otpauth_url ?? '' };
  }

  // ─── Register owner ──────────────────────────────────────────
  // ─── Short code generation ───────────────────────────────────
  private async generateUniqueShortCode(businessName: string): Promise<string> {
    const alpha = businessName
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
      .slice(0, 6)
      .padEnd(6, 'X');
    for (let attempt = 0; attempt < 20; attempt++) {
      const digits = String(Math.floor(Math.random() * 90) + 10); // 10-99
      const code = `${alpha}${digits}`;
      const existing = await this.prisma.business.findUnique({ where: { shortCode: code } });
      if (!existing) return code;
    }
    // Fallback: append 4 random digits
    return `${alpha}${String(Math.floor(Math.random() * 9000) + 1000)}`;
  }

  async registerOwner(data: {
    name: string;
    email: string;
    password: string;
    businessName: string;
    affiliateCode?: string;
  }): Promise<{ accessToken: string; user: AuthUser }> {
    for (const field of ['name', 'email', 'password', 'businessName'] as const) {
      if (typeof data[field] !== 'string' || !data[field].trim()) {
        throw new BadRequestException(`${field} is required`);
      }
    }

    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new BadRequestException('Email already registered');

    this.validatePasswordComplexity(data.password);

    const passwordHash = await bcrypt.hash(data.password, 12);
    const shortCode = await this.generateUniqueShortCode(data.businessName);

    const result = await this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: data.businessName,
          shortCode,
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day trial
          // A new business has no history of ringing these takings through the till, so there is nothing to double
          // count: its fuel, hotel, pharmacy and cyber takings are real sales from the first day.
          verticalSalesFrom: new Date(),
        },
      });

      const store = await tx.store.create({
        data: {
          businessId: business.id,
          name: `${data.businessName} - Main`,
          storeCode: `${shortCode}-01`,
        },
      });

      const user = await tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          passwordHash,
          role: UserRole.OWNER,
          businessId: business.id,
        },
      });

      return { business, store, user };
    });

    // Attribute the signup to an affiliate if a valid, active code was supplied.
    if (data.affiliateCode) {
      await this.affiliate.attributeSignup(data.affiliateCode, result.business.id).catch(() => {});
    }

    const payload: JwtPayload = {
      sub: result.user.id,
      businessId: result.user.businessId,
      role: UserRole.OWNER,
      planName: 'STARTER',
    };

    return {
      accessToken: this.jwt.sign(payload, { expiresIn: '15m' }),
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: UserRole.OWNER,
        businessId: result.user.businessId,
        planName: 'STARTER',
      },
    };
  }

  // ─── Google OAuth ────────────────────────────────────────────
  async registerWithGoogle(profile: {
    googleId: string;
    email: string | null;
    name: string;
    avatarUrl: string | null;
    businessName: string;
  }): Promise<{ accessToken: string; user: AuthUser }> {
    if (!profile.email) throw new BadRequestException('Google account has no email address');

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ googleId: profile.googleId }, { email: profile.email }] },
    });
    if (existing) throw new BadRequestException('An account with this Google identity already exists. Please sign in instead.');

    const shortCode = await this.generateUniqueShortCode(profile.businessName);

    const result = await this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: profile.businessName,
          shortCode,
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          verticalSalesFrom: new Date(),
        },
      });
      await tx.store.create({
        data: {
          businessId: business.id,
          name: `${profile.businessName} - Main`,
          storeCode: `${shortCode}-01`,
        },
      });
      const user = await tx.user.create({
        data: {
          name: profile.name,
          email: profile.email,
          googleId: profile.googleId,
          avatarUrl: profile.avatarUrl,
          role: UserRole.OWNER,
          businessId: business.id,
        },
      });
      return { business, user };
    });

    const payload: JwtPayload = {
      sub: result.user.id,
      businessId: result.user.businessId,
      role: UserRole.OWNER,
      planName: 'STARTER',
    };

    return {
      accessToken: this.jwt.sign(payload, { expiresIn: '15m' }),
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: UserRole.OWNER,
        businessId: result.user.businessId,
        planName: 'STARTER',
      },
    };
  }

  async loginWithGoogle(profile: {
    googleId: string;
    email: string | null;
    name: string;
    avatarUrl: string | null;
  }): Promise<{ accessToken: string; user: AuthUser }> {
    // Find existing user by googleId or email
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { googleId: profile.googleId },
          ...(profile.email ? [{ email: profile.email }] : []),
        ],
      },
      include: { assignedStores: { select: { storeId: true } } },
    });

    if (user) {
      // Link googleId if signing in via email account for the first time with Google
      if (!user.googleId) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { googleId: profile.googleId, avatarUrl: profile.avatarUrl },
          include: { assignedStores: { select: { storeId: true } } },
        });
      }
    } else {
      throw new UnauthorizedException(
        'No account linked to this Google identity. Please register or ask your admin to add your email.',
      );
    }

    const assignedStoreIds =
      user.role === UserRole.MANAGER && user.assignedStores.length > 0
        ? user.assignedStores.map((s) => s.storeId)
        : undefined;

    const googleBiz = await this.prisma.business.findUnique({
      where: { id: user.businessId },
      select: { planName: true },
    });
    const googlePlanName = googleBiz?.planName ?? 'STARTER';

    const jwtPayload: JwtPayload = {
      sub: user.id,
      businessId: user.businessId,
      role: user.role as UserRole,
      planName: googlePlanName,
      ...(assignedStoreIds && { assignedStoreIds }),
    };

    return {
      accessToken: this.jwt.sign(jwtPayload, { expiresIn: '15m' }),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
        businessId: user.businessId,
        planName: googlePlanName,
        ...(assignedStoreIds && { assignedStoreIds }),
      },
    };
  }

  async validateUser(payload: JwtPayload): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        business: {
          select: {
            planName: true, subscriptionTier: true,
            subscriptionStatus: true, trialEndsAt: true,
          },
        },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as UserRole,
      businessId: user.businessId,
      // Read the plan from the business on every request, not from the token.
      //
      // This object is what /auth/me returns and what the web app stores, and it
      // used to carry planName ALONE. planName is a display label that drifts —
      // an account gifted ENTERPRISE from the admin console keeps planName "Free"
      // — so the browser fell back to it, resolved FREE, and greyed out every
      // paid feature for a customer the API was happily authorising. Gating on
      // subscriptionTier here keeps the client's view and the SubscriptionGuard's
      // decision in agreement.
      //
      // Reading it live also means a plan change or a gift takes effect on the
      // next request instead of waiting for every user's token to expire.
      planName: user.business?.planName ?? payload.planName,
      subscriptionTier: user.business?.subscriptionTier ?? payload.subscriptionTier,
      subscriptionStatus: user.business?.subscriptionStatus ?? payload.subscriptionStatus,
      trialEndsAt: user.business?.trialEndsAt ?? payload.trialEndsAt ?? null,
    };
  }

  // ─── Verify Manager PIN (for voids) ──────────────────────────
  async verifyManagerPin(
    pin: string,
    businessId: string,
  ): Promise<{ userId: string; name: string }> {
    if (typeof pin !== 'string' || !pin || !businessId) {
      throw new BadRequestException('pin and businessId are required');
    }
    const users = await this.prisma.user.findMany({
      where: {
        businessId,
        role: { in: [UserRole.OWNER, UserRole.MANAGER] },
        pinHash: { not: null },
      },
    });

    const matches = await usersWithPin(users, pin);
    // An override is recorded against the manager who gave it, so it must be one person.
    if (matches.length > 1) {
      throw new BadRequestException('Two managers share this PIN, so the override cannot be attributed. Ask the owner to give each manager their own PIN.');
    }
    if (matches[0]) return { userId: matches[0].id, name: matches[0].name };

    throw new BadRequestException('Invalid manager PIN. Check the PIN and try again.');
  }

  // ─── Change password ─────────────────────────────────────────
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new Error('User not found');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new Error('Current password is incorrect');

    this.validatePasswordComplexity(newPassword);

    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    return { success: true };
  }

  // ─── Session management ──────────────────────────────────────
  async getSessions(userId: string) {
    return this.prisma.userSession.findMany({
      where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revokeSession(sessionId: string, userId: string) {
    const session = await this.prisma.userSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException('Session not found');
    await this.prisma.userSession.update({ where: { id: sessionId }, data: { isRevoked: true } });
    return { success: true };
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.userSession.updateMany({ where: { userId }, data: { isRevoked: true } });
    return { success: true };
  }

  // ─── Forgot / Reset password ─────────────────────────────────

  async forgotPassword(email: string): Promise<{ sent: boolean; resetUrl?: string }> {
    const user = await this.prisma.user.findFirst({ where: { email } });
    // Always return same response to avoid email enumeration
    if (!user || !user.email) return { sent: true };

    // Short-lived JWT (15 min) as the reset token — no DB storage needed
    const token = this.jwt.sign(
      { sub: user.id, type: 'password-reset' },
      { expiresIn: '15m' },
    );

    const resetUrl = `${appUrl()}/reset-password?token=${token}`;

    // Send reset email (fire-and-forget — never reveal if email exists)
    void this.email.sendPasswordReset({ to: user.email, name: user.name, resetUrl });

    // Only expose resetUrl in non-production so developers can test without SMTP
    const isDev = (process.env.NODE_ENV ?? 'development') !== 'production';
    return { sent: true, ...(isDev ? { resetUrl } : {}) };
  }

  async resetPasswordWithToken(token: string, newPassword: string): Promise<{ success: boolean }> {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwt.verify(token) as { sub: string; type: string };
    } catch {
      throw new BadRequestException('Invalid or expired reset link. Please request a new one.');
    }

    if (payload.type !== 'password-reset') {
      throw new BadRequestException('Invalid reset token.');
    }

    this.validatePasswordComplexity(newPassword);
    const hash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: payload.sub },
      data: { passwordHash: hash, loginAttempts: 0, lockedUntil: null },
    });

    return { success: true };
  }
}
