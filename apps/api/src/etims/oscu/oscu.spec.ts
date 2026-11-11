import { kraDate, kraDateTime, parseKraDateTime, lineAmounts, invoiceTotals, makeItemCode, stockIoTypeFor, taxIncludedCents, isKraPin } from './oscu-codes';
import { buildSalePayload, buildItemPayload, buildStockIoPayload, buildStockMasterPayload, readSaleReceipt, OscuSaleInput } from './oscu-payloads';
import { OscuClient, OscuError, OscuCallLog } from './oscu-client';

const op = { id: 'user-1', name: 'Wanjiku' };

describe('dates are Kenyan time', () => {
  it('a sale at 00:30 in Nairobi is dated that Nairobi day, not the UTC day before', () => {
    const d = new Date('2026-11-10T21:30:00Z'); // 00:30 EAT on the 11th
    expect(kraDate(d)).toBe('20261111');
    expect(kraDateTime(d)).toBe('20261111003000');
  });
  it('round-trips yyyyMMddHHmmss', () => {
    const d = new Date('2026-07-23T11:30:00Z');
    expect(parseKraDateTime(kraDateTime(d))?.toISOString()).toBe(d.toISOString());
    expect(parseKraDateTime('bad')).toBeNull();
  });
});

describe('VAT the way eTIMS computes it (amounts include VAT)', () => {
  it('16% inside 1,160 is 160', () => {
    expect(taxIncludedCents(116000, 16)).toBe(16000);
    expect(taxIncludedCents(100000, 0)).toBe(0);
  });
  it('a line: supply is qty x price, taxable is what was paid, total equals taxable', () => {
    const a = lineAmounts(2, 58000, 116000, 'B');
    expect(a).toEqual({ supplyCents: 116000, discountCents: 0, taxableCents: 116000, taxCents: 16000, totalCents: 116000 });
  });
  it('a discount is supply minus paid', () => {
    const a = lineAmounts(1, 100000, 90000, 'B');
    expect(a.discountCents).toBe(10000);
    expect(a.taxableCents).toBe(90000);
    expect(a.taxCents).toBe(12414); // 900 x 16/116 = 124.137... rounds half up to 124.14
  });
  it('a price raised at the till never becomes a negative discount', () => {
    const a = lineAmounts(1, 50000, 52000, 'B');
    expect(a.discountCents).toBe(0);
    expect(a.supplyCents).toBe(52000);
  });
  it('8% (E) is supported', () => {
    expect(lineAmounts(1, 10800, 10800, 'E').taxCents).toBe(800);
  });
  it('invoice totals carry all five tax types, their rates, and agree with the lines', () => {
    const t = invoiceTotals([
      { taxType: 'B', amounts: lineAmounts(1, 116000, 116000, 'B') },
      { taxType: 'A', amounts: lineAmounts(1, 5000, 5000, 'A') },
    ]);
    expect(t).toMatchObject({ taxblAmtB: 1160, taxAmtB: 160, taxRtB: 16, taxblAmtA: 50, taxAmtA: 0, taxRtE: 8, totTaxblAmt: 1210, totTaxAmt: 160, totAmt: 1210 });
    expect(Object.keys(t)).toHaveLength(18);
  });
});

describe('sales invoice payload', () => {
  const base: OscuSaleInput = {
    tradeInvoiceNo: 'R-0231', invcNo: 7, confirmedAt: new Date('2026-11-10T09:15:00Z'), pmtTyCd: '01', operator: op,
    lines: [{ itemCd: 'KE2NTU0000001', itemClsCd: '1010101010', name: 'Bamburi Cement 50kg', pkgUnitCd: 'NT', qtyUnitCd: 'U', qty: 6, unitPriceCents: 78000, paidCents: 468000, taxType: 'B' }],
  };
  it('uses KRA field names and formats', () => {
    const p = buildSalePayload(base) as any;
    expect(p).toMatchObject({ invcNo: 7, orgInvcNo: 0, trdInvcNo: 'R-0231', salesTyCd: 'N', rcptTyCd: 'S', salesSttsCd: '02', salesDt: '20261110', cfmDt: '20261110121500', totItemCnt: 1, totAmt: 4680, totTaxAmt: 645.52 });
    expect(p.itemList[0]).toMatchObject({ itemSeq: 1, qty: 6, pkg: 6, prc: 780, splyAmt: 4680, dcAmt: 0, taxTyCd: 'B', taxblAmt: 4680, taxAmt: 645.52, totAmt: 4680 });
    expect(p.receipt.rcptPbctDt).toBe('20261110121500');
    expect(p).toMatchObject({ regrId: 'user-1', regrNm: 'Wanjiku' });
  });
  it('a credit note takes a new invoice number and points at the original', () => {
    const p = buildSalePayload({ ...base, invcNo: 9, orgInvcNo: 7, creditNote: { reason: '06' } }) as any;
    expect(p).toMatchObject({ rcptTyCd: 'R', invcNo: 9, orgInvcNo: 7, rfdRsnCd: '06' });
    expect(p.rfdDt).toMatch(/^\d{14}$/);
  });
  it('refuses what KRA would refuse', () => {
    expect(() => buildSalePayload({ ...base, invcNo: 0 })).toThrow(/invcNo/);
    expect(() => buildSalePayload({ ...base, creditNote: { reason: '06' } })).toThrow(/credits/);
    expect(() => buildSalePayload({ ...base, orgInvcNo: 7, creditNote: { reason: '06' } })).toThrow(/own invoice number/);
    expect(() => buildSalePayload({ ...base, lines: [{ ...base.lines[0], itemClsCd: '' }] })).toThrow(/item class/);
  });
  it('reads the signed receipt, even with stray spaces in KRA keys', () => {
    expect(readSaleReceipt({ 'curRcptNo ': '12', totRcptNo: 40, intrlData: 'ABC', rcptSign: 'SIGN1', sdcDateTime: '20261110121501' }))
      .toEqual({ curRcptNo: 12, totRcptNo: 40, intrlData: 'ABC', rcptSign: 'SIGN1', sdcDateTime: '20261110121501' });
  });
});

describe('items and stock', () => {
  it('item codes follow KRA pattern', () => {
    expect(makeItemCode('2', 'NT', 'U', 12)).toBe('KE2NTU0000012');
    expect(() => makeItemCode('2', 'NT', 'U', 0)).toThrow();
  });
  it('item payload', () => {
    const p = buildItemPayload({ itemCd: 'KE2NTU0000001', itemClsCd: '1010101010', productType: '2', name: 'Cement', pkgUnitCd: 'NT', qtyUnitCd: 'U', taxType: 'B', defaultPriceCents: 78000, groupPricesCents: [75000, 74000], operator: op }) as any;
    expect(p).toMatchObject({ itemTyCd: '2', orgnNatCd: 'KE', dftPrc: 780, grpPrcL1: 750, grpPrcL2: 740, grpPrcL3: null, useYn: 'Y', isrcAplcbYn: 'N' });
    expect(() => buildItemPayload({ itemCd: 'X', itemClsCd: '', productType: '2', name: 'Cement', pkgUnitCd: 'NT', qtyUnitCd: 'U', taxType: 'B', defaultPriceCents: 1, operator: op })).toThrow(/item class/);
  });
  it('maps our ledger movements to KRA stock types', () => {
    expect(stockIoTypeFor('GRN_RECEIPT', 10)).toBe('02');
    expect(stockIoTypeFor('SALE', -2)).toBe('11');
    expect(stockIoTypeFor('DAMAGED', -1)).toBe('15');
    expect(stockIoTypeFor('ADJUSTMENT', -3)).toBe('16');
    expect(stockIoTypeFor('ADJUSTMENT', 3)).toBe('06');
    expect(stockIoTypeFor('TRANSFER', -4)).toBe('13');
    expect(stockIoTypeFor('INITIAL', 50)).toBe('06');
  });
  it('stock in/out payload uses positive quantities and sums its lines', () => {
    const p = buildStockIoPayload({ sarNo: 3, sarTyCd: '11', occurredAt: new Date('2026-11-10T09:00:00Z'), operator: op,
      lines: [{ itemCd: 'KE2NTU0000001', itemClsCd: '1010101010', name: 'Cement', pkgUnitCd: 'NT', qtyUnitCd: 'U', qty: -2, unitPriceCents: 58000, taxType: 'B' }] }) as any;
    expect(p).toMatchObject({ sarNo: 3, orgSarNo: 0, regTyCd: 'M', sarTyCd: '11', ocrnDt: '20261110', totItemCnt: 1, totAmt: 1160, totTaxAmt: 160 });
    expect(p.itemList[0]).toMatchObject({ qty: 2, splyAmt: 1160, taxblAmt: 1160, taxAmt: 160 });
    expect(buildStockMasterPayload('KE2NTU0000001', 12.345, op)).toMatchObject({ itemCd: 'KE2NTU0000001', rsdQty: 12.35 });
  });
  it('checks KRA PINs', () => {
    expect(isKraPin('P051234567A')).toBe(true);
    expect(isKraPin('12345')).toBe(false);
  });
});

describe('OSCU client', () => {
  const identity = { tin: 'P051234567A', bhfId: '00', cmcKey: 'SECRET-KEY' };
  const respond = (status: number, body: unknown) => jest.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

  it('sends tin, bhfId and cmcKey as headers and in the body, and logs without the key', async () => {
    const fetchImpl = respond(200, { resultCd: '000', data: { rcptSign: 'S1' } });
    const logs: OscuCallLog[] = [];
    const c = new OscuClient({ environment: 'sandbox', fetchImpl: fetchImpl as any, onCall: (l) => { logs.push(l); } });
    const env = await c.call(identity, '/saveTrnsSalesOsdc', { invcNo: 1 });
    expect(env.data.rcptSign).toBe('S1');
    const [url, init] = fetchImpl.mock.calls[0] as any;
    expect(url).toBe('https://etims-api-sbx.kra.go.ke/etims-api/saveTrnsSalesOsdc');
    expect(init.headers).toMatchObject({ tin: 'P051234567A', bhfId: '00', cmcKey: 'SECRET-KEY' });
    expect(JSON.parse(init.body)).toMatchObject({ tin: 'P051234567A', cmcKey: 'SECRET-KEY', invcNo: 1 });
    expect(JSON.stringify(logs[0].request)).not.toContain('SECRET-KEY');
    expect(logs[0]).toMatchObject({ ok: true, resultCd: '000' });
  });
  it('"001" (no search result) is an empty answer, not an error', async () => {
    const c = new OscuClient({ environment: 'sandbox', fetchImpl: respond(200, { resultCd: '001' }) as any });
    await expect(c.call(identity, '/selectItemList', {})).resolves.toMatchObject({ resultCd: '001' });
  });
  it.each([
    [{ resultCd: '921', resultMsg: 'declared' }, 'duplicate', false],
    [{ resultCd: '910', resultMsg: 'param' }, 'rejected', false],
    [{ resultCd: '901' }, 'device', false],
    [{ resultCd: '999' }, 'unavailable', true],
  ])('result %j is a %s error (retryable: %s)', async (body, kind, retryable) => {
    const c = new OscuClient({ environment: 'sandbox', fetchImpl: respond(200, body) as any });
    const err = await c.call(identity, '/x', {}).catch((e) => e);
    expect(err).toBeInstanceOf(OscuError);
    expect(err.kind).toBe(kind);
    expect(err.retryable).toBe(retryable);
  });
  it('a dropped connection or a KRA 503 is "unavailable" (retry later)', async () => {
    const down = new OscuClient({ environment: 'sandbox', fetchImpl: jest.fn(async () => { throw new Error('ECONNRESET'); }) as any });
    expect((await down.call(identity, '/x', {}).catch((e) => e)).kind).toBe('unavailable');
    const busy = new OscuClient({ environment: 'sandbox', fetchImpl: respond(503, 'Service Unavailable') as any });
    expect((await busy.call(identity, '/x', {}).catch((e) => e)).kind).toBe('unavailable');
  });
  it('initialises a device and reads its communication key', async () => {
    const c = new OscuClient({ environment: 'production', fetchImpl: respond(200, { resultCd: '000', data: { info: { cmcKey: 'K1', tradeNm: 'Shop' } } }) as any });
    await expect(c.initDevice('P051234567A', '00', 'SERIAL1')).resolves.toMatchObject({ cmcKey: 'K1' });
  });
  it('builds the QR link from PIN + branch + signature', () => {
    const c = new OscuClient({ environment: 'production' });
    expect(c.qrUrl('P051234567A', '00', 'AB/C')).toBe('https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=P051234567A00AB%2FC');
  });
});
