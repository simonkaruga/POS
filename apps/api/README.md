# Faida POS — API

NestJS 10 + Prisma 5 backend. Single service for all nine client apps.

- Base URL: `http://localhost:3010/api/v1`
- Swagger: `http://localhost:3010/api/docs`
- Health: `GET /api/v1/health` · config presence: `GET /api/v1/health/config`

---

## Run

```bash
npm install
npx prisma generate --schema ../../prisma/schema.prisma
npx prisma migrate deploy --schema ../../prisma/schema.prisma
npx ts-node src/seed.ts        # light seed (idempotent); ../../prisma/seed.ts is the full, destructive one
npm run start:dev              # tsc --watch + node --watch on dist/main.js
```

`start:dev` compiles with `tsc --watch` and runs the emitted JS (not `nest start`),
so a type error surfaces in the compiler output rather than silently keeping the old
build alive.

| Script | Purpose |
|---|---|
| `npm run start:dev` | Watch-mode dev server (:3010) |
| `npm run build` | `tsc` + `tsc-alias` → `dist/` (prebuild also builds `@pos/shared`) |
| `npm start` | Run the built server |
| `npm test` | Jest unit tests |
| `npm run test:e2e` | e2e suite (`jest-e2e.json`) |
| `npm run test:cov` | Coverage |

---

## Bootstrap ([src/main.ts](src/main.ts))

- Global prefix `api`, URI versioning with default version `1` → every route is
  `/api/v1/...`.
- `rawBody: true` — required so the Paystack webhook signature can be verified
  against the unparsed body.
- Helmet security headers. CSP and COEP are off (Swagger UI), COOP is off (the
  Google OAuth popup polls `window.closed` on the opener).
- CORS allows `FRONTEND_URL`, `ADMIN_URL`, anything in `EXTRA_ORIGINS`, any
  `*.vercel.app` preview, and origin-less requests (mobile apps, curl, health checks).
- Fingerprint / Face ID is WebAuthn (`auth/webauthn.*`). The RP ID and expected origin are derived
  from the request's `Origin` (or `Referer`) header by `webauthn-origin.ts`, checked against
  `FRONTEND_URL` / `ADMIN_URL` / `EXTRA_ORIGINS`; `WEBAUTHN_RP_ID` optionally widens it to a parent
  domain. Browsers require HTTPS (only `http://localhost` is exempt) and refuse IP addresses, so it
  cannot work over a LAN IP. Managing credentials is limited to yourself, or owner/manager for staff.
- Native-app fingerprint sign-in uses device tokens (`auth/device-login.service.ts`): `POST /auth/device-token`
  (signed in), `POST /auth/login/device` (public, throttled), `POST /auth/device-token/revoke`. Tokens are
  hashed in `UserSession` (`userAgent` starts `device:`), max 5 phones per user, 90 days sliding expiry.
- Socket.IO adapter for WebSocket / LAN sync.
- `AllExceptionsFilter` as a global filter. It keeps the status of `HttpException`s and
  maps Prisma request errors to client errors (`PrismaClientValidationError` -> 400,
  `P2025` -> 404, `P2002`/`P2003` -> 409). Anything else is a 500 with a generic
  message in production; Prisma messages embed the failing query, so they are logged,
  never returned.

`GET /api/v1/health/config` reports which env vars are **set** as booleans only —
never values — so a deployment can be verified at a glance without leaking secrets.

---

## Auth & guards ([src/auth/](src/auth/))

| Guard | Responsibility |
|---|---|
| `JwtAuthGuard` | Validates the bearer token, populates `AuthUser` |
| `TenantGuard` | Scopes the request to `businessId`. **Mandatory on every endpoint** |
| `RoleAccessGuard` | **Global.** Enforces the role policy in `src/auth/access-policy.ts`: an ordered rule table (first match wins) plus deny-by-default allowlists for DRIVER, SALES_AGENT and KITCHEN. Routes no rule matches stay open to other signed-in roles, so **a new management-only endpoint must be added to the table**. Also pins `agentId` for sales agents and blocks a driver reading another driver's earnings |
| `RolesGuard` | Per-handler `@RequirePermission(...)` (layaway, batch, customers) |
| `SubscriptionGuard` | Enforces the plan tier; ends trials that have expired |

Login paths:

- **Email + password** → 15-minute access token
- **PIN** → 12-hour token (shop-floor sessions)
- **Google OAuth** (`google.strategy.ts`)
- **TOTP** second factor, **WebAuthn** (`webauthn.controller.ts`)
- **Phone OTP** for customers (customer portal, rate-limited). Numbers are
  canonicalized to `254XXXXXXXXX` by `common/phone.ts` before any lookup, and
  a failed SMS fails the request rather than silently reporting `sent: true`.
  Login codes go out on the shared platform account (`AT_*`), so a shop needs no
  SMS setup of its own; other messages use the shop's own account when it has one
  and fall back to the platform one. Platform sends are capped per hour (per phone
  for codes, per business overall, see `.env.example`) and every send is recorded
  in `SmsLog` for usage and billing
- **Affiliate JWT** (`src/affiliate/affiliate-jwt.guard.ts`) — separate audience
- **Super admin** — `POST /api/v1/super-admin/login`, own guard

**Who approved a void.** `POST /sales/:id/void` does not believe a `managerId` in the
body. The approver is either a `managerPin` that the server verifies against the
business's owners and managers, or the caller's own session when the caller is an
owner, admin or manager (`SalesService.resolveVoidApprover`). Anyone else gets 403.
Refunds (`POST /sales/:id/return`) record `processedBy` from the login, not the body.

**Vertical modules in the role policy.** Fuel, cyber cafe, pharmacy and prescriptions,
hotel folio and room list, and appointments each have rules in `access-policy.ts`:
the front line runs the till-side work (pump sales, sessions, dispensing, bookings)
and management owns prices, credit limits, tank levels, rate cards, clinical reference
data, cancellations and deletions. Waiters get no pharmacy or prescription access
because those records hold patient details.

**Channel-manager webhook** (`POST /integrations/channel/webhook/:channel?storeId=`)
is public to JWT but not open: send an API key in `x-api-key` that was issued with the
`bookings:write` scope (Settings, API keys). The booking is created in the key's own
business; a `businessId` in the query is ignored and the store must belong to that
business.

`POST /auth/refresh` requires a token that is **still valid**. Clients refresh
proactively; a 401 means log out, not retry.

`JwtPayload` and `AuthUser` both carry `planName`, so plan gating needs no extra
lookup.

---

## Plan enforcement

Gating exists in **two layers**, and both must be updated when you add a paid feature:

| Layer | Where | Enforces |
|---|---|---|
| Server | `SubscriptionGuard` + `@RequiresFeature(...)` | The actual access decision |
| Client | `apps/web/src/lib/featureGates.ts` | Sidebar filtering and page-level UX |

The client map is a **convenience, not a control** — it hides nav items. The server
decorator is what stops a request.

Decorate a controller (or a single handler) with the feature it sells:

```ts
import { Feature } from '@pos/shared';
import { RequiresFeature } from '../auth/subscription.guard';

@RequiresFeature(Feature.BUNDLES)
@Controller('bundle')
@UseGuards(JwtAuthGuard, TenantGuard)
export class BundleController { … }
```

`SubscriptionGuard` reads the decorator via `Reflector`, resolves the business's
`SubscriptionTier`, and calls `hasFeatureAccess(tier, feature)` from
[`@pos/shared`](../../packages/shared/README.md). The `Feature` enum and the
tier → feature map live in
`packages/shared/src/permissions/subscription-features.ts`; `getFeatureLimit` returns
numeric caps (stores, users) for the tier.

Trials get full access until they expire; after that the business's
`subscriptionTier` is enforced. Gifted ("comped") subscriptions grant a tier without
recording revenue.

### Licensing the offline edition ([src/licensing/](src/licensing/))

The offline edition (`FAIDA_EDITION=LOCAL`, set by `packages/local-server`) cannot ask a payment
provider whether it is paid up, so its plan comes from a **signed licence**:

- `license-token.ts` — `kl1.<payload>.<signature>`, Ed25519. The private key exists only on the cloud
  server (`LICENSE_SIGNING_PRIVATE_KEY`); the app carries the public key (`FAIDA_LICENSE_PUBLIC_KEY`),
  so it can check a licence and cannot make one. The payload names the computer (`machineId`), the plan,
  when this token ends and when the licence itself ends.
- `license-authority.service.ts` + `license-server.controller.ts` (**cloud**) — `POST /license-server/activate`
  and `/renew` (public, throttled). A `LicenseKey` binds to the first computer that activates it
  (atomically); another computer is refused (`OTHER_COMPUTER`) until the admin **Releases** it. Revoked and
  expired keys are refused. Tokens last 30 days, never beyond the licence's end.
- `license.service.ts` (**offline**) — keeps the token in `LocalLicense`, renews quietly at most once a day
  when online, and writes `Business.subscriptionTier/Status/trialEndsAt/planName` from the **verified token**
  so the existing `effectiveTier()`/`SubscriptionGuard` do the enforcing. A token that fails verification or is
  for another computer is never stored. `GET /license/status`, `POST /license/activate`, `POST /license/renew`.
- `license-state.ts` — the rules, pure: ACTIVE → EXPIRING_SOON (last 7 days) → GRACE (14 days after the token
  ends) → LAPSED (Free plan, as a lapsed cloud subscription). `effectiveNow = max(now, lastSeenAt)` so winding the
  clock back gains nothing. Data and backups are never locked.

Migration `20261108000000_license_activation` adds the binding columns and `LocalLicense`; apply it to the cloud
database before deploying code that reads them.

---

## Modules

60+ feature modules registered in [src/app.module.ts](src/app.module.ts):

**Core** — `auth` `business` `items` `inventory` `sales` `customers` `payments`
`reports` `prisma`

**Fiscal & compliance** — `etims` `audit` `kdpa` `security` `api-keys`

**Inventory depth** — `batch` `serial` `bundle` `recipe` `stocktake` `transfers`
`damaged-goods` `supplier` `rfq`

**Hospitality & hotel** — `hospitality` `housekeeping` `channel-manager` `events`
`waitlist` `appointments`

Kitchen tickets (`hospitality/orders/:id/kot`, `hospitality/kot/:id/status`,
`hospitality/kds/orders`):
- one ticket per station (`KITCHEN` / `BAR` / `DESSERT`, from `Item.station` or inferred
  by `inferStation` in `@pos/shared`), numbered per store per service day (`KotCounter`);
- lines are claimed with `OrderItem.sentToKitchenAt`, so a repeated send is refused rather
  than duplicated (`firedAt` is the course-fire marker and is not used for this);
- status changes follow `KOT_TRANSITIONS`; an unchanged status is a no-op, a lost race is a 409;
- cancelling an order cancels its open tickets; voiding a sent line needs a manager and
  pulls it off its ticket (`kot_voided` socket event);
- every order, ticket and store id is checked against the caller's business, and
  `HospitalityAccessGuard` (on the hospitality, housekeeping and waitlist controllers) refuses
  restaurant routes (tables, orders, kitchen, kds, kot, reservations, bar-tabs, happy-hours,
  revpash, waitlist) unless the till is a restaurant till or `RESTAURANT` is in
  `Business.enabledModules`, and hotel routes (hotel-rooms, room-bookings, folio-charges,
  housekeeping, housekeeping-assignments, hotel-dashboard) unless the till is `HOSPITALITY` or `HOTEL` is enabled;
- the socket gateway verifies the JWT and joins a client only to its own business room.

Trust boundaries in `hospitality` (the global `TenantGuard` already rejects a foreign
`businessId`/`storeId` in the query, params or body; these cover everything it cannot see):
- routes that name a thing only by id (table, order, tab, room, booking, folio charge,
  happy hour, reservation, waitlist entry, housekeeping assignment) look it up with the
  caller's business and answer 404 otherwise; a body `storeId`/`roomId`/`tableId` is checked
  the same way, and the waiter, poster and assigner come from the login, not the body;
- order and bar-tab lines are priced from the menu (`priceLines`): name and unit price are
  read from `Item`, quantity must be a whole number 1 to 999, and priced modifiers must be
  non-negative and capped. There is no modifier catalogue, so a modifier price is bounded, not verified;
- a tab settles once (claimed inside the transaction) and only when payments cover it;
- checkout looks items up within the business, rejects non-positive quantities and
  out-of-range discount/tip/service charge, and requires a `NORMAL` sale's payments to cover its total;
- stock that must not go negative is enforced on the server, not the till screen: an item with
  `negativeStockPolicy = BLOCK` (Inventory, "block oversell") or any item when the business policy is `BLOCK` is locked
  (`SELECT ... FOR UPDATE` on the item rows, in id order) and re-read inside the sale's transaction
  (`sales/stock-guard.ts`), so two tills cannot both take the last units. Prescription fills use the same guard.
  Whole-unit items (`PRODUCT`, `BUNDLE`, `RECIPE` not marked fractional or weighed) refuse a part-unit quantity;
- a `CREDIT` payment makes the sale a credit sale whatever `type` the client sent, and a credit sale needs a
  `customerId` from the same business (so a credit limit is always checked and there is always someone to collect from);
- when a checkout names an `orderId`, `SalesService.createSale` ignores the client's cart and builds the
  sale from the order's own lines (price plus priced modifiers, times quantity), links `Sale.orderId`
  (unique, so an order has at most one sale) and claims the order `OPEN`/`BILL_REQUESTED` -> `PAID`
  inside the sale's transaction, so a failure rolls back both and two tills cannot both pay it;
  an optional `expectedTotalCents` makes it refuse (409) if the bill has moved on since the payer was shown it
  (the phone sends it; the web till does not);
- a PIN must be unique within a business (`assertPinAvailable`); a PIN shared before that
  rule logs nobody in without a `userId` (the staff picker passes it) and cannot attribute a manager override.

**Verticals** — `pharmacy` `prescriptions` `fuel-pump` `cybercafe`

Rules these modules enforce on the server (the web and mobile screens are not trusted to):

- **Fuel pump.** The price of a sale is the grade's `pricePerLitreCents`; a price in the request is
  ignored. Litres must be above zero and at most 5,000. The tank draw, the fleet charge, the sale and
  the pump reset are one transaction, and the tank and fleet balance move through conditional updates,
  so two sales at once cannot spend the same litres or the same credit. A fleet sale that would pass
  the credit limit (`creditLimitCents` above 0; 0 means no limit) is refused whole, tank draw included.
  A delivery larger than the room on the books is refused (record a dipping first); a shift can be
  closed once; only one shift is open per store. A fleet account's balance and a tank's level are never
  editable directly. Cashier, recorded-by and business always come from the login.
- **Cyber cafe.** A session is claimed with a conditional station update (no double starts). The hourly
  rate is the station's; a different rate for one session needs an owner, admin or manager. A package
  covers its own duration at its price, and every billable minute beyond it (an extension, or simply
  staying on) is billed at the package's hourly equivalent. Print and extras must be whole, non-negative
  amounts. Only a running session can be voided; an ended one is a closed sale.
  **Credit needs a registered customer** (the session's, or `customerId` sent at the end), pipeline or not.
  **On the sales pipeline** (`Business.verticalSalesFrom` set) `POST sessions/:id/end` also makes ONE `Sale` in the same
  transaction (`CybercafeService.endSession`, `source: 'CYBER'`, cashier = the caller so the drawer and Z-report count it):
  a package line (or computer time), the overrun beyond a package, printing and scanning, and other services are separate
  lines, each under an inactive `Cyber cafe` catalogue item made on first use (`sales/vertical-items.ts`
  `ensureServiceItem`, class B until classified). Credit is an on-account invoice within the customer's limit (a refusal
  leaves the session running). `buyerKraPin` is accepted. The response carries `receiptNumber`, `invoice` and `etims` (5 s
  wait for KRA). Voiding that sale marks the session `VOIDED`. A free session makes no invoice.
- **Prescriptions.** Numbers are `RX-<business tag>-<YYYYMMDD>-<n>`, continuing from the highest number
  issued that Nairobi day for that business, with a retry on a collision. The business tag matters:
  `prescriptionNumber` is unique across the whole table.

- **Pharmacy and prescriptions.** A prescription is `PENDING`, then `DISPENSED` (and refilled while it
  stays `DISPENSED`), or `CANCELLED` / `REFERRED_EXTERNAL`; each fill is claimed with a conditional update
  on the status and fill count, so a double click or two pharmacists cannot fill it twice. `refillsUsed`
  counts fills including the first, so `refillsAllowed = 2` allows three fills. A fill is one
  transaction: claim, stock out (first-expiry-first-out; the item's or the business's BLOCK policy
  refuses short stock) and, for an item whose `scheduleClass` is II to V, a controlled-substance
  register entry. If any part fails nothing is dispensed. Who dispensed it is the login. Counter staff
  cannot fill a refill early; a manager can. Cancelling stops the remaining refills but undoes nothing.
  Interaction checks ignore strengths, pack words and case, and treat a catalogue brand as its generic.
  **On the sales pipeline** (`Business.verticalSalesFrom` set) each fill is also ONE real `Sale`, created first inside the
  same transaction (`PrescriptionsService.fill`): every line is priced from its catalogue item (retail price, tax class),
  so a medicine with no `itemId` or no price refuses the fill with its name (`GET prescriptions/:id/quote` lists them
  first). `PATCH :id/dispense|refill` then takes `{ payments, insurance?: { providerId, memberNumber?, patientPct 0-99 },
  buyerKraPin? }`: the patient's payments cover their share, the insurer's share is an `INSURANCE` payment (Dr 1200
  Accounts Receivable, never the drawer) and an `InsuranceClaim` (`saleId` set, `billedCents` = the insurer's share) is
  raised in the same transaction. Stock leaves under the sale's id and the controlled-substance register notes the
  receipt number. The response carries `receiptNumber`, `invoice`, `etims` (5 s wait for KRA) and the shares. Closing a
  claim raised this way (`PATCH pharmacy/claims/:id`, conditional so it posts once) clears the receivable: PAID is Dr 1030
  bank, with any shortfall written off to 6900, and REJECTED writes the whole claim off; a hand-raised claim posts
  nothing. The claim endpoints only move status, number, approved/paid amounts and rejection reason, and are scoped to the
  caller's business. A fill is not undone by voiding its sale: the stock and register entry stay (no pharmacy return flow
  yet). Off the pipeline none of this runs and dispensing behaves as before.
- **Hotel.** The dates decide the nights (a `nightCount` that disagrees is ignored). A room cannot be
  booked for overlapping nights: bookings, check-in, cancel and check-out all take a row lock on the
  room first, and a guest still checked in past their date keeps holding it. A booking due today shows
  the room as RESERVED; a later one leaves it bookable. A guest can be checked in at most a day early,
  into a room no one else is in. Check-out requires the balance (room nights, charges and late nights,
  less the deposit) to be paid in full, records the payments on the folio as zero-total `PAYMENT` lines,
  and bills a night for every Nairobi calendar day past the booked departure. `GET
  room-bookings/:id/checkout-quote` gives the desk the figure. A folio `DISCOUNT` is manager-only and
  cannot exceed the bill. Only `FOOD_BEVERAGE`, `MINIBAR`, `LAUNDRY`, `TRANSPORT`, `OTHER` and `DISCOUNT` can be hand-posted
  to a folio; room nights, `LEVY` and `PAYMENT` lines are written by check-out alone.
  **On the sales pipeline** (`Business.verticalSalesFrom` set) check-out makes ONE invoice (a real `Sale`) in the same
  transaction: a line per room-night line and folio charge under its tax class (catalogue items in category `Hotel`, made
  on first use, inactive, standard-rated except the levy, which is class D), the folio `DISCOUNT`s as the sale discount,
  the guest as customer with `RoomBooking.guestKraPin` as buyer, and the deposit as a `DEPOSIT` payment (ledger 2300, Guest
  Deposits) alongside what the guest tenders; change comes off the cash. The folio lines and the booking are linked to it
  (`saleId`). The response carries `receiptNumber`, `invoice`, `etims` (waited for 5 seconds at most). A deposit larger than
  the bill is applied up to the bill and the rest paid back out of the register by the method it came in by
  (`refundMethod`). Optional levies are a per-business list in `Business.hotelLevies`
  (`PATCH /business/:id/settings`, `[{name, ratePct, base: ROOM|ALL}]`, up to 5, rate above 0 up to 30): each is worked out
  on the VAT-exclusive value of the room nights (or everything), after the discount, and charged on top as its own non-VAT
  line (`common/hotel-levies.ts`). The default is none. The deposit register is `CashMovement` (`PAY_IN`/`PAY_OUT`/`FORFEIT`,
  reasons `HOTEL_DEPOSIT*`), written by `createRoomBooking`, `POST room-bookings/:id/deposit`, check-out and cancel, with a
  `HOTEL_DEPOSIT` ledger entry each (`DEP-<movement id>`); the cash ones feed the cash drawer's expected cash. Cancelling a
  reservation pays the deposit back, or (`{forfeit: true}`, manager only) keeps it as income (4300). Off the pipeline none of
  this runs and check-out behaves as before (levies excepted: a configured levy is billed either way).
  **Room charges.** A till sale paid with `ROOM_CHARGE` (the payment names `roomNumber`) is written to the folio of the
  guest checked in to that room, inside the sale's own transaction (`SalesService.chargeToRoom`): no checked-in guest,
  more than one room, or more than the sale comes to, and the sale is refused. It is a `POS_SALE` folio line tied to the
  sale by `saleId`. The sale itself posts Dr 1200 Accounts Receivable (not bank receipts). Voiding it takes the line off the
  folio while the guest is in (a line void reduces it); after check-out the void is refused. At check-out the line is
  collected but never invoiced twice: the stay's invoice carries the nights, charges and levies only, and the guest's money
  is spent on the charged sales first (`splitTenders`). That cash is a `HOTEL_ROOM_CHARGE_PAID` register pay-in (so the
  drawer counts it) with a `ROOMSET-<booking>-<n>` ledger entry (Dr cash/M-Pesa/card, or Dr 2300 when a deposit pays it,
  Cr 1200); this ledger entry is posted off the pipeline too, since the sale's receivable was. A levy and a stay discount
  never apply to charged sales. Opening a room-service order with `roomBookingId` no longer posts a KES 0 folio line; it
  only fills in the order's room number.
- **Appointments.** Status moves follow the screen's buttons (`BOOKED` to `CONFIRMED` to `IN_PROGRESS` to
  `COMPLETED` or `NO_SHOW`; `CANCELLED` from the first two); one staff member cannot hold two
  overlapping appointments (an advisory lock per staff member serialises booking); finished and
  running appointments are not deleted; a day filter is the Nairobi day. A no-show is possible before the
  appointment starts (from `BOOKED` or `CONFIRMED`) as well as from `IN_PROGRESS`.
  **On the sales pipeline** (`Business.verticalSalesFrom` set):
  - *Deposits* are money taken: booking with one needs `depositMethod`, `POST appointments/:id/deposit` adds more, and each
    is a `CashMovement` (`APPOINTMENT_DEPOSIT`, `bookingId` = the appointment) with a `DEP-<id>` journal into 2300 (cash
    ones reach the drawer). The amount cannot then be edited by hand. Deposits already held at switch-on come in through
    the opening balances (`APPOINTMENT_DEPOSIT_OPENING`).
  - *Completing* (`PATCH appointments/:id` with `status: COMPLETED`, `payments`, optional `amountCents` and `buyerKraPin`) is ONE
    `Sale` in the same transaction (`AppointmentsService.complete`, `source: 'APPOINTMENT'`, `Appointment.saleId`): the line
    is the appointment's catalogue service at its price (only a manager changes a listed price; a service with no list
    price takes the price entered; none at all falls back to an inactive `Appointments` item). The deposit held pays first
    (a `DEPOSIT` payment, Dr 2300), the rest is paid now, and a deposit above the bill is paid back (`refundMethod` when the way it came in
    is not on record). The response carries `receiptNumber`, `invoice`, `etims` (5 s wait), `changeDueCents`, `refundDueCents`.
  - *Cancelling or a no-show with a deposit held* pays it back the way it came in, or (`keepDeposit`, manager only) keeps it
    as income (4300, a `FORFEIT` row); an unrecorded way of paying needs `refundMethod`. `sales/deposit-register.ts` is the
    shared rule with the hotel. Voiding the invoice marks the appointment cancelled; a deposit it had used is not paid back
    automatically (refund it by hand).
- **Days are Nairobi days.** `common/dates.ts` draws day boundaries at +03:00. A UTC server using
  `setHours(0,0,0,0)` or `new Date('2026-11-05T23:59:59')` is three hours off. Use these helpers for
  anything new that filters by day.

Request validation helpers (`intInRange`, `numberInRange`, `oneOf`, `text`) are in `common/validate.ts`.

**Money** — `expense` `budget` `ledger` `cheque` `layaway` `gift-cards` `loyalty`
`promotions` `payment-links` `subscription` `cash-drawer`

**People** — `hr` `disciplinary`

**Distribution** — `field-sales` `delivery` `delivery-routes` `franchise`

**Customer-facing** — `portal` `customer-portal` `nps` `notifications` `push`

**Platform** — `super-admin` `affiliate` `referrals` `integrations` `webhooks`
`email` `printers` `queue` `backup` `report-schedules`

---

## Database

Schema is `../../prisma/schema.prisma` (151 models) — the single source of truth.
The API does **not** own a schema copy.

```bash
npx prisma migrate dev --schema ../../prisma/schema.prisma --name <change>   # author
npx prisma migrate deploy --schema ../../prisma/schema.prisma                # apply
npx prisma validate --schema ../../prisma/schema.prisma
```

History is consolidated onto the base migration `20260314000000_init`.

Non-negotiable data rules:

- **Money in integer cents.** Never a float, never a Decimal-as-string round trip.
- **Stock is a ledger.** Write an `InventoryMovement`; never mutate a stock column.
- **Quantities are doubles, kept to 3 decimals.** Loose goods are sold, stocked and counted in
  fractions (0.5 kg), so the quantity columns on the sell / stock / receive / write-off path
  (`SaleItem`, `InventoryMovement`, `Batch`, `DamagedGoodsRecord`, `TransferItem`, `GRNItem`,
  `POItem`, `SupplierReturnItem`) are `Float`. They were `Int`, and Postgres rounded what it was
  given: a 0.5 kg sale stored 0, so stock never fell and voiding the line refunded nothing.
  Round with `roundQty` (`common/quantity.ts`) whenever you sum movements, so a shelf that is
  empty reads as empty (`0.1 + 0.2 - 0.3` is not 0 in a double). A sale quantity finer than a gram
  is refused. Still `Int`: order lines, bundle components, delivery and field-sales lines.
- **Tax is per line, from tax classes.** Every item has a `taxClass`: A exempt, B standard 16%, C
  zero-rated, D not subject to VAT (eTIMS's letters). `computeTaxes` in `packages/shared` extracts VAT
  (16/116, prices are VAT-inclusive) from the B lines only, after each line's share of the sale discount
  (largest-remainder, so the shares add up to the cent), and a business that is not VAT-registered charges
  none and sells every line as D. The web tills call the same function, so the receipt printed at the till
  is the figure that is stored and sent to KRA. Each `SaleItem` snapshots `taxClass`, `vatCents` and
  `discountCents`, so changing an item later never rewrites a past invoice; `Sale.taxClassified` marks sales
  taxed this way. eTIMS invoices and credit notes build their lines and per-class totals from that snapshot
  (`etims/etims-tax.ts`); a line with no class (made before classes existed) is described as standard-rated,
  as it always was. Reports repair only unclassified sales (`recalcVat`), and the VAT return gains
  `outputVat.salesByTaxClass`. Refunds and partial voids use what the customer paid for the line, after its
  discount share. **The old `vatApplicable` flag is not read** (the create form defaulted it to unchecked, so
  `false` rarely meant "exempt"); only an explicit `taxClass` classifies an item. Not yet classified-aware,
  and still flat 16/116: proforma invoices and their conversion, and field-sales proformas. Service charge
  and tip are outside the VAT base, as before.
- **Vertical takings become real Sales.** Fuel (and, as they arrive, hotel, pharmacy, cyber and appointments) record
  their takings through `DirectSaleService` (`sales/direct-sale.service.ts`): `createInTx` runs inside the vertical's OWN
  transaction (receipt number from the atomic store sequence, per-line tax, payments with the change taken off the cash,
  on-account sales within a customer's credit limit), so the invoice commits or rolls back with the tank draw and the
  fleet charge; `afterCommit` then does the audit entry, the ledger journal (`sales/sale-ledger.ts`, shared with the
  till), the broadcast and the eTIMS submission, none of which can fail the sale. The server owns the eTIMS submission
  (the till's `/etims/submit` is idempotent only when not racing a second submit), and `afterCommit` returns the KRA answer
  so a screen can print the QR; a slow KRA is waited for 5 seconds at most. It is gated per business by
  `Business.verticalSalesFrom`: null (every business that existed before) means off, so a shop that already rings these
  takings through the till is not counted twice; only an owner can switch it (`PATCH /business/:id/settings`
  `verticalSalesEnabled`, which stamps the date; nothing earlier is back-filled); a business registered from now on starts
  on. A grade is invoiced as a catalogue item made on first use (inactive, standard-rated until classified in Inventory)
  and its price follows the grade. A fleet sale is an on-account invoice to the company with its KRA PIN as buyer
  (`Sale.buyerKraPin`); a fleet company paying posts money-in and clears the receivable. Credit needs a registered customer.
  **Trap:** inside an interactive transaction, `update`/`delete` by id on a row created earlier in the SAME transaction
  throws "not found", because the tenant middleware reads the ownership check outside the transaction. Use `updateMany`.
- **Taking a sale back, and settling one.**
  - *Void* is `SalesService.voidInTx` (inside a caller's own transaction) plus `afterVoid` (audit, KRA credit note, books).
    It works on PAID and CREDIT sales (a credit sale gives the customer's balance back; a part-paid one is refused), and
    the books take the sale back: a `VOID-<receipt>` entry mirrors the sale's journal (`VOIDLINE-<void id>` for a line void,
    scaled by the share refunded; `reverseJournalLines` keeps it balanced). Before this a void left revenue in the books.
  - *Pump sale void* (`POST fuel-pump/sales/:id/void`, manager): the litres return to the tank they came from
    (`FuelSale.tankId`), a fleet account is credited (`FleetTransaction` type VOID), and an invoiced sale is voided in the
    same transaction.
  - *Prescription fill return* is a void of the fill's sale (`PrescriptionFill` ties them): the prescription goes back to the
    fill before it (a first fill returns to PENDING), the insurer's claim becomes VOIDED, and the controlled-drug register
    gets a negative return line (nothing in the register is deleted). A fill is returned whole, and not after the insurer paid.
  - *Credit settlement* (`PATCH sales/:id/mark-credit-paid`, body `{amountCents?, method}`): a part payment leaves the sale
    CREDIT with the balance named; the rest closes it. The payment clears the receivable (`SETTLE-<receipt>-<id>`), cash
    is a `CREDIT_SETTLEMENT` drawer pay-in (the drawer does not also count it as the sale's cash), and it posts once.
  - *Opening balances* (`sales/opening-balances.ts`, run every time the owner switches the pipeline on, booking only the
    DIFFERENCE from what the books already believe, against 3900 Opening Balance Equity): a booking's deposit not yet in
    the register is added as an `OPENING` row (never cash; a top-up taken while off is picked up next time, Dr 3900 / Cr
    2300); each fleet account keeps `ledgerOwedCents` (moved by fleet sales, payments and voids while on) and the gap from its
    real balance is booked either way (Dr/Cr 1200); open hand-raised insurance claims are brought into receivables once
    (`receivableBooked`). A hand-raised claim that never reached receivables, when paid, is income (Cr 4450), and a rejection
    of one posts nothing.
  - *A deposit taken before the register existed* has no record of how it was paid, so refunding it (check-out or cancel)
    needs `refundMethod` in the request; cash is no longer assumed. The check-out quote returns `depositMethod` (null when unknown).
  - *Part of a prescription fill can be returned* (void the sale with `voidedItemQuantities`/`voidedItemIds`): the prescription
    stays dispensed, the insurer's claim falls by its share of what came back, the register gets a return for just those
    drugs and the books take back that share. One partial return per fill: the sale is then AMENDED and cannot be voided again.
  - *Insurer overpayment* is kept: Cr 4400 Claim Overpayments for the excess.
  - *eTIMS payment type* (`etims/etims-payment.ts`) is one code per invoice: cash 01, credit 02 (credit sales, an insurer's share,
    a room charge), cash and credit 03, bank 04, card 05, mobile money 06, other 07 (deposit, gift card, loyalty). **These are
    KRA's published codes; the earlier table sent M-Pesa as 04 and bank as 03. Confirm in the KRA sandbox before production.**
  - *eTIMS retry sweep* (`etims/etims-retry.service.ts`): every ten minutes, sales of production businesses not yet accepted
    by KRA (older than 5 minutes, newer than 7 days, PAID or CREDIT) are submitted again, oldest first, stopping a pass after
    five failures in a row.
  - `GET sales/:id` for a sale that is not the caller's is a 404. **Ledger entry numbers** are now `JE-<business tag>-<n>`,
    continuing from the highest used and retried on a clash: the bare per-business count collided across businesses
    (the column is unique across all of them), so a second business's entries were refused and silently lost.
- **Batches move with the ledger.** Stock-out and stock-back go through `batch/batch-allocation.ts`
  (`drawStock`, `restoreStock`), never a bare `inventoryMovement.create`, for anything that sells or
  returns stock. For an item with `trackBatches` it draws first-expiry-first-out from in-date batches
  with a conditional update (two sales cannot take the same units), records the `batchId` on each
  movement, and refuses a sale that could only be met from an expired batch. Voids and returns put
  units back into the batches they came from. A batch that is written off or recalled does not take
  units back; they return unbatched. Items without `trackBatches` still get one plain movement.
  Stock received without batch records still sells (the part batches cannot cover is unbatched).
  Because batch counts now fall on sale, the nightly expiry job writes off only units that are really
  left; before, it wrote off units already sold and pushed stock negative.
- **`offlineId` (UUID)** on every offline-creatable record. The service layer
  deduplicates on it, so a replayed mobile/desktop request is a no-op instead of a
  duplicate sale, order or payment.
- Secrets at rest (M-Pesa and eTIMS credentials) are AES-256-CBC encrypted with
  `ENCRYPTION_KEY` (64 hex chars).

---

## Environment

Copy `.env.example` → `.env`. Required: `DATABASE_URL`, `JWT_SECRET`,
`ENCRYPTION_KEY`, `FRONTEND_URL`, `ADMIN_URL`. Everything else is optional and
disables its feature when blank — see the table in the [root README](../../README.md#environment-variables).

`.env` is never committed.

---

## Testing

```bash
npm test                # unit
npm run test:e2e        # e2e (--forceExit)
```

`src/common/client-contract.spec.ts` reads every controller route and every API call in the web app and the four
mobile apps, and fails when a client calls a route the server does not have (the unit tests and the type-checker
cannot see that). Add the server route, or fix the client call, when it fails.

To exercise real endpoints without touching a shared database, run a throwaway
Postgres (`initdb` in a temp dir, `listen_addresses=127.0.0.1`), `prisma migrate
deploy --schema prisma/schema.prisma` against it, seed, and start the built API with a
scrubbed environment (explicit `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`,
`ENCRYPTION_KEY`, run from a directory with no `.env`) so no real M-Pesa, SMS or email
credentials load. The seeded business trial expires into the FREE tier, so set it to
ENTERPRISE first or most routes answer 403.

CI runs the unit suite and a full build against a live PostgreSQL service on every
push (`.github/workflows/ci.yml`).

---

## Gotchas

- **Two `@Controller('portal')` classes exist.** The public `portal/` module
  registers first and wins for bare `/portal/*` routes; authenticated customer
  routes are namespaced under `/portal/me/*`.
- **Customers are nested** under `businesses/:businessId/customers`.
- **`Shift` has no `employee` relation; `POItem` has no `item` relation** — fetch by
  id separately.
- Item-name fields vary by model: `SaleItem.name`, `OrderItem.name`,
  `StocktakeCount.itemName`, `FieldOrderItem.itemName`.
- Without `REDIS_HOST`, BullMQ falls back to synchronous execution — fine for dev,
  not for production throughput.
- **`Customer.phone` is stored canonically only where the portal has touched it.**
  Every other write path (POS, field sales, CSV import) still stores the number as
  typed; portal login matches all four shapes via `kePhoneVariants()` and rewrites
  the row on first login. Match on variants, never on an exact string.
- **Rate limits are per client IP, which needs `trust proxy`.** `main.ts` sets it
  from `TRUST_PROXY` (default `1` in production). Without it every request behind a
  load balancer reports the balancer's address and a per-IP limit becomes global.
  `AppThrottlerGuard.getTracker` reads `req.ip`, not the library's spoofable
  `req.ips[0]`.
- **Throw `HttpException` subclasses, never a plain `Error`, for anything a client can
  cause.** A plain `Error` is a 500. There is no global `ValidationPipe`, so use
  `requireArray` / `requireString` from `common/validate.ts` at service entry points
  that take a body field you then dereference.
- **Declare literal routes before `:param` routes in a controller.** Nest matches in
  declaration order; `:id/sync-sale` placed first used to swallow
  `quickbooks/sync-sale`, `xero/sync-sale` and `woocommerce/sync-sale`.
- **Public portal payments trust nothing from the client.** `portal/pay-order` charges
  the order's own `totalCents` (looked up by `orderNumber`) and stores the
  `checkoutRequestId` on the order; `confirm-payment` only accepts that same id.
- **Printers are tenant-scoped and LAN-only.** Every `/printers` route needs a login and
  resolves the printer through its store's `businessId`. `POST /printers/:id/print` opens
  a raw TCP connection from the API host, so it only accepts private IPv4 addresses
  (`printers/network-target.ts`); loopback, link-local and public hosts are refused. The
  API host must share a network with the printer.
- **Checkout is idempotent on `offlineId`.** `POST /sales/checkout` accepts an optional client key (8-64 chars of
  `A-Za-z0-9_-`). A repeat for the same business returns the already-recorded sale (`replayed: true`) with no second
  sale, stock movement or receipt number; two copies racing resolve through the unique key (P2002). A malformed key is
  ignored, and a replay returns the points the sale earned plus the current balance.
  `onBehalfOfCashierId` credits the sale to another user of the same business, but ONLY when the caller is an owner or manager
  (`SalesService.resolveCashierId`): an offline sale uploaded later by someone else keeps its real cashier. Both web tills
  (`lib/checkoutKey.ts`) and the mobile till send one key per checkout attempt, so pressing Pay again after a lost
  response cannot double-post.
- **eTIMS test mode.** `POST /etims/submit/:saleId` returns `testMode: true` (and no `intrlData`/`qrUrl`) when the sale was
  not sent to KRA: the business is not in PRODUCTION with credentials, or the control number is a generated `ETM<timestamp>`
  placeholder. Receipts then print `TEST MODE - NOT A TAX INVOICE` instead of "KRA eTIMS VERIFIED" and a QR.
- **`JWT_SECRET` is required** (`common/jwt-secret.ts`): the API refuses to start without it, and in production rejects
  secrets under 32 characters or that look like the placeholders in this repo. There are no hardcoded fallbacks.
- **App URLs** (`common/app-urls.ts`): links in emails, payment callbacks and redirects come from `frontendUrl()`, `adminUrl()` and
  `appUrl()`. Development defaults to the real local ports (3005 / 3012); production REFUSES to build a link without
  `FRONTEND_URL` / `ADMIN_URL` (delivery tracking links are the one fail-soft case) and logs an error at boot.
- **Print jobs are queued, audited and retried (`print-jobs/`).** `POST /print-jobs` queues ESC/POS bytes for a
  LAN printer: with `PRINT_DELIVERY_MODE=direct` (default) the server sends at once and only queues a failure;
  with `queue` (cloud) a print bridge delivers. The bridge is a desktop till on the shop network: `POST
  /print-jobs/claim` takes jobs under a conditional UPDATE lock (one bridge per job), `POST /print-jobs/:id/result`
  reports back, failures retry with 5 s, 10 s, 20 s... backoff up to 5 attempts, then FAILED. Jobs expire (drawer
  pulse 2 min, kitchen ticket 15 min, receipt 24 h) so a stale ticket never prints late. The bridge only ever gets
  a printer's private IP literal. Prints made on the till itself (browser, USB, Bluetooth, installed printer) are
  logged with `POST /print-jobs/log`, and `POST /print-jobs/receipt-copy` counts how often a sale's receipt has been
  printed so reprints are marked COPY. Listing, retry and cancel are owner/manager only; payloads are never listed.
  `scripts/print-queue.e2e.ts` runs the whole flow against a throwaway Postgres.
- **Print stations (`print-stations/`, `print-bridge/`).** A bridge can sign in with a long-lived station token
  instead of a person's login (which expires). An owner/manager creates a station with `POST /print-stations`
  (the `pst_...` token is returned ONCE; only its SHA-256 is stored), lists them with an `online` flag (seen in the
  last 30 s) and revokes with `DELETE`. The station then calls `POST /print-bridge/claim` and `/:id/result` with
  the `x-print-station-token` header. Those routes are `@Public` to the JWT guard, guarded by `PrintStationGuard`,
  exempt from the per-IP write throttle (it polls), and a station can only ever touch its own store's jobs.
- **Print audit summary.** `GET /print-jobs/summary?storeId&days=7` (owner/manager): totals, failures, reprints per
  person and cash drawers opened by hand (`reason=MANUAL`) per person. A drawer that opens with a cash sale is
  logged with `reason=SALE` (device prints) or `DRAWER_WITH_SALE` on the receipt job (queued prints).
- Migrations must match `schema.prisma`: check with `prisma migrate diff --from-url
  <scratch db> --to-schema-datamodel prisma/schema.prisma`. `WebAuthnCredential` once
  existed only through `db push`.

---

When you add or change an endpoint, module, guard or env var, update this README in
the same change.
