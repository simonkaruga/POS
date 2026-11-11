import { Injectable, BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@pos/shared';
import { RelyingParty } from './webauthn-origin';
import type { AuthUser } from './auth.service';

interface JwtPayload {
  sub: string;
  businessId: string;
  role: UserRole;
  storeId?: string | null;
  name?: string;
}

interface ChallengeEntry {
  challenge: string; // base64url
  expiresAt: number;
  rp: RelyingParty;
}

@Injectable()
export class WebAuthnService {
  // In-memory challenge store (keyed by userId for registration, credentialId for auth)
  private readonly challenges = new Map<string, ChallengeEntry>();

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {
    // Purge stale challenges every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.challenges.entries()) {
        if (entry.expiresAt < now) this.challenges.delete(key);
      }
    }, 5 * 60_000);
  }

  private generateChallenge(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * These routes used to trust whatever userId the caller sent, so any signed-in cashier could enrol their own
   * fingerprint on the owner's account and then log in as the owner. A caller may manage their own credentials;
   * only an owner or manager may manage a colleague's, and only within their own business.
   */
  async assertCanManageUser(caller: AuthUser, targetUserId: string): Promise<void> {
    if (caller.id === targetUserId) return;
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { businessId: true } });
    const privileged = caller.role === UserRole.OWNER || caller.role === UserRole.MANAGER;
    if (!target || target.businessId !== caller.businessId || !privileged) {
      throw new ForbiddenException('You can only manage your own biometrics unless you are an owner or manager.');
    }
  }

  // ─── Registration ──────────────────────────────────────────────────────────

  async registrationBegin(userId: string, businessId: string, rp: RelyingParty) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, businessId },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const challenge = this.generateChallenge();
    this.challenges.set(`reg:${userId}`, {
      challenge,
      expiresAt: Date.now() + 60_000,
      rp,
    });

    return {
      challenge,
      rp: { id: rp.rpId, name: 'Faida POS' },
      user: {
        id: Buffer.from(user.id).toString('base64url'),
        name: user.email ?? user.name,
        displayName: user.name,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256 (P-256)
        { type: 'public-key', alg: -257 },  // RS256
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
    };
  }

  async registrationComplete(body: {
    userId: string;
    businessId: string;
    credentialId: string;
    clientDataJSON: string;   // base64url
    publicKeyDer: string;     // base64url — from response.getPublicKey()
    transports?: string[];
    deviceName?: string;
  }) {
    const entry = this.challenges.get(`reg:${body.userId}`);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new BadRequestException('Challenge expired or not found. Please start registration again.');
    }
    this.challenges.delete(`reg:${body.userId}`);

    // Verify clientDataJSON
    const clientData = JSON.parse(
      Buffer.from(body.clientDataJSON, 'base64url').toString('utf8'),
    ) as { type: string; challenge: string; origin: string };

    if (clientData.type !== 'webauthn.create') {
      throw new BadRequestException('Invalid clientDataJSON type');
    }
    if (clientData.challenge !== entry.challenge) {
      throw new BadRequestException('Challenge mismatch');
    }
    // The browser stamps the real page origin into clientDataJSON; it must be the one we issued the challenge for.
    if (clientData.origin !== entry.rp.origin) {
      throw new BadRequestException('Invalid origin');
    }

    if (!body.publicKeyDer) {
      throw new BadRequestException('publicKeyDer is required. Ensure your browser supports getPublicKey().');
    }

    // Check for duplicate credentialId
    const existing = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: body.credentialId },
    });
    if (existing) throw new BadRequestException('This credential is already registered');

    const credential = await this.prisma.webAuthnCredential.create({
      data: {
        id: uuidv4(),
        userId: body.userId,
        credentialId: body.credentialId,
        publicKeyDer: body.publicKeyDer,
        counter: 0,
        transports: body.transports ? JSON.stringify(body.transports) : null,
        deviceName: body.deviceName ?? 'Unknown device',
      },
    });

    return { ok: true, credentialId: credential.credentialId, deviceName: credential.deviceName };
  }

  // ─── Authentication ────────────────────────────────────────────────────────

  async authenticationBegin(businessId: string, rp: RelyingParty, userId?: string) {
    const challenge = this.generateChallenge();
    const key = `auth:${businessId}:${Date.now()}`;
    this.challenges.set(key, { challenge, expiresAt: Date.now() + 60_000, rp });

    let allowCredentials: { type: string; id: string; transports?: string[] }[] = [];

    if (userId) {
      const creds = await this.prisma.webAuthnCredential.findMany({
        where: { userId },
        select: { credentialId: true, transports: true },
      });
      allowCredentials = creds.map((c) => ({
        type: 'public-key',
        id: c.credentialId,
        ...(c.transports ? { transports: JSON.parse(c.transports) as string[] } : {}),
      }));
    }

    return {
      challenge,
      challengeKey: key, // frontend sends this back so we know which challenge to verify
      timeout: 60000,
      rpId: rp.rpId,
      allowCredentials,
      userVerification: 'required',
    };
  }

  async authenticationComplete(body: {
    businessId: string;
    challengeKey: string;
    credentialId: string;
    clientDataJSON: string;     // base64url
    authenticatorData: string;  // base64url
    signature: string;          // base64url
    userHandle?: string;        // base64url — userId encoded
  }) {
    const entry = this.challenges.get(body.challengeKey);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new UnauthorizedException('Challenge expired. Please try again.');
    }
    this.challenges.delete(body.challengeKey);

    // Verify clientDataJSON
    const clientData = JSON.parse(
      Buffer.from(body.clientDataJSON, 'base64url').toString('utf8'),
    ) as { type: string; challenge: string; origin: string };

    if (clientData.type !== 'webauthn.get') {
      throw new UnauthorizedException('Invalid clientDataJSON type');
    }
    if (clientData.challenge !== entry.challenge) {
      throw new UnauthorizedException('Challenge mismatch');
    }
    if (clientData.origin !== entry.rp.origin) {
      throw new UnauthorizedException('Invalid origin');
    }

    // Find credential in DB
    const credential = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: body.credentialId },
      include: {
        user: {
          include: { assignedStores: { select: { storeId: true } } },
        },
      },
    });
    if (!credential) throw new UnauthorizedException('Unknown credential');
    if (credential.user.businessId !== body.businessId) {
      throw new UnauthorizedException('Credential does not belong to this business');
    }

    // Verify signature using Node.js WebCrypto (Node 18+)
    const authDataBuf = Buffer.from(body.authenticatorData, 'base64url');
    if (authDataBuf.length < 37) throw new UnauthorizedException('Malformed authenticator data');
    // The authenticator signs a hash of the RP ID it used; it must be ours, and the user must have been verified.
    const rpIdHash = crypto.createHash('sha256').update(entry.rp.rpId).digest();
    if (!authDataBuf.subarray(0, 32).equals(rpIdHash)) throw new UnauthorizedException('Relying party mismatch');
    const flags = authDataBuf[32];
    if (!(flags & 0x01) || !(flags & 0x04)) throw new UnauthorizedException('Biometric verification was not performed');
    const clientDataHash = crypto
      .createHash('sha256')
      .update(Buffer.from(body.clientDataJSON, 'base64url'))
      .digest();
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const signatureBuf = Buffer.from(body.signature, 'base64url');
    const publicKeyDerBuf = Buffer.from(credential.publicKeyDer, 'base64url');

    let verified = false;
    try {
      // Try ES256 (P-256 ECDSA) — most common for platform authenticators
      const key = await globalThis.crypto.subtle.importKey(
        'spki',
        publicKeyDerBuf,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      verified = await globalThis.crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        signatureBuf,
        signedData,
      );
    } catch {
      // Fallback: try RS256 (RSA-PKCS1-v1_5)
      try {
        const key = await globalThis.crypto.subtle.importKey(
          'spki',
          publicKeyDerBuf,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        );
        verified = await globalThis.crypto.subtle.verify(
          'RSASSA-PKCS1-v1_5',
          key,
          signatureBuf,
          signedData,
        );
      } catch {
        verified = false;
      }
    }

    if (!verified) throw new UnauthorizedException('Signature verification failed');

    // Update counter (replay attack protection)
    const authDataView = new DataView(authDataBuf.buffer, authDataBuf.byteOffset);
    const newCounter = authDataView.getUint32(33, false); // big-endian at byte 33
    if (newCounter > 0 && newCounter <= credential.counter) {
      throw new UnauthorizedException('Counter replay detected — possible cloned authenticator');
    }
    await this.prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: { counter: newCounter },
    });

    // Issue JWT exactly like PIN login
    const user = credential.user;
    const storeId =
      user.assignedStores.length > 0 ? user.assignedStores[0].storeId : undefined;

    const payload: JwtPayload = {
      sub: user.id,
      businessId: user.businessId,
      role: user.role as UserRole,
      storeId: storeId ?? null,
      name: user.name,
    };

    const accessToken = this.jwt.sign(payload, { expiresIn: '12h' });
    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        businessId: user.businessId,
        storeId,
      },
    };
  }

  // ─── Credential management ─────────────────────────────────────────────────

  async listCredentials(userId: string) {
    return this.prisma.webAuthnCredential.findMany({
      where: { userId },
      select: { id: true, credentialId: true, deviceName: true, transports: true, createdAt: true, counter: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteCredential(id: string, userId: string) {
    const cred = await this.prisma.webAuthnCredential.findFirst({
      where: { id, userId },
    });
    if (!cred) throw new BadRequestException('Credential not found');
    await this.prisma.webAuthnCredential.delete({ where: { id } });
    return { ok: true };
  }
}
