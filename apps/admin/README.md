# Faida POS — Super Admin Console

React 18 + Vite platform console for the people who run Faida itself — not for
tenants. Tenant staff never see this app.

Dev server: **http://localhost:3012** (proxies `/api` → `http://localhost:3010`).

---

## Run

```bash
npm install
npm run dev          # :3012
npm run build        # tsc + vite build → dist/
npm run preview
```

---

## Login

`POST /api/v1/super-admin/login`, backed by `SUPER_ADMIN_EMAIL` /
`SUPER_ADMIN_PASSWORD` / `SUPER_ADMIN_SECRET` in the API's `.env`. There is no
super-admin row in the seed — set the env vars.

The token is held in `sessionStorage` (`admin-token`), so closing the tab ends the
session. `setAdminToken` / `getAdminToken` / `clearAdminToken` in
[src/lib/api.ts](src/lib/api.ts).

---

## Pages

| Page | What it does |
|---|---|
| `DashboardPage` | Platform-wide totals — businesses, revenue, activity |
| `BusinessesPage` | Every tenant: plan, status, trial, suspend, **gift a plan** |
| `UsersPage` | Cross-tenant user lookup and support actions |
| `AnalyticsPage` | Growth, churn, plan mix |
| `LicenseKeysPage` | Desktop/offline license key issuance |
| `ReferralsPage` | Referral programme payouts |
| `AffiliatesPage` | Affiliate approval, commission rate, payouts |
| `WebhooksPage` | Platform webhook endpoints + delivery log |
| `PlatformSettingsPage` | Global configuration + IP whitelist |
| `SupportPage` | Support queue |
| `HelpPage` | The super-admin guide, rendered in-console |

### The Guide page

`HelpPage` renders `src/generated/superAdminGuide.ts`, which is **generated at build
time** from `docs/super-admin-guide.md` by `scripts/build-docs.sh`. No markdown
renderer at runtime, and it works with no network.

That file is generated — do not edit it. Edit the markdown and rerun the build. It
**is** committed, because the app imports it and CI would otherwise fail to build.

The super-admin guide is deliberately compiled in here rather than published to the
landing site: it documents impersonation, tenant deletion and comping accounts.

### Gifting a plan

`GiftPlanModal` grants a tenant a paid tier without recording revenue — the
subscription is marked **comped** (migration `20260817000000_comped_subscriptions`),
so gifted accounts don't inflate MRR. The flow uses a proper modal, not browser
`prompt()`.

---

## API base — two of them

`src/lib/api.ts` exposes two request helpers:

- `request()` → `${origin}/api/v1/super-admin` — the default for admin endpoints.
- `requestRoot()` → `${origin}/api/v1` — for routes that live outside the
  super-admin controller, e.g. `/affiliate/admin/*`.

Picking the wrong one produces a 404 with a correct-looking path. When
`VITE_API_URL` is set, any trailing `/api`, `/api/v1` or `/api/v1/super-admin` is
stripped down to the bare origin first; when it is unset the base is relative and the
dev proxy (or the hosting rewrite) routes it.

---

## Look

Light Cloud with Faida Blue, the same as the web app. Colours come from
[`design/tokens.json`](../../design/tokens.json) via `npm run tokens`: pages import `C` from
`src/generated/tokens.ts` (no hex in a page; add two hex digits for transparency, `${C.blue}1f`), and
`src/global.css` uses the CSS variables in `src/generated/tokens.css`. Blue, purple, cyan and indigo are all
brand shades; green, amber and red keep their status meaning. No emoji (use a lucide icon). Checked with axe
for contrast, button names and field labels on every page.

---

## Deploy

Static Vite build. Set `ADMIN_URL` on the API to this app's origin — it is part of the
CORS allowlist, and requests from an unlisted origin are denied silently.

---

When you add a console page, a super-admin endpoint, or change how the admin token or
API base works, update this README in the same change.
