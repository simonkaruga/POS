/**
 * The Faida server's side of licensing: it decides who gets a licence and signs it.
 *
 * A computer asks with its licence key and its Machine ID. The first time (activate) the key is bound to that computer; after
 * that (renew) only that computer is served, so a key copied to a second computer is refused. A revoked or ended key gets no
 * new token; an installation keeps working until the token it already holds runs out (at most 30 days) plus the grace.
 * Every answer a computer can act on carries a short machine-readable `code`.
 */
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LicensePayload, signLicense } from './license-token';
import { TOKEN_DAYS, licenseTierToPlan } from './license-state';

const DAY = 24 * 60 * 60 * 1000;

export interface LicenseRequest {
  key: string;
  machineId: string;
  hostname?: string;
}

export interface LicenseIssued {
  token: string;
  tier: string;
  licenseExpiresAt: string | null;
  tokenExpiresAt: string;
}

const coded = (Ex: new (body: object) => HttpException, code: string, message: string) => new Ex({ statusCode: 0, code, message });

@Injectable()
export class LicenseAuthorityService {
  private readonly logger = new Logger(LicenseAuthorityService.name);

  constructor(private readonly prisma: PrismaService) {}

  private signingKey(): string {
    const key = process.env.LICENSE_SIGNING_PRIVATE_KEY;
    if (!key) throw coded(ServiceUnavailableException, 'NOT_CONFIGURED', 'This server cannot issue licences yet.');
    return key;
  }

  private clean(r: LicenseRequest): { key: string; machineId: string; hostname?: string } {
    const key = String(r?.key ?? '').trim();
    const machineId = String(r?.machineId ?? '').trim();
    if (key.length < 8 || key.length > 64) throw coded(BadRequestException, 'BAD_KEY', 'That is not a valid licence key.');
    if (machineId.length < 8 || machineId.length > 200) throw coded(BadRequestException, 'BAD_MACHINE', 'This computer could not be identified.');
    return { key, machineId, hostname: r.hostname ? String(r.hostname).slice(0, 120) : undefined };
  }

  private async find(key: string) {
    const row = await this.prisma.licenseKey.findFirst({ where: { key: { equals: key, mode: 'insensitive' } } });
    if (!row) throw coded(NotFoundException, 'UNKNOWN_KEY', 'That licence key was not found. Check it and try again.');
    return row;
  }

  /** The checks every request passes: not cancelled, not ended. */
  private assertUsable(row: { isActive: boolean; expiresAt: Date | null }, now: Date): void {
    if (!row.isActive) throw coded(ForbiddenException, 'REVOKED', 'This licence has been cancelled. Contact Faida support.');
    if (row.expiresAt && row.expiresAt <= now) throw coded(ForbiddenException, 'EXPIRED', 'This licence has ended. Renew your subscription to continue.');
  }

  /** First use: binds the key to this computer. The same computer asking again just gets a fresh token. */
  async activate(request: LicenseRequest, now: Date = new Date()): Promise<LicenseIssued> {
    const { key, machineId, hostname } = this.clean(request);
    const signing = this.signingKey();
    const row = await this.find(key);
    this.assertUsable(row, now);

    if (row.machineId && row.machineId !== machineId) {
      throw coded(ConflictException, 'OTHER_COMPUTER', 'This key is already used on another computer. If the shop has replaced its computer, ask Faida support to release the key.');
    }
    if (!row.machineId) {
      // Claim it only if it is still unclaimed, so two computers activating at once cannot both win.
      const claimed = await this.prisma.licenseKey.updateMany({
        where: { id: row.id, machineId: null },
        data: { machineId, hostname, boundAt: now, activatedAt: row.activatedAt ?? now, lastSeenAt: now },
      });
      if (claimed.count !== 1) {
        const again = await this.prisma.licenseKey.findUnique({ where: { id: row.id } });
        if (again?.machineId !== machineId) throw coded(ConflictException, 'OTHER_COMPUTER', 'This key was just activated on another computer.');
      }
      this.logger.log(`License ${row.id} (${row.tier}) bound to a computer${hostname ? ` (${hostname})` : ''}`);
    } else {
      await this.prisma.licenseKey.update({ where: { id: row.id }, data: { hostname: hostname ?? row.hostname, lastSeenAt: now } });
    }
    return this.issue(row, machineId, now, signing);
  }

  /** The quiet renewal. Only the computer the key is bound to is served. */
  async renew(request: LicenseRequest, now: Date = new Date()): Promise<LicenseIssued> {
    const { key, machineId } = this.clean(request);
    const signing = this.signingKey();
    const row = await this.find(key);
    this.assertUsable(row, now);
    if (!row.machineId) throw coded(ConflictException, 'NOT_ACTIVATED', 'This key has not been activated on this computer yet.');
    if (row.machineId !== machineId) throw coded(ConflictException, 'OTHER_COMPUTER', 'This key is used on another computer.');
    await this.prisma.licenseKey.update({ where: { id: row.id }, data: { lastSeenAt: now } });
    return this.issue(row, machineId, now, signing);
  }

  private issue(row: { id: string; tier: string; expiresAt: Date | null }, machineId: string, now: Date, signing: string): LicenseIssued {
    // A token lasts 30 days but never past the end of the licence itself.
    const thirtyDays = new Date(now.getTime() + TOKEN_DAYS * DAY);
    const tokenExpiresAt = row.expiresAt && row.expiresAt < thirtyDays ? row.expiresAt : thirtyDays;
    const tier = licenseTierToPlan(row.tier);
    const payload: LicensePayload = {
      v: 1,
      lid: row.id,
      tier,
      machineId,
      issuedAt: now.toISOString(),
      tokenExpiresAt: tokenExpiresAt.toISOString(),
      licenseExpiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    };
    return { token: signLicense(payload, signing), tier, licenseExpiresAt: payload.licenseExpiresAt, tokenExpiresAt: payload.tokenExpiresAt };
  }

  /** Admin: free the key so the shop can activate it on a replacement computer. */
  async release(id: string): Promise<{ released: boolean }> {
    const row = await this.prisma.licenseKey.findUnique({ where: { id } });
    if (!row) throw coded(NotFoundException, 'UNKNOWN_KEY', 'Licence key not found.');
    await this.prisma.licenseKey.update({ where: { id }, data: { machineId: null, hostname: null, boundAt: null } });
    return { released: true };
  }
}
