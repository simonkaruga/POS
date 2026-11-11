import { EtimsRetryService } from './etims-retry.service';

const NOW = new Date('2026-11-05T12:00:00.000Z');

function setup(ids = ['s1', 's2', 's3']) {
  const prisma: any = { business: { findMany: jest.fn().mockResolvedValue([{ id: 'b1' }]) }, sale: { findMany: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))) }, return: { findMany: jest.fn().mockResolvedValue([]) } };
  const etims: any = { submitSale: jest.fn().mockResolvedValue({ success: true }) };
  return { prisma, etims, svc: new EtimsRetryService(prisma, etims) };
}

describe('EtimsRetryService', () => {
  it('asks only for unsent sales of production businesses, not too fresh and not too old, oldest first', async () => {
    const { svc, prisma } = setup();
    await svc.retryPending(NOW);
    const q = prisma.sale.findMany.mock.calls[0][0];
    expect(q.where).toEqual({
      businessId: { in: ['b1'] },
      etimsSubmitted: false,
      etimsNeedsAttention: false,
      status: { in: ['PAID', 'CREDIT'] },
      createdAt: { gte: new Date('2026-10-29T12:00:00.000Z'), lte: new Date('2026-11-05T11:55:00.000Z') },
    });
    expect(prisma.business.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { etimsMode: 'PRODUCTION', etimsCredentialsEncrypted: { not: null } } }));
    expect(q.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('does nothing when no business sends real invoices', async () => {
    const { svc, prisma } = setup();
    prisma.business.findMany.mockResolvedValue([]);
    expect(await svc.retryPending(NOW)).toEqual({ tried: 0, submitted: 0, failed: 0 });
    expect(prisma.sale.findMany).not.toHaveBeenCalled();
  });

  it('submits each, and counts a failure without stopping the rest', async () => {
    const { svc, etims } = setup();
    etims.submitSale.mockRejectedValueOnce(new Error('KRA down'));
    expect(await svc.retryPending(NOW)).toEqual({ tried: 3, submitted: 2, failed: 1 });
    expect(etims.submitSale).toHaveBeenCalledTimes(3);
  });

  it('gives up the pass when KRA keeps refusing', async () => {
    const { svc, etims } = setup(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    etims.submitSale.mockRejectedValue(new Error('KRA down'));
    const r = await svc.retryPending(NOW);
    expect(r.failed).toBe(5);
    expect(etims.submitSale).toHaveBeenCalledTimes(5);
  });

  it('does not run two passes at once, and never throws', async () => {
    const { svc, prisma } = setup();
    let release!: () => void;
    prisma.sale.findMany.mockReturnValue(new Promise((r) => { release = () => r([]); }));
    const first = svc.sweep();
    expect(await svc.sweep()).toEqual({ tried: 0, submitted: 0, failed: 0 });
    release();
    await first;
    prisma.sale.findMany.mockRejectedValue(new Error('db down'));
    await expect(svc.sweep()).resolves.toEqual({ tried: 0, submitted: 0, failed: 0 });
  });
});
