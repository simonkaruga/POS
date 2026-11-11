# Faida POS — Enterprise Point of Sale for Kenya

Offline-first, KRA eTIMS-compliant point of sale built for Kenyan businesses — retail,
hospitality, hotels, pharmacies, fuel stations, cyber cafés, supermarkets, and field
sales/distribution.

One backend serves **nine apps**: a web PWA, a super-admin console, a Tauri desktop
build, a static landing site, and four Expo mobile apps (cashier, customer, driver,
field agent).

---

## Contents

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Ports](#ports)
- [Project structure](#project-structure)
- [Plans & feature gating](#plans--feature-gating)
- [Feature map](#feature-map)
- [Environment variables](#environment-variables)
- [Testing & CI](#testing--ci)
- [Deployment](#deployment)
- [Per-app documentation](#per-app-documentation)
- [Conventions that bite](#conventions-that-bite)

---

## Architecture

```
                        ┌──────────────────────────────┐
                        │  apps/api  (NestJS, :3010)   │
                        │  /api/v1/*  ·  Prisma 5      │
                        └───────────────┬──────────────┘
                                        │  PostgreSQL 16
        ┌───────────────┬───────────────┼───────────────┬────────────────┐
        │               │               │               │                │
   apps/web        apps/admin      apps/desktop     4 × Expo apps    apps/landing
   React PWA       Super admin     Tauri v2 shell   pos / customer   static HTML
   :3005           :3012           (bundles         driver / agent   marketing +
                                   web/dist)                          manual
```

- **Single source of truth** for the schema: `prisma/schema.prisma` (151 models).
- **Offline-first everywhere**: web uses Dexie/IndexedDB, desktop uses SQLite, mobile
  uses AsyncStorage queues. Every offline-creatable record carries an `offlineId`
  (UUID) so a replayed request is deduplicated server-side instead of double-posting.
- **Multi-tenant**: every endpoint is scoped by `businessId` via `TenantGuard`.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | NestJS 10 · Prisma 5 · PostgreSQL 16 |
| Web | React 18 · TypeScript · Vite 5 · Tailwind CSS · vite-plugin-pwa (Workbox) |
| Admin | React 18 · Vite 5 |
| Desktop | Tauri v2 (Rust) — wraps `apps/web/dist` |
| Mobile | Expo (expo-router) · React Native — 4 apps |
| Landing | Static HTML (no build step) |
| State | Zustand + TanStack Query v5 |
| Offline | Dexie (web) · SQLite (desktop) · AsyncStorage (mobile) |
| Queue | BullMQ + Redis (optional — falls back to synchronous) |
| Auth | JWT · PIN sessions · TOTP · Google OAuth · phone-OTP (customer portal) |
| Payments | M-Pesa STK/QR · Paystack card · split · gift cards · bank transfer · cheque |
| Fiscal | KRA eTIMS (sandbox + production) · VAT/TOT · VSCU offline queue |
| Notifications | Resend (email) · Africa's Talking (SMS/WhatsApp) · Expo push |
| Errors | Sentry (optional) |

**Package manager: npm.** The repo uses npm workspaces (`package-lock.json` at the
root). The four mobile apps are *outside* the workspace and each keeps its own
`package-lock.json` — install them individually.

---

## Quick start

### Prerequisites

- Node.js 20+ (CI builds on 22; `.node-version` pins the local version)
- PostgreSQL 16+
- Redis — optional, only for background job queues
- Rust toolchain — only if you build the desktop app
- Expo CLI / Android SDK — only if you build mobile apps

### 1. Install dependencies

```bash
npm install
npm run install-all                                        # api + web + admin
npx prisma generate --schema prisma/schema.prisma          # from the repo ROOT
```

> `npm run setup` passes `--schema ../../prisma/schema.prisma` to `prisma generate` (it used to fail with "Could not find a schema").

Every Prisma command in this repo needs an explicit
`--schema` pointing at `prisma/schema.prisma`.

### 2. Create the database

```bash
sudo -u postgres psql << 'EOF'
CREATE DATABASE faida_pos;
CREATE USER faida WITH PASSWORD '<your_secure_password>';
GRANT ALL PRIVILEGES ON DATABASE faida_pos TO faida;
ALTER DATABASE faida_pos OWNER TO faida;
\c faida_pos
GRANT ALL ON SCHEMA public TO faida;
ALTER USER faida CREATEDB;
EOF
```

### 3. Configure environment

```bash
cp apps/api/.env.example apps/api/.env    # then edit
```

The only change required for local dev is `DATABASE_URL`. Generate the two secrets:

```bash
openssl rand -base64 32     # JWT_SECRET
openssl rand -hex 32        # ENCRYPTION_KEY  (must be exactly 64 hex chars)
```

### 4. Migrate + seed

To rehearse migrations without touching Supabase, run a throwaway local Postgres and point both URLs at it
(the Supabase image has the same `anon` / `authenticated` roles, so the RLS lock-down migration is exercised too):

```bash
docker run -d --name pos-pg-local -e POSTGRES_PASSWORD=your-password-here -p 54329:5432 public.ecr.aws/supabase/postgres:17.6.1.054
export DATABASE_URL="postgresql://postgres:your-password-here@localhost:54329/postgres"
export DIRECT_URL="$DATABASE_URL"
npx prisma migrate deploy --schema prisma/schema.prisma   # confirm the "Datasource" line says localhost first
```

```bash
cd apps/api
npx prisma migrate deploy --schema ../../prisma/schema.prisma
# Light seed — upserts a business, store, 5 users, sample items/tables/customers.
# Safe to re-run; does not delete anything.
npx ts-node src/seed.ts

# Full demo dataset (sales history, hotel rooms, suppliers, …).
# WARNING: deletes existing data first.
npx ts-node ../../prisma/seed.ts
```

After `20261105100000_fractional_quantities` has been applied to a database that already holds sales of loose
goods, review and repair the rows the old integer columns rounded:
`prisma/repairs/20261105_fractional_quantities.sql` (the report runs first; the UPDATE is commented out).

### 5. Run

```bash
npm run dev            # API + Web
npm run dev:all        # API + Web + Admin
./start.sh             # all of the above + migrations + Tauri desktop
```

Individually:

```bash
npm run dev:api        # NestJS  → http://localhost:3010
npm run dev:web        # Vite    → http://localhost:3005
npm run dev:admin      # Vite    → http://localhost:3012
```

> **Linux `ENOSPC` on Vite start** — raise the inotify watcher limit:
> ```bash
> sudo sysctl -w fs.inotify.max_user_watches=524288
> echo 'fs.inotify.max_user_watches=524288' | sudo tee -a /etc/sysctl.conf
> ```
> (`apps/web` already falls back to polling, so this mainly affects `apps/admin`.)

### 6. Log in

Seed credentials are printed by the seed script and defined in
[apps/api/src/seed.ts](apps/api/src/seed.ts) — five users spanning
OWNER / MANAGER / CASHIER / WAITER / KITCHEN, each with an email+password login and a
PIN. Super-admin credentials come from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`
in `.env`.

Seed data is for local development only. Never reuse those values in a deployed
environment.

---

## Ports

| Service | Port | URL |
|---|---|---|
| API (NestJS) | 3010 | http://localhost:3010/api/v1 |
| API Swagger | 3010 | http://localhost:3010/api/docs |
| API health | 3010 | http://localhost:3010/api/v1/health |
| Web PWA | 3005 | http://localhost:3005 |
| Admin console | 3012 | http://localhost:3012 |
| Desktop (Tauri) | 3013 | native window |

Web and Admin both proxy `/api` → `http://localhost:3010` in dev, so the browser
clients call the relative base `/api/v1` and need no `VITE_API_URL`.

---

## Project structure

```
pos/
├── apps/
│   ├── api/             # NestJS backend — 60+ feature modules       (:3010)
│   ├── web/             # React PWA — the main POS + back office     (:3005)
│   ├── admin/           # Super-admin console (tenants, billing)     (:3012)
│   ├── desktop/         # Tauri v2 shell — bundles apps/web/dist
│   ├── landing/         # Static marketing site + HTML user manual
│   ├── mobile-pos/      # Expo — cashier / manager app
│   ├── mobile-customer/ # Expo — self-service ordering
│   ├── mobile-driver/   # Expo — delivery driver
│   └── mobile-agent/    # Expo — field sales agent
├── packages/
│   ├── shared/          # Shared types, enums, formatKES(), VAT/TOT helpers
│   ├── print-core/      # One receipt/KOT/bill layout -> ESC/POS, HTML, Star, Epson (web + mobile)
│   └── mobile-push/     # Shared Expo push registration used by all 4 apps
├── prisma/
│   ├── schema.prisma    # 151 models — single source of truth
│   ├── seed.ts          # Full demo dataset (destructive)
│   └── migrations/      # Migration history (consolidated base: 20260314000000_init)
├── scripts/             # Build helpers (render-build.sh, …)
├── .github/workflows/   # ci.yml · desktop-release.yml · mobile-release.yml
├── render.yaml          # API deployment blueprint (Render)
├── claude.md            # Engineering rules / coding standards
└── start.sh             # One-command dev launcher
```

---

## Plans & feature gating

Five tiers, ranked `FREE < STARTER < GROWTH < PRO < ENTERPRISE`. The map lives in
[apps/web/src/lib/featureGates.ts](apps/web/src/lib/featureGates.ts) and drives both
sidebar filtering and page-level gates.

| Plan | KES/mo | Stores | Users | Unlocks (examples) |
|---|---:|---:|---:|---|
| Free | 0 | 1 | 1 | POS, inventory, customers, sales list, cash drawer |
| Starter | 999 | 1 | 8 | Reports, batches, settings, receipt customization |
| Growth | 2,499 | 2 | 15 | Hospitality, KDS, pharmacy, delivery, suppliers, promotions, gift cards |
| Pro | 4,999 | 5 | 30 | Multi-store transfers, owner dashboard, HR/payroll, ledger, API keys |
| Enterprise | 14,999 | ∞ | ∞ | Field sales, delivery routes, hotel, channel manager, forecasting, franchise |

Gating is **two layers**, and a paid feature needs both:

| Layer | Where | Role |
|---|---|---|
| Server (authoritative) | `@RequiresFeature(Feature.X)` + `SubscriptionGuard`, backed by `packages/shared/src/permissions/subscription-features.ts` | Makes the access decision |
| Client (UX only) | `apps/web/src/lib/featureGates.ts` | Filters the sidebar, shows the upgrade prompt |

Notes:

- `TRIAL` businesses get full access until the trial ends; after that the
  business's `subscriptionTier` is enforced.
- `planName` travels in the JWT payload and on `AuthUser`.
- Super admins can gift a plan (`comped` subscriptions) from the admin console
  without recording revenue.
- `planRank()` is case-insensitive on purpose — a paid activation writes a title-case
  `planName` ("Enterprise") while the map keys are upper case, and a raw lookup used
  to rank a paying Enterprise customer as FREE.

---

## Feature map

### POS & sales
Retail, hospitality, fast-food, supermarket, kiosk and pharmacy modes · promotions
auto-applied at checkout · gift cards · loyalty earn/redeem · split payments
(cash + M-Pesa + card + bank + cheque) · M-Pesa STK push and dynamic QR · Paystack
cards · held sales · returns and void with audit trail · offline sale queue · camera
barcode scanning · quick keyboard entry (`3×500`) · WhatsApp/SMS/email receipts ·
eTIMS auto-submit after checkout · multi-currency with live rates.

### Inventory
Movement-based stock ledger (never a direct field update) · batch/lot tracking with
FEFO, expiry alerts and recall · serial numbers · variants · CSV import · barcode
label printing · bundles/kits · recipes and BOM costing · supplier POs, GRN, RFQ ·
inter-store transfers · stocktake sessions · damaged goods.

### Hospitality & hotel
Floor-grouped table layouts · per-station kitchen tickets (kitchen / bar / dessert, daily
numbering, duplicate-send protection) · live KDS on web and phone · voids reach the kitchen ·
optional Restaurant module for non-restaurant businesses ·
bar tabs · room charge · priced modifiers · reservations, merge, transfer ·
hotel rooms, guest folios, deposit register, optional hotel levies, check-out invoice (eTIMS), housekeeping queue ·
channel manager · QR menu ·
waitlist · appointments.

### Verticals
Pharmacy + prescriptions (dispensing is a real sale with insurer split and claims) · fuel pump control · cyber café sessions and kiosk ·
supermarket POS · events.

### HR & payroll
Employees, commissions (sales value / transaction count / gross margin) · leave with
balances · shift scheduling and shift-sales reports · attendance · disciplinary
records · salary advances · full Kenya payroll (PAYE, SHIF, NSSF, AHL) · payslips.

### Field sales & B2B
`SALES_AGENT` order capture on `/agent` · office Kanban on `/field-orders` · full and
partial invoicing · bulk "Invoice All Delivered" · payment recording · B2B invoice
PDF · WhatsApp/SMS notification on invoice · invoice ageing report (0-30/31-60/61-90/90+)
· delivery routes · "Save as Invoice / Proforma" from the POS cart.

### Delivery & customer-facing
Delivery orders and driver assignment · live driver location and public tracking page
(`/track/:orderNumber`) · web storefront (`/shop/:businessId`) · QR menu
(`/menu/:businessId`) · `/order/:businessId` (redirects to the storefront) · payment links
(`/pay/:code`) · supplier quote portal (`/quote/:token`) · phone-OTP customer portal
(`/portal`) · affiliate portal (`/affiliate`).

### Reports
40+ tabs grouped as Financial · Inventory · Customers · HR & Staff · Suppliers ·
Compliance — including X/Z reports, VAT return, P&L, department P&L, gross margin,
menu engineering, dead stock, shrinkage, GRN discrepancy, recipe variance, basket
analysis, customer LTV, NPS, commissions, supplier ageing, KRA export and the
tamper-evident audit log. CSV export on every tab; PDF for VAT, receipts, POs and B2B
invoices. AI demand forecasting and scheduled report delivery.

### Platform
Multi-store and cross-store owner dashboard · franchise hierarchy · Paystack
subscription billing · KDPA data-deletion compliance · RBAC with custom roles ·
API keys with IP whitelisting · Helmet, login lockout, password policy, TOTP ·
webhooks with HMAC signing · integrations (QuickBooks, Xero, Shopify, WooCommerce) ·
referral programme · affiliate programme with recurring commission · database backup.

---

## Environment variables

Copy `apps/api/.env.example` → `apps/api/.env`. Required:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/faida_pos"
JWT_SECRET="<openssl rand -base64 32>"
ENCRYPTION_KEY="<openssl rand -hex 32>"   # 64 hex chars — AES-256-CBC for M-Pesa + eTIMS creds
FRONTEND_URL="http://localhost:3005"      # used to build links in emails/SMS
ADMIN_URL="http://localhost:3012"
```

Optional — leave blank to disable the feature:

| Variable | Enables |
|---|---|
| `REDIS_HOST` | BullMQ queues (without it, jobs run synchronously) |
| `MPESA_*` | M-Pesa Daraja STK / QR |
| `AT_USERNAME` / `AT_API_KEY` / `AT_SENDER_ID` | Shared Africa's Talking account: customer login codes, and the fallback for businesses without their own SMS account |
| `SMS_OTP_PER_PHONE_HOUR` / `SMS_PLATFORM_PER_BUSINESS_HOUR` | Hourly caps on the shared account (defaults 5 and 300) |
| `RESEND_API_KEY` / `EMAIL_FROM` | Transactional email |
| `PAYSTACK_SECRET_KEY` + `PAYSTACK_*_PLAN` | Subscriptions and card payments |
| `SENTRY_DSN` | Error tracking |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth login |
| `GOOGLE_DESKTOP_CLIENT_ID` / `GOOGLE_DESKTOP_CLIENT_SECRET` | Google OAuth client of type "Desktop app", used by Google sign-in inside the desktop app |
| `ETIMS_ENV` | `test` (default) or `production` |
| `EXPO_PUBLIC_API_URL` | Default API the mobile apps ship with |
| `FAIDA_WEB_ORIGIN` / `FAIDA_API_ORIGIN` | Rewritten into the landing site at deploy |

Never commit `.env`. Never hardcode a credential in a script, seed file, or doc.

---

## Testing & CI

```bash
cd apps/api && npm test              # Jest unit tests
cd apps/api && npm run test:e2e      # e2e suite
cd apps/web  && npm run build        # tsc + vite build (type-check gate)
cd apps/mobile-pos && npm run typecheck
npx prisma validate --schema prisma/schema.prisma
```

`.github/workflows/ci.yml` runs on every push: API test+build (against a live
PostgreSQL service), web build, mobile type-check, and Prisma schema validation.

> The mobile matrix covers all four Expo apps (`mobile-pos`, `mobile-customer`, `mobile-driver`, `mobile-agent`);
> `mobile-pos` also runs its Jest suite. The web job runs the vitest suite and the `print-core` package has its own job.

---

## Deployment

| Target | How |
|---|---|
| API | `render.yaml` blueprint → Render (Frankfurt). Build `npm ci && bash scripts/render-build.sh`; start runs `prisma migrate deploy` then `node dist/main`. Health check `/api/v1/health`. |
| Database | Supabase or any managed PostgreSQL. Set `DIRECT_URL` to a **session** pooler (port 5432) — migrations hang on the transaction pooler (:6543). |
| Web / Admin | Static Vite build → any CDN (Vercel). Set `VITE_API_URL` only when the API is on a different origin. |
| Landing | Static HTML. Run `node apps/landing/apply-domains.mjs` at deploy with `FAIDA_WEB_ORIGIN` / `FAIDA_API_ORIGIN` set. |
| Desktop | `.github/workflows/desktop-release.yml`, or `cd apps/desktop && npm run build`. Build `apps/web` **first** — Tauri bundles `apps/web/dist`. |
| Mobile | `.github/workflows/mobile-release.yml` — run **Mobile Apps Release** (app: one of the four, or `all`) or push a `mobile-v*` tag. Versions are resolved by `scripts/bump-mobile-version.mjs` and committed; the job builds Android APKs locally on the runner and uploads them as artifacts. |

### Mobile versioning

`scripts/bump-mobile-version.mjs <version> [app]` sets **only** `version` in
`app.json`. `versionCode` and the iOS `buildNumber` are owned by EAS
(`appVersionSource: "remote"` with `autoIncrement`) and are deliberately absent from
`app.json`.

`version` is also the **OTA runtime key** — every app uses `runtimeVersion` policy
`appVersion`, so bumping it cuts existing installs off from updates published against
the old version. Bump it when native code or config changed and a rebuild is going
out anyway; do **not** bump it for a JavaScript fix you intend to ship with
`eas update`. To tell two builds apart, read the commit in the app's App Info screen.

All four apps are currently at **1.1.0**.

---

## Per-app documentation

| App | README |
|---|---|
| API | [apps/api/README.md](apps/api/README.md) |
| Web PWA | [apps/web/README.md](apps/web/README.md) |
| Admin console | [apps/admin/README.md](apps/admin/README.md) |
| Desktop | [apps/desktop/README.md](apps/desktop/README.md) |
| Landing site | [apps/landing/README.md](apps/landing/README.md) |
| Mobile — cashier | [apps/mobile-pos/README.md](apps/mobile-pos/README.md) |
| Mobile — customer | [apps/mobile-customer/README.md](apps/mobile-customer/README.md) |
| Mobile — driver | [apps/mobile-driver/README.md](apps/mobile-driver/README.md) |
| Mobile — agent | [apps/mobile-agent/README.md](apps/mobile-agent/README.md) |
| Shared package | [packages/shared/README.md](packages/shared/README.md) |
| Push package | [packages/mobile-push/README.md](packages/mobile-push/README.md) |
| Print core | [packages/print-core/README.md](packages/print-core/README.md) |

Engineering rules and coding standards live in [claude.md](claude.md); the product
blueprint in [masterplan.md](masterplan.md).

### End-user documentation

Those READMEs are **developer** docs. The **user-facing** manuals live in
[docs/](docs/README.md) — one markdown source per audience, everything else generated
by [scripts/build-docs.sh](scripts/build-docs.sh):

| Source | Audience | Generated into |
|---|---|---|
| [docs/user-guide.md](docs/user-guide.md) | Shop staff and owners | `FAIDA_POS_User_Guide.pdf`, `apps/landing/faida-pos-manual.html` |
| [docs/admin-guide.md](docs/admin-guide.md) | Whoever runs the server | `FAIDA_POS_Admin_Guide.pdf` |
| [docs/super-admin-guide.md](docs/super-admin-guide.md) | Platform operators | The **Guide** page inside the admin console |

Edit the markdown, run `scripts/build-docs.sh`, commit the outputs.

---

## Conventions that bite

Read these before touching the code — each one has caused a real bug.

- **Money is stored in integer cents.** Never floats. Display with `formatKES()` from
  `@pos/shared`.
- **VAT-inclusive pricing**: extract VAT as `price × 16 / 116`, don't add it on top.
- **Stock is a ledger.** Write an `InventoryMovement`; never update a stock field
  directly. Stock valuation returns `items[].quantity`, while the items list API
  returns `currentStock` — they are different shapes.
- **`offlineId` (UUID) on every offline-creatable record** for server-side idempotency.
- **Item-name fields differ per model**: `SaleItem.name`, `OrderItem.name`,
  `StocktakeCount.itemName`, `FieldOrderItem.itemName`. Delivery items live on
  `sale.items`.
- **Missing relations**: `Shift` has no `employee` relation and `POItem` has no `item`
  relation — query them separately by id.
- **Customers are nested**: `businesses/:businessId/customers`, not
  `/customers/:id?businessId=`.
- **Two `@Controller('portal')` exist** — the public `portal/` registers first and
  wins; authed customer routes are namespaced under `/portal/me/*`.
- **Web auth store**: `businessId` lives on `user` (`useAuthStore(s => s.user)?.businessId`),
  not on `AuthState`. Get the token with `getToken()` from `lib/api`.
- **JWT lifetimes**: 15 min for email login, 12 h for PIN. `POST /auth/refresh`
  requires a still-valid token — refresh proactively, don't wait for a 401.
- **`TenantGuard` is mandatory on every endpoint.** No exceptions.

---

## Keeping docs current

These READMEs are part of the deliverable, not an afterthought. When you add or
change a feature, update the README that covers it in the same change — the root
README for anything cross-cutting (a new app, plan tier, port, or env var), and the
per-app README for anything local to one app.

## Design tokens

`design/tokens.json` is the single source for colour, radius, spacing and type across the web app, the desktop shell
and the four mobile apps (`npm run tokens` regenerates the platform files). See `design/README.md`.
