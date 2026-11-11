import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { createDecipheriv } from 'crypto';
import { toE164 } from '../common/phone';
import { createAtClient } from './africastalking.client';

export type SmsPurpose = 'OTP' | 'GENERAL';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
  ) {}

  // ─── AT Credentials ─────────────────────────────────────────────────────────

  private decryptAtCredentials(encrypted: string): { apiKey: string; username: string; senderId?: string } | null {
    try {
      const algorithm = 'aes-256-cbc';
      const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '0'.repeat(64), 'hex');
      const parts = encrypted.split(':');
      const iv = Buffer.from(parts.shift()!, 'hex');
      const encryptedText = Buffer.from(parts.join(':'), 'hex');
      const decipher = createDecipheriv(algorithm, key, iv);
      const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
      return JSON.parse(decrypted.toString());
    } catch {
      return null;
    }
  }

  /**
   * The shared Faida account, from the environment. It is the default for every business, so a
   * shop can take customer logins without opening and funding its own Africa's Talking account.
   */
  private platformCreds(): { apiKey: string; username: string; senderId?: string } | null {
    const username = process.env.AT_USERNAME?.trim();
    const apiKey = process.env.AT_API_KEY?.trim();
    if (!username || !apiKey) return null;
    return { username, apiKey, senderId: process.env.AT_SENDER_ID?.trim() || undefined };
  }

  private async businessCreds(businessId: string) {
    if (!businessId) return null;
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { atCredentialsEncrypted: true },
    });
    if (!business?.atCredentialsEncrypted) return null;
    const creds = this.decryptAtCredentials(business.atCredentialsEncrypted);
    return creds?.apiKey && creds?.username ? creds : null;
  }

  /**
   * Which account sends this message. Login codes go out on the platform account first: they are
   * authentication, so they must keep arriving whether or not a shop has set anything up or topped
   * up its own balance. Everything else prefers the shop's own account (its own sender ID and
   * bill) and falls back to the platform one.
   */
  private async getAtInstance(businessId: string, purpose: SmsPurpose = 'GENERAL') {
    const business = await this.businessCreds(businessId);
    const platform = this.platformCreds();
    const order: Array<['BUSINESS' | 'PLATFORM', typeof platform]> =
      purpose === 'OTP' ? [['PLATFORM', platform], ['BUSINESS', business]] : [['BUSINESS', business], ['PLATFORM', platform]];
    const pick = order.find(([, creds]) => !!creds);
    if (!pick) return null;
    const [channel, creds] = pick;
    const at = createAtClient({ apiKey: creds!.apiKey, username: creds!.username });
    return { at, creds: creds!, channel };
  }

  private static intFromEnv(name: string, fallback: number): number {
    const n = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /**
   * Hourly caps, checked before anything is sent. Only the platform account is capped: its bill is
   * ours. Without this, anyone could ask for login codes for thousands of numbers (the endpoint is
   * public) or a stolen staff token could text arbitrary numbers, all on our account.
   *   - per phone: login codes to one number
   *   - per business: everything sent for that business on the platform account
   */
  private async overCap(businessId: string, to: string, purpose: SmsPurpose): Promise<string | null> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const perPhone = NotificationsService.intFromEnv('SMS_OTP_PER_PHONE_HOUR', 5);
    const perBusiness = NotificationsService.intFromEnv('SMS_PLATFORM_PER_BUSINESS_HOUR', 300);

    if (purpose === 'OTP') {
      const toPhone = await this.prisma.smsLog.count({ where: { phone: to, purpose: 'OTP', createdAt: { gte: since } } });
      if (toPhone >= perPhone) return 'Too many codes requested for this number';
    }
    const sent = await this.prisma.smsLog.count({ where: { businessId, channel: 'PLATFORM', createdAt: { gte: since } } });
    if (sent >= perBusiness) {
      this.logger.error(`Platform SMS cap of ${perBusiness}/hour reached for business ${businessId}; sends are refused until the hour rolls over`);
      return 'SMS limit reached for this business';
    }
    // One warning on the way up so a runaway is seen before it hits the cap.
    if (sent + 1 === Math.ceil(perBusiness * 0.8)) {
      this.logger.warn(`Business ${businessId} has used 80% of its ${perBusiness}/hour platform SMS allowance`);
    }
    return null;
  }

  private async logSms(entry: { businessId: string; phone: string; purpose: SmsPurpose; channel: string; success: boolean }) {
    try {
      await this.prisma.smsLog.create({ data: entry });
    } catch (err) {
      // Bookkeeping must never turn a delivered message into a failed request.
      this.logger.error(`Could not record SMS log: ${(err as Error)?.message}`);
    }
  }

  // ─── In-App Notifications ─────────────────────────────────────────────────

  async createNotification(data: {
    businessId: string;
    type: string;
    priority?: string;
    title: string;
    body: string;
    entityId?: string;
    entityType?: string;
  }) {
    const notification = await this.prisma.notification.create({
      data: { ...data, priority: data.priority ?? 'NORMAL' },
    });
    // Push real-time event to all staff connected to this business
    this.events.emitNotificationCreated(data.businessId, {
      id: notification.id,
      type: notification.type,
      priority: notification.priority,
      title: notification.title,
      body: notification.body,
      entityId: notification.entityId,
      entityType: notification.entityType,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
    });
    return notification;
  }

  async getNotifications(businessId: string, unreadOnly?: boolean, type?: string) {
    return this.prisma.notification.findMany({
      where: {
        businessId,
        ...(unreadOnly ? { isRead: false } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(id: string) {
    return this.prisma.notification.update({ where: { id }, data: { isRead: true } });
  }

  async markAllRead(businessId: string) {
    return this.prisma.notification.updateMany({
      where: { businessId, isRead: false },
      data: { isRead: true },
    });
  }

  async getUnreadCount(businessId: string) {
    return this.prisma.notification.count({ where: { businessId, isRead: false } });
  }

  async deleteNotification(id: string) {
    return this.prisma.notification.delete({ where: { id } });
  }

  // ─── Automated notification triggers ─────────────────────────────────────

  async notifyLowStock(businessId: string, itemName: string, currentStock: number, itemId?: string) {
    return this.createNotification({
      businessId,
      type: 'LOW_STOCK',
      priority: 'HIGH',
      title: 'Low Stock Alert',
      body: `${itemName} is running low (${currentStock} remaining).`,
      entityId: itemId,
      entityType: 'Item',
    });
  }

  async notifyExpiringSoon(businessId: string, itemName: string, daysLeft: number, batchId?: string) {
    return this.createNotification({
      businessId,
      type: 'EXPIRY_ALERT',
      priority: daysLeft <= 7 ? 'HIGH' : 'NORMAL',
      title: 'Expiry Alert',
      body: `${itemName} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`,
      entityId: batchId,
      entityType: 'Batch',
    });
  }

  async notifyEtimsFailure(businessId: string, receiptNumber: string, saleId?: string) {
    return this.createNotification({
      businessId,
      type: 'ETIMS_FAILED',
      priority: 'HIGH',
      title: 'eTIMS Submission Failed',
      body: `Receipt ${receiptNumber} could not be submitted to KRA. Will retry when online.`,
      entityId: saleId,
      entityType: 'Sale',
    });
  }

  async notifyCreditOverdue(businessId: string, customerName: string, balanceCents: number, customerId?: string) {
    return this.createNotification({
      businessId,
      type: 'CREDIT_OVERDUE',
      priority: 'NORMAL',
      title: 'Credit Balance Outstanding',
      body: `${customerName} has KES ${(balanceCents / 100).toFixed(2)} outstanding.`,
      entityId: customerId,
      entityType: 'Customer',
    });
  }

  async notifyExpenseApproval(businessId: string, amount: number, category: string, expenseId?: string) {
    return this.createNotification({
      businessId,
      type: 'EXPENSE_APPROVAL',
      priority: 'NORMAL',
      title: 'Expense Awaiting Approval',
      body: `KES ${(amount / 100).toFixed(2)} ${category} expense requires manager approval.`,
      entityId: expenseId,
      entityType: 'Expense',
    });
  }

  async notifyCommissionMilestone(businessId: string, employeeId: string, employeeName: string, pct: number) {
    await this.prisma.notification.create({
      data: {
        businessId,
        type: 'COMMISSION_MILESTONE',
        priority: 'LOW',
        title: `Commission Milestone: ${employeeName}`,
        body: `${employeeName} has achieved ${pct}% of their commission target this month.`,
        entityId: employeeId,
        entityType: 'Employee',
      },
    });
  }

  async notifyCashDiscrepancy(businessId: string, storeId: string, varianceCents: number, cashierId: string) {
    const sign = varianceCents > 0 ? '+' : '';
    await this.prisma.notification.create({
      data: {
        businessId,
        type: 'CASH_DISCREPANCY',
        priority: 'HIGH',
        title: 'Cash Drawer Discrepancy',
        body: `Cash drawer closed with variance of ${sign}KES ${(Math.abs(varianceCents) / 100).toFixed(2)}. Please review.`,
        entityId: storeId,
        entityType: 'Store',
      },
    });
  }

  async notifyBatchRecall(businessId: string, batchId: string, itemName: string, affectedCount: number) {
    await this.prisma.notification.create({
      data: {
        businessId,
        type: 'BATCH_RECALL',
        priority: 'HIGH',
        title: `Batch Recall: ${itemName}`,
        body: `Batch has been recalled. ${affectedCount} unit(s) of ${itemName} affected. Please remove from shelves immediately.`,
        entityId: batchId,
        entityType: 'Batch',
      },
    });
  }

  // ─── SMS / WhatsApp via Africa's Talking ──────────────────────────────────

  async sendSMS(
    businessId: string,
    phone: string,
    message: string,
    opts: { purpose?: SmsPurpose } = {},
  ): Promise<{ success: boolean; messageId?: string; error?: string; limited?: boolean }> {
    const purpose = opts.purpose ?? 'GENERAL';
    const instance = await this.getAtInstance(businessId, purpose);
    if (!instance) {
      this.logger.warn(`No SMS account for business ${businessId}: neither its own nor the platform AT_* credentials are set`);
      return { success: false, error: 'Messaging not configured' };
    }
    // Callers hold phone numbers in whatever shape they were typed in; Africa's
    // Talking documents international format. Normalize here so every caller
    // benefits rather than each one remembering to.
    const to = toE164(phone);
    if (!to) {
      this.logger.warn(`Unroutable phone number, not sending: ${phone}`);
      return { success: false, error: 'Invalid phone number' };
    }
    if (instance.channel === 'PLATFORM') {
      const refused = await this.overCap(businessId, to, purpose);
      if (refused) return { success: false, error: refused, limited: true };
    }
    let result: { success: boolean; messageId?: string; error?: string };
    try {
      const sent = await instance.at.SMS.send({
        to: [to],
        message,
        // Without the account's registered sender ID, AT falls back to a shared
        // shortcode — or rejects the send outright on accounts that require one.
        ...(instance.creds.senderId ? { from: instance.creds.senderId } : {}),
      });
      const recipient = sent?.SMSMessageData?.Recipients?.[0];
      result = { success: recipient?.status === 'Success', messageId: recipient?.messageId };
    } catch (err: any) {
      this.logger.error(`SMS send failed: ${err?.message}`);
      result = { success: false, error: err?.message };
    }
    await this.logSms({ businessId, phone: to, purpose, channel: instance.channel, success: result.success });
    return result;
  }

  async sendWhatsApp(businessId: string, phone: string, message: string) {
    // AT's WhatsApp channel needs a separately approved business account, so this goes out as SMS.
    // Routing it through sendSMS keeps it inside the same caps and usage log as every other send.
    return this.sendSMS(businessId, phone, message);
  }

  async sendReceiptSMS(businessId: string, phone: string, receiptNumber: string, totalCents: number) {
    const message = `Thank you for shopping with us!\nReceipt: ${receiptNumber}\nTotal: KES ${(totalCents / 100).toFixed(2)}\nPowered by Faida POS`;
    return this.sendSMS(businessId, phone, message);
  }

  async sendReceiptWhatsApp(businessId: string, phone: string, receiptNumber: string, totalCents: number) {
    const message = `*Thank you for your purchase!*\n\nReceipt No: ${receiptNumber}\nTotal: KES ${(totalCents / 100).toFixed(2)}\n\n_Powered by Faida POS_`;
    return this.sendWhatsApp(businessId, phone, message);
  }

  async sendLoyaltyPointsSMS(businessId: string, phone: string, points: number, balance: number) {
    const message = `You earned ${points} loyalty points! Your balance is now ${balance} points.`;
    return this.sendSMS(businessId, phone, message);
  }

  async sendPromotionSMS(businessId: string, phone: string, promotionName: string, discount: string) {
    return this.sendSMS(businessId, phone, `Special offer: ${promotionName}! Get ${discount} off.`);
  }

  async sendLayawayReminderSMS(businessId: string, phone: string, remainingCents: number, dueDate: Date) {
    return this.sendSMS(businessId, phone, `Layaway reminder: KES ${(remainingCents / 100).toFixed(2)} remaining. Due: ${dueDate.toLocaleDateString()}`);
  }

  async sendCreditReminderSMS(businessId: string, phone: string, balanceCents: number) {
    return this.sendSMS(businessId, phone, `Credit balance outstanding: KES ${(balanceCents / 100).toFixed(2)}. Please clear your balance.`);
  }
}
