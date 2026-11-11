import { DeliveryService } from './delivery.service';

function makeService(overrides: Record<string, any> = {}) {
  const prisma: any = {
    deliveryOrder: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    driverLocation: { findMany: jest.fn() },
    user: { findMany: jest.fn(), findFirst: jest.fn() },
    ...overrides,
  };
  const notifications = { sendSMS: jest.fn().mockResolvedValue({ success: true }) };
  const svc = new DeliveryService(
    prisma,
    { createEntry: jest.fn() } as any,
    notifications as any,
    { send: jest.fn() } as any,
  );
  return { svc, prisma, notifications };
}

describe('DeliveryService — customer tracking links', () => {
  const ORIGINAL = { FRONTEND_URL: process.env.FRONTEND_URL, WEB_URL: process.env.WEB_URL };

  afterEach(() => {
    process.env.FRONTEND_URL = ORIGINAL.FRONTEND_URL;
    process.env.WEB_URL = ORIGINAL.WEB_URL;
    if (ORIGINAL.FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
    if (ORIGINAL.WEB_URL === undefined) delete process.env.WEB_URL;
  });

  const DELIVERY = {
    id: 'del-1',
    businessId: 'biz-1',
    orderNumber: 'DEL-1755100000000',
    customerPhone: '254712345678',
  };

  it('builds the link from FRONTEND_URL, not localhost', async () => {
    process.env.FRONTEND_URL = 'https://faida-pos.vercel.app';
    delete process.env.WEB_URL;
    const { svc, prisma } = makeService();
    prisma.deliveryOrder.findUnique.mockResolvedValue(DELIVERY);

    const res = await svc.sendCustomerTrackingLink('del-1');

    expect(res.trackingUrl).toBe(
      'https://faida-pos.vercel.app/track/DEL-1755100000000',
    );
    expect(res.trackingUrl).not.toContain('localhost');
  });

  it('texts the customer that same link', async () => {
    process.env.FRONTEND_URL = 'https://faida-pos.vercel.app';
    const { svc, prisma, notifications } = makeService();
    prisma.deliveryOrder.findUnique.mockResolvedValue(DELIVERY);

    await svc.sendCustomerTrackingLink('del-1');

    const message = notifications.sendSMS.mock.calls[0][2] as string;
    expect(message).toContain('https://faida-pos.vercel.app/track/DEL-1755100000000');
    expect(message).not.toContain('localhost');
  });

  it('tolerates a trailing slash on the configured origin', async () => {
    process.env.FRONTEND_URL = 'https://faida-pos.vercel.app/';
    const { svc, prisma } = makeService();
    prisma.deliveryOrder.findUnique.mockResolvedValue(DELIVERY);

    const res = await svc.sendCustomerTrackingLink('del-1');

    expect(res.trackingUrl).toBe(
      'https://faida-pos.vercel.app/track/DEL-1755100000000',
    );
  });

  it('still honours WEB_URL if that is the only one set', async () => {
    delete process.env.FRONTEND_URL;
    process.env.WEB_URL = 'https://faida.example';
    const { svc, prisma } = makeService();
    prisma.deliveryOrder.findUnique.mockResolvedValue(DELIVERY);

    const res = await svc.sendCustomerTrackingLink('del-1');

    expect(res.trackingUrl).toBe('https://faida.example/track/DEL-1755100000000');
  });

  it('never renders "undefined" into the public tracking payload', async () => {
    process.env.FRONTEND_URL = 'https://faida-pos.vercel.app';
    const { svc, prisma } = makeService();
    prisma.deliveryOrder.findUnique.mockResolvedValue({
      ...DELIVERY,
      driverId: null,
      customer: null,
      sale: null,
    });
    prisma.driverLocation.findMany.mockResolvedValue([]);

    const res: any = await svc.getDeliveryTracking('DEL-1755100000000');

    expect(res.trackingUrl).toBe(
      'https://faida-pos.vercel.app/track/DEL-1755100000000',
    );
    expect(res.trackingUrl).not.toContain('undefined');
  });

  it('falls back to localhost only when nothing is configured', async () => {
    delete process.env.FRONTEND_URL;
    delete process.env.WEB_URL;
    const { svc, prisma } = makeService();
    prisma.deliveryOrder.findUnique.mockResolvedValue(DELIVERY);

    const res = await svc.sendCustomerTrackingLink('del-1');

    expect(res.trackingUrl).toBe('http://localhost:3005/track/DEL-1755100000000');
  });
});

describe('DeliveryService — createDeliveryOrder', () => {
  function makeCreateService() {
    const prisma: any = {
      deliveryZone: { findMany: jest.fn().mockResolvedValue([]) },
      deliveryOrder: { create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'del-1', ...data })) },
      deliverySLA: { create: jest.fn() },
    };
    const push = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    const svc = new DeliveryService(
      prisma,
      { createEntry: jest.fn() } as any,
      { sendSMS: jest.fn() } as any,
      push as any,
    );
    return { svc, prisma, push };
  }

  const BASE = {
    businessId: 'biz-1',
    storeId: 'store-1',
    customerName: 'Kev',
    deliveryAddress: 'Westlands',
  };

  it('saves the fee typed on the delivery form', async () => {
    const { svc, prisma } = makeCreateService();

    await svc.createDeliveryOrder({ ...BASE, deliveryFeeCents: 30000 });

    expect(prisma.deliveryOrder.create.mock.calls[0][0].data.deliveryFeeCents).toBe(30000);
  });

  it('still falls back to zone pricing when no fee is typed', async () => {
    const { svc, prisma } = makeCreateService();
    prisma.deliveryZone.findMany.mockResolvedValue([]);

    await svc.createDeliveryOrder({ ...BASE, lat: -1.29, lng: 36.82 });

    // No zone matches, so no fee — but the order is still created.
    expect(prisma.deliveryOrder.create.mock.calls[0][0].data.deliveryFeeCents).toBe(0);
  });

  it('assigns the driver chosen on the form, and notifies them', async () => {
    const { svc, prisma, push } = makeCreateService();

    await svc.createDeliveryOrder({ ...BASE, driverId: 'driver-1' });

    const data = prisma.deliveryOrder.create.mock.calls[0][0].data;
    expect(data.driverId).toBe('driver-1');
    expect(data.status).toBe('ASSIGNED');
    expect(push.sendToUser).toHaveBeenCalledWith('driver-1', expect.objectContaining({
      title: 'New delivery assigned',
    }));
  });

  it('stays PENDING with no driver', async () => {
    const { svc, prisma, push } = makeCreateService();

    await svc.createDeliveryOrder({ ...BASE });

    const data = prisma.deliveryOrder.create.mock.calls[0][0].data;
    expect(data.driverId).toBeNull();
    expect(data.status).toBe('PENDING');
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('ignores a zero or nonsense fee rather than storing it', async () => {
    const { svc, prisma } = makeCreateService();

    await svc.createDeliveryOrder({ ...BASE, deliveryFeeCents: 0 });
    expect(prisma.deliveryOrder.create.mock.calls[0][0].data.deliveryFeeCents).toBe(0);

    await svc.createDeliveryOrder({ ...BASE, deliveryFeeCents: Number('abc') });
    expect(prisma.deliveryOrder.create.mock.calls[1][0].data.deliveryFeeCents).toBe(0);
  });
});
