import { AffiliateService } from './affiliate.service';

/**
 * The referral link is the one URL an affiliate copies out of the portal and
 * posts publicly. It used to be built in the browser from window.location.origin,
 * so an affiliate who opened the portal on a fallback host (the app is reachable
 * on both the custom domain and its *.vercel.app origin) would share a link
 * pinned to that host — permanently, in other people's posts. It is now built
 * server-side from FRONTEND_URL so there is one canonical answer.
 */
describe('AffiliateService — referral links', () => {
  const ORIGINAL = process.env.FRONTEND_URL;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = ORIGINAL;
  });

  it('builds the link from FRONTEND_URL, not the requesting host', () => {
    process.env.FRONTEND_URL = 'https://app.pos.faida.co.ke';
    expect(AffiliateService.referralUrl('AFF-K3M9QX'))
      .toBe('https://app.pos.faida.co.ke/?mode=register&aff=AFF-K3M9QX');
  });

  it('tolerates a trailing slash on the configured origin', () => {
    process.env.FRONTEND_URL = 'https://app.pos.faida.co.ke/';
    expect(AffiliateService.referralUrl('AFF-K3M9QX'))
      .toBe('https://app.pos.faida.co.ke/?mode=register&aff=AFF-K3M9QX');
  });

  it('never renders "undefined" into a link customers will click', () => {
    delete process.env.FRONTEND_URL;
    expect(AffiliateService.referralUrl('AFF-K3M9QX')).not.toContain('undefined');
  });

  it('falls back to localhost only when nothing is configured', () => {
    delete process.env.FRONTEND_URL;
    expect(AffiliateService.referralUrl('AFF-K3M9QX'))
      .toBe('http://localhost:3005/?mode=register&aff=AFF-K3M9QX');
  });
});
