import { EtimsOscuService, encrypt } from './etims-oscu.service';
import { OscuError } from './oscu-client';

/**
 * The live KRA path, against an in-memory database and a fake KRA. What matters here is what KRA would see:
 * gapless invoice numbers, items registered before they are sold, the same number on a retry, a number handed back
 * when KRA refuses an invoice, credit notes pointing at the original, and stock reported only after its sale.
 */

const creds = { version: 2, tin: 'P051234567A', bhfId: '00', dvcSrlNo: 'DVC1', cmcKey: 'KEY', sdcId: 'KRACU0100000001', tradeNm: 'Sir Tonny Hardware' };

function world() {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  const business: any = { id: 'b1', name: 'Sir Tonny', etimsMode: 'PRODUCTION', etimsCredentialsEncrypted: encrypt(creds), etimsInvcSeq: 0, etimsSarSeq: 0, etimsItemSeq: 0, etimsDefaultItemClsCd: null, etimsLiveSince: new Date('2026-11-01T00:00:00Z') };
  const items: any[] = [{ id: 'i1', businessId: 'b1', name: 'Bamburi Cement 50kg', type: 'PRODUCT', trackStock: true, retailPriceCents: 78000, wholesalePriceCents: 75000, vipPriceCents: null, costPriceCents: 69000, taxClass: 'B', barcode: '616400', kraItemCode: '3011150101', isActive: true, deletedAt: null, etimsItemCd: null, etimsRegisteredAt: null, updatedAt: new Date('2026-11-01T00:00:00Z') }];
  const sales: any[] = [];
  const saleItems: any[] = [];
  const movements: any[] = [];
  const logs: any[] = [];
  const pick = (o: any, data: any) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as any)) o[k] = (o[k] ?? 0) + (v as any).increment;
      else o[k] = v;
    }
    return o;
  };
  const prisma: any = {
    business: {
      findUnique: async () => business,
      findMany: async () => [business],
      update: async ({ data }: any) => pick(business, data),
      updateMany: async ({ where, data }: any) => {
        const ok = Object.entries(where).every(([k, v]) => k === 'id' || business[k] === v);
        if (ok) pick(business, data);
        return { count: ok ? 1 : 0 };
      },
    },
    item: {
      findMany: async ({ where }: any) => items.filter((i) => where.id.in.includes(i.id)),
      findUnique: async ({ where }: any) => items.find((i) => i.id === where.id),
      update: async ({ where, data }: any) => { const i = items.find((x) => x.id === where.id); pick(i, data); if (!('etimsRegisteredAt' in data)) i.updatedAt = new Date(); return i; },
    },
    sale: {
      findUnique: async ({ where }: any) => {
        const s = sales.find((x) => x.id === where.id);
        return s && { ...s, items: saleItems.filter((si) => si.saleId === s.id).map((si) => ({ ...si, item: items.find((i) => i.id === si.itemId) })), payments: [{ method: 'MPESA', amountCents: s.totalCents }], customer: null };
      },
      update: async ({ where, data }: any) => pick(sales.find((x) => x.id === where.id), data),
    },
    saleItem: { findMany: async ({ where }: any) => saleItems.filter((si) => si.saleId === where.saleId).map((si) => ({ ...si, item: items.find((i) => i.id === si.itemId) })) },
    inventoryMovement: {
      findMany: async () => movements.filter((m) => !m.etimsReportedAt).map((m) => ({ ...m, item: items.find((i) => i.id === m.itemId), sale: m.saleId ? { etimsSubmitted: !!sales.find((s) => s.id === m.saleId)?.etimsSubmitted } : null })),
      update: async ({ where, data }: any) => pick(movements.find((m) => m.id === where.id), data),
      aggregate: async () => ({ _sum: { quantity: movements.reduce((t, m) => t + m.quantity, 0) } }),
    },
    etimsCallLog: { create: async ({ data }: any) => { logs.push(data); return data; } },
  };
  const addSale = (id: string, qty = 6) => {
    sales.push({ id, businessId: 'b1', receiptNumber: `R-${id}`, createdAt: new Date('2026-11-10T09:00:00Z'), totalCents: qty * 78000, type: 'NORMAL', etimsSubmitted: false, etimsInvcNo: null, etimsAttempts: 0 });
    saleItems.push({ id: `${id}-l1`, saleId: id, itemId: 'i1', name: 'Bamburi Cement 50kg', quantity: qty, unitPriceCents: 78000, totalCents: qty * 78000, discountCents: 0, vatCents: 0, taxClass: 'B' });
  };
  const kra = { calls: [] as Array<{ path: string; body: any }>, answers: [] as any[] };
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    const path = new URL(url).pathname.replace('/etims-api', '');
    const body = JSON.parse(init.body);
    kra.calls.push({ path, body });
    const next = kra.answers.shift();
    if (next instanceof Error) throw next;
    const answer = next ?? { resultCd: '000', data: path === '/saveTrnsSalesOsdc' ? { curRcptNo: body.invcNo, rcptSign: `SIGN${body.invcNo}`, intrlData: `INT${body.invcNo}`, sdcDateTime: '20261110120000' } : {} };
    return new Response(JSON.stringify(answer), { status: 200 });
  });
  return { svc: new EtimsOscuService(prisma), business, items, sales, movements, kra, logs, addSale };
}

describe('EtimsOscuService', () => {
  it('registers the item first, then signs the sale as KRA invoice 1, and keeps KRA receipt details', async () => {
    const w = world();
    w.addSale('s1');
    const signed = await w.svc.submitSale('s1');
    expect(w.kra.calls.map((c) => c.path)).toEqual(['/saveItem', '/saveTrnsSalesOsdc']);
    expect(w.kra.calls[0].body).toMatchObject({ itemCd: 'KE2NTU0000001', itemClsCd: '3011150101', dftPrc: 780, grpPrcL1: 750 });
    expect(w.kra.calls[1].body).toMatchObject({ invcNo: 1, rcptTyCd: 'S', pmtTyCd: '06', totAmt: 4680, cmcKey: 'KEY' });
    expect(signed).toMatchObject({ invcNo: 1, controlNumber: 'KRACU0100000001/1', rcptSign: 'SIGN1' });
    expect(signed.qrUrl).toContain('Data=P051234567A00SIGN1');
    expect(w.sales[0]).toMatchObject({ etimsSubmitted: true, etimsInvcNo: 1, etimsRcptSign: 'SIGN1', etimsNeedsAttention: false });
    expect(w.logs).toHaveLength(2);
    expect(JSON.stringify(w.logs)).not.toContain('"KEY"');
  });

  it('numbers invoices 1, 2, 3 and registers an item only once', async () => {
    const w = world();
    ['a', 'b', 'c'].forEach((id) => w.addSale(id));
    for (const id of ['a', 'b', 'c']) await w.svc.submitSale(id);
    expect(w.kra.calls.filter((c) => c.path === '/saveTrnsSalesOsdc').map((c) => c.body.invcNo)).toEqual([1, 2, 3]);
    expect(w.kra.calls.filter((c) => c.path === '/saveItem')).toHaveLength(1);
  });

  it('when KRA is unreachable, the sale keeps its number and the retry sends the same number', async () => {
    const w = world();
    w.addSale('s1');
    w.kra.answers.push({ resultCd: '000' }); // saveItem
    w.kra.answers.push(new Error('ECONNRESET'));
    const err = await w.svc.submitSale('s1').catch((e) => e);
    expect(err).toBeInstanceOf(OscuError);
    expect(err.retryable).toBe(true);
    expect(w.sales[0]).toMatchObject({ etimsSubmitted: false, etimsInvcNo: 1 });
    expect(w.sales[0].etimsNeedsAttention).toBeFalsy();
    await w.svc.submitSale('s1');
    expect(w.kra.calls.filter((c) => c.path === '/saveTrnsSalesOsdc').map((c) => c.body.invcNo)).toEqual([1, 1]);
    expect(w.business.etimsInvcSeq).toBe(1);
  });

  it('when KRA refuses the invoice, the number is handed back so the next sale leaves no gap', async () => {
    const w = world();
    w.addSale('bad');
    w.addSale('good');
    w.kra.answers.push({ resultCd: '000' }, { resultCd: '910', resultMsg: 'Request parameter error' });
    const err = await w.svc.submitSale('bad').catch((e) => e);
    expect(err.kind).toBe('rejected');
    expect(w.sales[0]).toMatchObject({ etimsNeedsAttention: true, etimsInvcNo: null });
    expect(w.sales[0].etimsLastError).toContain('910');
    await w.svc.submitSale('good');
    expect(w.kra.calls.at(-1)!.body.invcNo).toBe(1);
  });

  it('an item without a KRA class stops before any number is spent or anything is sent', async () => {
    const w = world();
    w.items[0].kraItemCode = null;
    w.addSale('s1');
    const err = await w.svc.submitSale('s1').catch((e) => e);
    expect(err.message).toMatch(/KRA item class/);
    expect(w.kra.calls).toHaveLength(0);
    expect(w.business.etimsInvcSeq).toBe(0);
    expect(w.sales[0].etimsNeedsAttention).toBe(true);
    expect(w.items[0].etimsRegisterError).toMatch(/item class/);
  });

  it('the business default class covers items without their own', async () => {
    const w = world();
    w.items[0].kraItemCode = null;
    w.business.etimsDefaultItemClsCd = '5020230602';
    w.addSale('s1');
    await w.svc.submitSale('s1');
    expect(w.kra.calls[0].body.itemClsCd).toBe('5020230602');
  });

  it('"already declared" (921) means KRA has it: the sale counts as signed', async () => {
    const w = world();
    w.addSale('s1');
    w.kra.answers.push({ resultCd: '000' }, { resultCd: '921', resultMsg: 'declared' });
    const signed = await w.svc.submitSale('s1');
    expect(signed.invcNo).toBe(1);
    expect(w.sales[0].etimsSubmitted).toBe(true);
  });

  it('a credit note takes the next number and points at the original invoice', async () => {
    const w = world();
    w.addSale('s1');
    await w.svc.submitSale('s1');
    const cn = await w.svc.creditNote('s1', null, '06');
    const body = w.kra.calls.at(-1)!.body;
    expect(body).toMatchObject({ rcptTyCd: 'R', invcNo: 2, orgInvcNo: 1, rfdRsnCd: '06', trdInvcNo: 'R-s1-CN' });
    expect(cn.invcNo).toBe(2);
  });

  it('reports stock after its sale is signed, and sends the level that remains', async () => {
    const w = world();
    w.addSale('s1');
    const old = new Date(Date.now() - 10 * 60_000);
    w.movements.push({ id: 'm0', businessId: 'b1', itemId: 'i1', type: 'GRN_RECEIPT', quantity: 50, saleId: null, createdAt: old, source: 'grn' });
    w.movements.push({ id: 'm1', businessId: 'b1', itemId: 'i1', type: 'SALE', quantity: -6, saleId: 's1', createdAt: old, source: 'pos' });
    let r = await w.svc.reportStock(w.business);
    expect(r.reported).toBe(1); // the delivery; the sale waits for its invoice
    const io = w.kra.calls.find((c) => c.path === '/insertStockIO')!.body;
    expect(io).toMatchObject({ sarNo: 1, sarTyCd: '02', totItemCnt: 1 });
    expect(io.itemList[0]).toMatchObject({ qty: 50, prc: 690 });
    expect(w.kra.calls.find((c) => c.path === '/saveStockMaster')!.body).toMatchObject({ rsdQty: 44 });
    await w.svc.submitSale('s1');
    r = await w.svc.reportStock(w.business);
    expect(r.reported).toBe(1);
    expect(w.kra.calls.filter((c) => c.path === '/insertStockIO').at(-1)!.body).toMatchObject({ sarNo: 2, sarTyCd: '11' });
  });

  it('a business with old credentials (no communication key) is not live', () => {
    const w = world();
    expect(w.svc.isLive({ etimsMode: 'PRODUCTION', etimsCredentialsEncrypted: encrypt({ kraPin: 'P051234567A', deviceId: 'x' }) })).toBe(false);
    expect(w.svc.isLive({ etimsMode: 'SANDBOX', etimsCredentialsEncrypted: w.business.etimsCredentialsEncrypted })).toBe(false);
    expect(w.svc.isLive(w.business)).toBe(true);
  });
});
