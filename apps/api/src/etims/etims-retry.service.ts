import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EtimsService } from './etims.service';

/** A sale KRA has not heard of yet is tried again from this long after it was made... */
const RETRY_AFTER_MS = 5 * 60_000;
/** ...until it is this old (after that it needs a person: KRA may refuse a late invoice). */
const GIVE_UP_AFTER_MS = 7 * 86_400_000;
const BATCH = 100;
/** Stop the pass when KRA keeps refusing, rather than hammering it with the rest. */
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Sales whose submission to KRA failed (KRA was down, the till lost its connection before sending) used to sit as
 * "pending" until someone retried them by hand. This sweeps them every ten minutes, oldest first.
 */
@Injectable()
export class EtimsRetryService {
  private readonly logger = new Logger(EtimsRetryService.name);
  private running = false;

  constructor(private prisma: PrismaService, private etims: EtimsService) {}

  @Cron('*/10 * * * *')
  async sweep(): Promise<{ tried: number; submitted: number; failed: number }> {
    if (this.running) return { tried: 0, submitted: 0, failed: 0 };
    this.running = true;
    try {
      return await this.retryPending(new Date());
    } catch (e) {
      this.logger.warn(`eTIMS retry pass failed: ${String(e)}`);
      return { tried: 0, submitted: 0, failed: 0 };
    } finally {
      this.running = false;
    }
  }

  async retryPending(now: Date) {
    // Only businesses sending real invoices: a sandbox business marks sales submitted the moment they are made.
    const live = await this.prisma.business.findMany({
      where: { etimsMode: 'PRODUCTION', etimsCredentialsEncrypted: { not: null } },
      select: { id: true },
    });
    if (live.length === 0) return { tried: 0, submitted: 0, failed: 0 };
    const pending = await this.prisma.sale.findMany({
      where: {
        businessId: { in: live.map((b) => b.id) },
        etimsSubmitted: false,
        // KRA refused these invoices themselves: resending the same data is refused again, so a person fixes them first.
        etimsNeedsAttention: false,
        status: { in: ['PAID', 'CREDIT'] },
        createdAt: { gte: new Date(now.getTime() - GIVE_UP_AFTER_MS), lte: new Date(now.getTime() - RETRY_AFTER_MS) },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true },
    });
    let submitted = 0;
    let failed = 0;
    let inARow = 0;
    for (const sale of pending) {
      try {
        await this.etims.submitSale(sale.id);
        submitted++;
        inARow = 0;
      } catch {
        failed++;
        if (++inARow >= MAX_CONSECUTIVE_FAILURES) break;
      }
    }
    if (pending.length > 0) this.logger.log(`eTIMS retry: ${submitted} submitted, ${failed} failed of ${pending.length} pending`);

    // Credit notes for returns that KRA could not take at the time.
    const returns = await this.prisma.return.findMany({
      where: {
        businessId: { in: live.map((b) => b.id) },
        etimsCreditNoteSubmitted: false,
        etimsCreditNoteError: { not: null },
        createdAt: { gte: new Date(now.getTime() - GIVE_UP_AFTER_MS), lte: new Date(now.getTime() - RETRY_AFTER_MS) },
      } as any,
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true },
    });
    for (const r of returns) {
      try { await this.etims.submitCreditNote(r.id); } catch { /* kept on the return; tried again next pass */ }
    }
    return { tried: submitted + failed, submitted, failed };
  }
}
