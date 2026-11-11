import { Controller, Post, Get, Patch, Delete, Body, Param, Query, Req, UseGuards, UploadedFile, UseInterceptors, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.service';
import { intInRange } from '../common/validate';
import { FileInterceptor } from '@nestjs/platform-express';
import { MpesaService } from './mpesa.service';
import { ReconciliationService } from './reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard, Public } from '../auth/jwt-auth.guard';
import { SkipSubscriptionCheck } from '../auth/subscription.guard';
import { Throttle } from '@nestjs/throttler';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private mpesa: MpesaService,
    private reconciliation: ReconciliationService,
    private prisma: PrismaService,
  ) {}

  @Post('mpesa/stk-push')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async stkPush(@Body() body: { phone: string; amountCents: number; reference: string }) {
    return this.mpesa.initiateSTKPush({
      phone: body.phone,
      amountCents: body.amountCents,
      accountReference: body.reference,
    });
  }

  @Get('mpesa/stk-status/:checkoutRequestId')
  @UseGuards(JwtAuthGuard)
  async stkStatus(@Param('checkoutRequestId') checkoutRequestId: string) {
    return this.mpesa.querySTKStatus(checkoutRequestId);
  }

  /** Safaricom calls this endpoint after payment attempt */
  @Post('mpesa/callback')
  async mpesaCallback(@Body() body: unknown) {
    await this.mpesa.handleCallback(body);
    return { ResultCode: 0, ResultDesc: 'Success' };
  }

  @Post('mpesa/b2c')
  @UseGuards(JwtAuthGuard)
  async mpesaB2C(@Body() body: { phone: string; amountCents: number; remarks: string; businessId: string }) {
    return this.mpesa.initiateB2C(body);
  }

  /** Bulk B2C disbursement for a payroll run — fires one B2C per payslip with employee phone */
  @Post('mpesa/b2c-bulk')
  @UseGuards(JwtAuthGuard)
  async mpesaB2CBulk(@Body() body: { businessId: string; payrollRunId: string }) {
    const payslips = await this.prisma.payslip.findMany({
      where: { payrollRunId: body.payrollRunId },
    });

    // Batch-fetch employee → user phone numbers
    const employeeIds = payslips.map(p => p.employeeId);
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      include: { user: { select: { phone: true } } },
    });
    const phoneMap = new Map(employees.map(e => [e.id, e.user?.phone ?? null]));

    const results: Array<{ employee: string; status: string; error?: string }> = [];
    for (const ps of payslips) {
      const phone = phoneMap.get(ps.employeeId);
      if (!phone) {
        results.push({ employee: ps.employeeName, status: 'skipped', error: 'No phone number on file' });
        continue;
      }
      try {
        await this.mpesa.initiateB2C({
          businessId: body.businessId,
          phone,
          amountCents: ps.netPay,
          remarks: `Payroll ${body.payrollRunId.slice(-6)}`,
        });
        results.push({ employee: ps.employeeName, status: 'sent' });
      } catch (e: any) {
        results.push({ employee: ps.employeeName, status: 'failed', error: e?.message });
      }
    }
    return { disbursed: results.filter(r => r.status === 'sent').length, total: payslips.length, results };
  }

  @Post('mpesa/qr')
  @UseGuards(JwtAuthGuard)
  async generateQR(
    @Body() body: { amountCents: number; reference: string; merchantName?: string },
  ) {
    return this.mpesa.generateDynamicQR({
      amountCents: body.amountCents,
      reference: body.reference,
      merchantName: body.merchantName ?? 'POS',
    });
  }

  @Post('card')
  @UseGuards(JwtAuthGuard)
  async cardPayment(@Body() body: { amountCents: number }) {
    return {
      success: true,
      reference: `CARD-${Date.now()}`,
      amountCents: body.amountCents,
    };
  }

  /** Get Paystack public key + the email to bill, for the Inline popup. */
  @Get('paystack/config')
  @UseGuards(JwtAuthGuard)
  async paystackConfig(
    @Query('businessId') businessId: string,
    @Query('customerId') customerId?: string,
  ) {
    const [biz, customer] = await Promise.all([
      this.prisma.business.findUnique({
        where: { id: businessId },
        select: { paystackPublicKey: true, shortCode: true },
      }),
      customerId
        ? this.prisma.customer.findUnique({ where: { id: customerId }, select: { email: true } })
        : null,
    ]);

    // Paystack uses this address for the receipt and for any dispute
    // correspondence. Every transaction used to be sent as customer@pos.local —
    // one fake address on an invalid TLD, so receipts bounced and every card
    // sale in the dashboard was attributed to the same non-existent customer.
    const payerEmail =
      customer?.email?.trim() ||
      `pos-${(biz?.shortCode ?? businessId).toLowerCase()}@faidapos.co.ke`;

    return { publicKey: biz?.paystackPublicKey ?? null, payerEmail };
  }

  /**
   * Start a Paystack payment: returns the page the payer pays on and the reference to check afterwards with
   * `paystack/verify`. The reconciliation screen calls this, and the route did not exist, so the button always failed.
   * The business is the signed-in user's, not whatever the request names. With no secret key it refuses outright.
   */
  @Post('paystack/initiate')
  @UseGuards(JwtAuthGuard)
  async initiatePaystack(@Body() body: { amountCents: number; email: string }, @Req() req: Request & { user: AuthUser }) {
    const amountCents = intInRange(body?.amountCents, 'Amount', 100, 1_000_000_000);
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new BadRequestException('Enter a valid email address for the payer');

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      this.logger.error('Paystack initiate attempted with no PAYSTACK_SECRET_KEY');
      throw new ServiceUnavailableException('Card payments are not configured. Set PAYSTACK_SECRET_KEY.');
    }

    const businessId = req.user.businessId;
    const reference = `RECON-${businessId.slice(0, 12)}-${Date.now()}`;
    try {
      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, amount: amountCents, currency: 'KES', reference, metadata: { businessId, source: 'reconciliation' } }),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: { authorization_url?: string; reference?: string } };
      if (!res.ok || !data.status || !data.data?.authorization_url) {
        this.logger.warn(`Paystack initiate HTTP ${res.status}: ${data.message ?? 'no message'}`);
        throw new BadRequestException(data.message ?? 'Paystack could not start the payment');
      }
      return { authorizationUrl: data.data.authorization_url, reference: data.data.reference ?? reference };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Paystack initiate failed: ${err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException('Could not reach Paystack. Try again in a moment.');
    }
  }

  /** Verify a Paystack Inline transaction reference */
  @Post('paystack/verify')
  @UseGuards(JwtAuthGuard)
  async verifyPaystack(@Body() body: { reference: string; businessId: string }) {
    const biz = await this.prisma.business.findUnique({
      where: { id: body.businessId },
      select: { paystackPublicKey: true },
    });

    // Verification fails CLOSED.
    //
    // This used to answer `verified: true` in two situations where nothing had
    // actually been checked: when no secret key was configured at all, and in the
    // catch block, so any timeout or malformed response from Paystack marked the
    // sale paid. The success callback it trusts comes from a popup running in the
    // browser, which anyone can invoke from devtools — this endpoint is the only
    // real control over whether money arrived, and it was waving everything
    // through. Production currently runs with PAYSTACK_SECRET_KEY unset, so the
    // first branch was live: every card sale was approved without a single call
    // to Paystack.
    //
    // There is no mock-success path any more. Paystack issue free test keys; use
    // those to exercise the flow rather than a branch that says "paid" on trust.
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      this.logger.error(
        `Paystack verify attempted with no PAYSTACK_SECRET_KEY (ref ${body.reference}). ` +
        'Card payment cannot be confirmed — refusing.',
      );
      return {
        verified: false,
        reference: body.reference,
        status: 'unconfigured',
        reason: 'Card verification is not configured. Set PAYSTACK_SECRET_KEY.',
      };
    }

    try {
      const res = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(body.reference)}`,
        {
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!res.ok) {
        this.logger.warn(`Paystack verify HTTP ${res.status} for ref ${body.reference}`);
        return {
          verified: false, reference: body.reference, status: 'unverified',
          reason: `Paystack returned ${res.status}.`,
        };
      }

      const data = await res.json() as { status?: boolean; data?: { status?: string; amount?: number } };
      const paid = data.status === true && data.data?.status === 'success';

      if (!paid) {
        this.logger.warn(
          `Paystack verify not successful for ref ${body.reference}: ${data.data?.status ?? 'unknown'}`,
        );
      }

      return {
        verified: paid,
        reference: body.reference,
        status: data.data?.status ?? 'unknown',
        amountCents: data.data?.amount ?? undefined,
      };
    } catch (err) {
      // Unreachable, timed out, or unparseable. We do not know that the money
      // arrived, so we must not say that it did.
      this.logger.error(
        `Paystack verify failed for ref ${body.reference}: ${err instanceof Error ? err.message : err}`,
      );
      return {
        verified: false, reference: body.reference, status: 'unverified',
        reason: 'Could not reach Paystack to confirm this payment.',
      };
    }
  }

  // ─── Bank Reconciliation ─────────────────────────────────────────────────────

  @Post('reconciliation/upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadStatement(
    @UploadedFile() file: any,
    @Body('businessId') businessId: string,
    @Body('storeId') storeId?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('A CSV file is required (form field "file")');
    const csvContent = file.buffer.toString('utf8');
    return this.reconciliation.uploadStatement(businessId, file.originalname, csvContent, storeId);
  }

  @Get('reconciliation/statements')
  @UseGuards(JwtAuthGuard)
  async getStatements(@Query('businessId') businessId: string) {
    return this.reconciliation.getStatements(businessId);
  }

  @Get('reconciliation/entries/:statementId')
  @UseGuards(JwtAuthGuard)
  async getEntries(
    @Param('statementId') statementId: string,
    @Query('matchStatus') matchStatus?: string,
  ) {
    return this.reconciliation.getEntries(statementId, matchStatus);
  }

  @Patch('reconciliation/entries/:entryId/match')
  @UseGuards(JwtAuthGuard)
  async manualMatch(
    @Param('entryId') entryId: string,
    @Body('saleId') saleId: string,
  ) {
    return this.reconciliation.manualMatch(entryId, saleId);
  }

  @Get('reconciliation/summary')
  @UseGuards(JwtAuthGuard)
  async getSummary(
    @Query('businessId') businessId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reconciliation.getSummary(businessId, startDate, endDate);
  }

  @Delete('reconciliation/statements/:id')
  @UseGuards(JwtAuthGuard)
  async deleteStatement(@Param('id') id: string) {
    return this.reconciliation.deleteStatement(id);
  }

  // ─── M-Pesa C2B (Paybill/Till incoming payments) ─────────────────────────────

  /** Safaricom calls this to validate a payment — always approve */
  @Post('mpesa/c2b/validate')
  c2bValidate() {
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }

  /** Safaricom calls this when a payment is confirmed */
  @Post('mpesa/c2b/confirm')
  async c2bConfirm(@Body() body: Record<string, unknown>, @Query('businessId') businessId: string) {
    if (!businessId) return { ResultCode: 0, ResultDesc: 'No businessId' };
    await this.mpesa.handleC2BConfirmation(businessId, body);
    return { ResultCode: 0, ResultDesc: 'Success' };
  }

  /** Register C2B URLs with Safaricom (one-time setup) */
  @Post('mpesa/c2b/register')
  @UseGuards(JwtAuthGuard)
  async c2bRegister(
    @Body() body: { shortCode: string; baseUrl: string; businessId: string },
  ) {
    const validationUrl = `${body.baseUrl}/api/v1/payments/mpesa/c2b/validate?businessId=${body.businessId}`;
    const confirmationUrl = `${body.baseUrl}/api/v1/payments/mpesa/c2b/confirm?businessId=${body.businessId}`;
    return this.mpesa.registerC2BUrls({
      shortCode: body.shortCode,
      validationUrl,
      confirmationUrl,
    });
  }

  /** Get recent incoming C2B payments for this business */
  @Get('mpesa/c2b/incoming')
  @UseGuards(JwtAuthGuard)
  async c2bIncoming(
    @Query('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.mpesa.getPendingC2BPayments(businessId, limit ? parseInt(limit) : 50);
  }

  /** Get count of pending unmatched payments (for badge) */
  @Get('mpesa/c2b/stats')
  @UseGuards(JwtAuthGuard)
  async c2bStats(@Query('businessId') businessId: string) {
    return this.mpesa.getC2BStats(businessId);
  }

  /** Match a C2B payment to a sale */
  @Patch('mpesa/c2b/:id/match')
  @UseGuards(JwtAuthGuard)
  async c2bMatch(
    @Param('id') id: string,
    @Body() body: { saleId: string; matchedBy: string },
  ) {
    await this.mpesa.matchC2BPayment(id, body.saleId, body.matchedBy);
    return { success: true };
  }

  /** Dismiss a C2B payment (not for this sale) */
  @Patch('mpesa/c2b/:id/dismiss')
  @UseGuards(JwtAuthGuard)
  async c2bDismiss(@Param('id') id: string) {
    await this.mpesa.dismissC2BPayment(id);
    return { success: true };
  }

  // Payment links live in PaymentLinksModule (`payment-links/`). They used to be
  // duplicated here, which made the link-code format and whether "pay" actually
  // charged the customer depend on which module Nest registered first.
}
