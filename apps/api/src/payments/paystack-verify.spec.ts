import { PaymentsController } from './payments.controller';

/**
 * Card verification must fail CLOSED.
 *
 * This endpoint answered `verified: true` when no secret key was configured and
 * again in its catch block, so a timeout or a bad response marked the sale paid.
 * The only other check is Paystack's own success callback, which runs in the
 * browser and can be triggered from devtools — meaning nothing stood between a
 * crafted call and goods leaving the counter. Production ran with
 * PAYSTACK_SECRET_KEY unset, so the first branch was live.
 */
function makeController(business: Record<string, unknown> | null = { paystackPublicKey: 'pk_x', shortCode: 'ABC' }) {
  const prisma: any = {
    business: { findUnique: jest.fn().mockResolvedValue(business) },
    customer: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  return new PaymentsController({} as any, {} as any, prisma);
}

const REF = 'POS-123';
const ORIGINAL_KEY = process.env.PAYSTACK_SECRET_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = ORIGINAL_KEY;
  jest.restoreAllMocks();
});

describe('PaymentsController.verifyPaystack', () => {
  it('refuses when no secret key is configured', async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const res: any = await makeController().verifyPaystack({ reference: REF, businessId: 'b1' });
    expect(res.verified).toBe(false);
    expect(res.status).toBe('unconfigured');
  });

  it('refuses when Paystack cannot be reached', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test';
    jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('ETIMEDOUT'));
    const res: any = await makeController().verifyPaystack({ reference: REF, businessId: 'b1' });
    expect(res.verified).toBe(false);
    expect(res.status).toBe('unverified');
  });

  it('refuses on a non-2xx from Paystack', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test';
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, status: 401 } as any);
    const res: any = await makeController().verifyPaystack({ reference: REF, businessId: 'b1' });
    expect(res.verified).toBe(false);
  });

  it('refuses when the transaction did not succeed', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test';
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true, json: async () => ({ status: true, data: { status: 'abandoned' } }),
    } as any);
    const res: any = await makeController().verifyPaystack({ reference: REF, businessId: 'b1' });
    expect(res.verified).toBe(false);
    expect(res.status).toBe('abandoned');
  });

  it('accepts only a genuine Paystack success', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test';
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true, json: async () => ({ status: true, data: { status: 'success', amount: 140000 } }),
    } as any);
    const res: any = await makeController().verifyPaystack({ reference: REF, businessId: 'b1' });
    expect(res.verified).toBe(true);
    expect(res.amountCents).toBe(140000);
  });
});

describe('PaymentsController.paystackConfig', () => {
  it("bills the customer's own address when there is one", async () => {
    const c = makeController();
    (c as any).prisma.customer.findUnique.mockResolvedValue({ email: 'grace@example.co.ke' });
    const res: any = await c.paystackConfig('b1', 'cust-1');
    expect(res.payerEmail).toBe('grace@example.co.ke');
  });

  it('falls back to a per-business address, never a fake one', async () => {
    const res: any = await makeController().paystackConfig('b1');
    // The old value was customer@pos.local — one fake address, invalid TLD,
    // shared by every card sale.
    expect(res.payerEmail).not.toContain('pos.local');
    expect(res.payerEmail).toBe('pos-abc@faidapos.co.ke');
  });
});
