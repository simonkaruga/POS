import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { frontendUrl } from '../common/app-urls';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.from = process.env.EMAIL_FROM ?? 'Faida POS <noreply@faidapos.co.ke>';

    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
      this.logger.warn('RESEND_API_KEY not set — email sending disabled');
    }
  }

  async send(opts: SendEmailOptions): Promise<boolean> {
    if (!this.resend) {
      this.logger.warn(`Email not sent (no API key): ${opts.subject} → ${opts.to}`);
      return false;
    }

    const to = Array.isArray(opts.to) ? opts.to : [opts.to];

    try {
      const { error } = await this.resend.emails.send({
        from: opts.from ?? this.from,
        to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });

      if (error) {
        this.logger.error(`Resend error: ${JSON.stringify(error)}`);
        return false;
      }

      this.logger.log(`Email sent: ${opts.subject} → ${to.join(', ')}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Email send failed: ${err.message}`);
      return false;
    }
  }

  // ── Transactional email templates ─────────────────────────────────────────

  async sendTrialExpiryWarning(opts: { to: string; businessName: string; daysLeft: number }) {
    return this.send({
      to: opts.to,
      subject: `Your Faida POS trial expires in ${opts.daysLeft} day${opts.daysLeft !== 1 ? 's' : ''}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#2563eb">Faida POS</h2>
          <p>Hi ${opts.businessName},</p>
          <p>Your free trial ends in <strong>${opts.daysLeft} day${opts.daysLeft !== 1 ? 's' : ''}</strong>.</p>
          <p>Upgrade now to keep access to all features.</p>
          <a href="${frontendUrl()}/settings?tab=subscription"
             style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
            Upgrade Plan
          </a>
          <p style="color:#6b7280;font-size:12px;margin-top:24px">Faida POS — Enterprise POS for Kenyan Businesses</p>
        </div>`,
    });
  }

  async sendSubscriptionConfirmation(opts: { to: string; businessName: string; plan: string; amount: string }) {
    return this.send({
      to: opts.to,
      subject: `Subscription confirmed — ${opts.plan} plan`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#16a34a">Payment Confirmed ✓</h2>
          <p>Hi ${opts.businessName},</p>
          <p>Your <strong>${opts.plan}</strong> subscription is now active. Amount charged: <strong>${opts.amount}</strong>.</p>
          <p>Thank you for choosing Faida POS!</p>
          <p style="color:#6b7280;font-size:12px;margin-top:24px">Faida POS — Enterprise POS for Kenyan Businesses</p>
        </div>`,
    });
  }

  async sendScheduledReport(opts: {
    to: string[];
    businessName: string;
    reportType: string;
    reportHtml: string;
    period: string;
  }) {
    return this.send({
      to: opts.to,
      subject: `${opts.businessName} — ${opts.reportType} Report (${opts.period})`,
      html: `
        <div style="font-family:sans-serif;max-width:800px;margin:0 auto">
          <h2 style="color:#2563eb">Faida POS — Scheduled Report</h2>
          <p><strong>Business:</strong> ${opts.businessName}</p>
          <p><strong>Report:</strong> ${opts.reportType}</p>
          <p><strong>Period:</strong> ${opts.period}</p>
          <hr style="border:1px solid #e5e7eb;margin:16px 0"/>
          ${opts.reportHtml}
          <p style="color:#6b7280;font-size:12px;margin-top:24px">
            This is an automated report from Faida POS.
            <a href="${frontendUrl()}/settings?tab=automation">Manage schedules</a>
          </p>
        </div>`,
    });
  }

  async sendLicenseKey(opts: { to: string; businessName: string; plan: string; licenseKey: string; expiresAt?: string | null }) {
    const expiryText = opts.expiresAt
      ? `Valid until: <strong>${new Date(opts.expiresAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>`
      : `<strong>Lifetime license — never expires</strong>`;
    return this.send({
      to: opts.to,
      subject: `Your Faida POS License Key — ${opts.plan} Plan`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#2563eb">Faida POS — License Key</h2>
          <p>Hi ${opts.businessName},</p>
          <p>Thank you for your payment! Your <strong>${opts.plan}</strong> license key is ready.</p>
          <div style="background:#f0f9ff;border:2px dashed #2563eb;border-radius:8px;padding:20px;margin:20px 0;text-align:center">
            <p style="color:#6b7280;font-size:12px;margin:0 0 8px">YOUR LICENSE KEY</p>
            <code style="font-size:22px;font-weight:bold;color:#1e40af;letter-spacing:0.05em">${opts.licenseKey}</code>
          </div>
          <p style="color:#374151">${expiryText}</p>
          <p>To activate: open the Faida POS desktop app → Settings → License → Enter key above.</p>
          <p>Keep this email safe. If you lose the key, contact support.</p>
          <p style="color:#6b7280;font-size:12px;margin-top:24px">Faida POS — Enterprise POS for Kenyan Businesses</p>
        </div>`,
    });
  }

  async sendPasswordReset(opts: { to: string; name: string; resetUrl: string }) {
    return this.send({
      to: opts.to,
      subject: 'Reset your Faida POS password',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#2563eb">Faida POS — Password Reset</h2>
          <p>Hi ${opts.name},</p>
          <p>We received a request to reset your password. Click the button below to set a new password.
             This link expires in <strong>15 minutes</strong>.</p>
          <a href="${opts.resetUrl}"
             style="display:inline-block;padding:12px 28px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
            Reset Password
          </a>
          <p style="color:#6b7280;font-size:13px">
            If you didn't request this, you can safely ignore this email — your password will not change.
          </p>
          <p style="color:#6b7280;font-size:12px;margin-top:24px">
            Or copy this link into your browser:<br/>
            <a href="${opts.resetUrl}" style="color:#2563eb;word-break:break-all">${opts.resetUrl}</a>
          </p>
          <p style="color:#9ca3af;font-size:11px;margin-top:24px">Faida POS — Enterprise POS for Kenyan Businesses</p>
        </div>`,
    });
  }

  async sendReferralReward(opts: { to: string; businessName: string; rewardAmount: string; referredBusiness: string }) {
    return this.send({
      to: opts.to,
      subject: 'Referral reward — Your account has been credited!',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#2563eb">Referral Reward!</h2>
          <p>Hi ${opts.businessName},</p>
          <p><strong>${opts.referredBusiness}</strong> signed up using your referral link.</p>
          <p>Your account has been credited with <strong>${opts.rewardAmount}</strong>.</p>
          <p style="color:#6b7280;font-size:12px;margin-top:24px">Faida POS</p>
        </div>`,
    });
  }

  async sendAffiliateApproved(opts: { to: string; name: string; code: string; link: string; commissionPercent: number }) {
    return this.send({
      to: opts.to,
      subject: 'You\'re approved — Faida Affiliate Program',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#4f46e5">Welcome aboard, ${opts.name}!</h2>
          <p>Your affiliate application has been approved. You'll earn <strong>${opts.commissionPercent}% recurring commission</strong> on every subscription payment from businesses you refer.</p>
          <p>Your referral link:</p>
          <p style="background:#f3f4f6;border-radius:8px;padding:12px;font-family:monospace;word-break:break-all">${opts.link}</p>
          <p>Share it far and wide. Track your signups, commissions and payouts anytime from your dashboard.</p>
          <p style="color:#6b7280;font-size:12px;margin-top:24px">Your code: ${opts.code} · Faida POS</p>
        </div>`,
    });
  }

  async sendAffiliateCommission(opts: { to: string; name: string; amount: string; businessName: string; balance: string }) {
    return this.send({
      to: opts.to,
      subject: `You earned ${opts.amount} — Faida Affiliate`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#10b981">Commission earned!</h2>
          <p>Hi ${opts.name},</p>
          <p><strong>${opts.businessName}</strong> made a subscription payment, so you just earned <strong>${opts.amount}</strong>.</p>
          <p>Your current balance is <strong>${opts.balance}</strong>. Payouts are processed by the Faida team.</p>
          <p style="color:#6b7280;font-size:12px;margin-top:24px">Faida POS</p>
        </div>`,
    });
  }

  async sendAffiliatePayout(opts: { to: string; name: string; amount: string; method: string; reference: string; balance: string }) {
    return this.send({
      to: opts.to,
      subject: `Payout sent: ${opts.amount} — Faida Affiliate`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#4f46e5">Payout sent</h2>
          <p>Hi ${opts.name},</p>
          <p>We've sent you a payout of <strong>${opts.amount}</strong> via <strong>${opts.method}</strong>${opts.reference ? ` (ref: ${opts.reference})` : ''}.</p>
          <p>Your remaining balance is <strong>${opts.balance}</strong>.</p>
          <p style="color:#6b7280;font-size:12px;margin-top:24px">Faida POS</p>
        </div>`,
    });
  }
}
