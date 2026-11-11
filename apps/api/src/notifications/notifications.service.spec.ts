import { NotificationsService } from './notifications.service';

const sendMock = jest.fn();
const atFactory = jest.fn((cfg: { username: string }) => ({ SMS: { send: (args: unknown) => sendMock(cfg.username, args) } }));
jest.mock('./africastalking.client', () => ({ createAtClient: (cfg: { username: string }) => atFactory(cfg) }));

const OK = { SMSMessageData: { Recipients: [{ status: 'Success', messageId: 'm1' }] } };

function build(opts: { business?: boolean; counts?: { phone?: number; business?: number } } = {}) {
  const prisma = {
    business: { findUnique: jest.fn().mockResolvedValue(opts.business ? { atCredentialsEncrypted: 'enc' } : { atCredentialsEncrypted: null }) },
    smsLog: {
      count: jest.fn().mockImplementation(async ({ where }: { where: { channel?: string } }) =>
        where.channel === 'PLATFORM' ? (opts.counts?.business ?? 0) : (opts.counts?.phone ?? 0)),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const svc = new NotificationsService(prisma as never, {} as never);
  (svc as any).decryptAtCredentials = jest.fn().mockReturnValue({ username: 'shop-account', apiKey: 'shop-key', senderId: 'SHOPNAME' });
  return { svc, prisma };
}

const ENV = { ...process.env };
beforeEach(() => {
  sendMock.mockReset().mockResolvedValue(OK);
  process.env = { ...ENV, AT_USERNAME: 'platform-account', AT_API_KEY: 'platform-key', AT_SENDER_ID: 'Faida' };
});
afterAll(() => { process.env = ENV; });

describe('NotificationsService.sendSMS — which account sends', () => {
  it('sends login codes on the platform account even when the shop has its own', async () => {
    const { svc } = build({ business: true });
    await svc.sendSMS('biz-1', '0712345678', 'code', { purpose: 'OTP' });
    expect(sendMock).toHaveBeenCalledWith('platform-account', expect.objectContaining({ from: 'Faida', to: ['+254712345678'] }));
  });

  it('sends everything else on the shop\'s own account and sender ID when it has one', async () => {
    const { svc } = build({ business: true });
    await svc.sendSMS('biz-1', '0712345678', 'receipt');
    expect(sendMock).toHaveBeenCalledWith('shop-account', expect.objectContaining({ from: 'SHOPNAME' }));
  });

  it('falls back to the platform account when the shop has none', async () => {
    const { svc } = build({ business: false });
    const res = await svc.sendSMS('biz-1', '0712345678', 'receipt');
    expect(res.success).toBe(true);
    expect(sendMock).toHaveBeenCalledWith('platform-account', expect.anything());
  });

  it('login codes fall back to the shop\'s account if the platform one is not configured', async () => {
    delete process.env.AT_USERNAME;
    const { svc } = build({ business: true });
    await svc.sendSMS('biz-1', '0712345678', 'code', { purpose: 'OTP' });
    expect(sendMock).toHaveBeenCalledWith('shop-account', expect.anything());
  });

  it('reports "not configured" when neither account exists', async () => {
    delete process.env.AT_USERNAME;
    const { svc } = build({ business: false });
    const res = await svc.sendSMS('biz-1', '0712345678', 'code', { purpose: 'OTP' });
    expect(res).toEqual({ success: false, error: 'Messaging not configured' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses a number it cannot route without calling the provider', async () => {
    const { svc } = build();
    expect((await svc.sendSMS('biz-1', '123', 'x')).error).toBe('Invalid phone number');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.sendSMS — caps', () => {
  it('stops login codes to one number after the hourly limit', async () => {
    const { svc, prisma } = build({ counts: { phone: 5 } });
    const res = await svc.sendSMS('biz-1', '0712345678', 'code', { purpose: 'OTP' });
    expect(res).toMatchObject({ success: false, limited: true });
    expect(sendMock).not.toHaveBeenCalled();
    expect(prisma.smsLog.create).not.toHaveBeenCalled();
  });

  it('honours SMS_OTP_PER_PHONE_HOUR', async () => {
    process.env.SMS_OTP_PER_PHONE_HOUR = '2';
    const { svc } = build({ counts: { phone: 2 } });
    expect((await svc.sendSMS('biz-1', '0712345678', 'code', { purpose: 'OTP' })).limited).toBe(true);
  });

  it('stops a business using the platform account past its hourly allowance, for any purpose', async () => {
    const { svc } = build({ counts: { business: 300 } });
    expect((await svc.sendSMS('biz-1', '0712345678', 'promo')).limited).toBe(true);
    expect((await svc.sendSMS('biz-1', '0712345678', 'code', { purpose: 'OTP' })).limited).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does not cap a shop sending on its own account: that bill is theirs', async () => {
    const { svc } = build({ business: true, counts: { business: 9999 } });
    const res = await svc.sendSMS('biz-1', '0712345678', 'receipt');
    expect(res.success).toBe(true);
    expect(sendMock).toHaveBeenCalledWith('shop-account', expect.anything());
  });
});

describe('NotificationsService.sendSMS — usage log', () => {
  it('records each send with the channel that carried it', async () => {
    const { svc, prisma } = build({ business: false });
    await svc.sendSMS('biz-1', '0712345678', 'code', { purpose: 'OTP' });
    expect(prisma.smsLog.create).toHaveBeenCalledWith({
      data: { businessId: 'biz-1', phone: '+254712345678', purpose: 'OTP', channel: 'PLATFORM', success: true },
    });
  });

  it('records a provider failure as unsuccessful', async () => {
    sendMock.mockRejectedValue(new Error('AT down'));
    const { svc, prisma } = build();
    const res = await svc.sendSMS('biz-1', '0712345678', 'x');
    expect(res).toMatchObject({ success: false, error: 'AT down' });
    expect(prisma.smsLog.create.mock.calls[0][0].data.success).toBe(false);
  });

  it('a failure to write the log never fails the send', async () => {
    const { svc, prisma } = build();
    prisma.smsLog.create.mockRejectedValue(new Error('db down'));
    expect((await svc.sendSMS('biz-1', '0712345678', 'x')).success).toBe(true);
  });

  it('sendWhatsApp goes through the same caps and log', async () => {
    const { svc, prisma } = build({ counts: { business: 300 } });
    expect((await svc.sendWhatsApp('biz-1', '0712345678', 'x')).limited).toBe(true);
    expect(prisma.smsLog.create).not.toHaveBeenCalled();
  });
});
