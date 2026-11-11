# Faida Order — Customer App (mobile-customer)

Expo / React Native self-service app for a business's customers: browse the menu,
order, pay with M-Pesa, reserve a table, and track loyalty points.

- Store name: **Faida Order** · slug `faida-customer` · package `co.ke.faida.order`
- Router: `expo-router` (file-based)

---

## Develop

```bash
npm install
npx expo start
npm run typecheck
```

Outside the root npm workspace — install from this directory.

---

## How a customer gets in

There is **no staff login**. The app is scoped to a business (`businessId` held in
`stores/session.ts`, persisted to AsyncStorage), and the customer authenticates with a
**phone OTP** against the customer portal. The session token is stored under
`customer_token` and read by `lib/api.ts` for the `Authorization` header.

Browsing the menu works unauthenticated; ordering, order history, profile and loyalty
require the OTP session.

`request-otp` returns `expiresInSeconds` and `resendInSeconds`; `LoginGate` counts
both down so the customer can see the code's 10-minute deadline and when Resend goes
live, rather than discovering the 60s cooldown by being refused. Take the timings
from the response — do not hardcode them, or the screen drifts from what the server
enforces.

---

## Screens

| Screen | What it does |
|---|---|
| **Home** (`(tabs)/index`) | Business landing — featured items, quick actions |
| **Menu** (`(tabs)/menu`) | Full catalogue with categories |
| **Cart** (`(tabs)/cart`) | Line items, quantities, totals |
| **Orders** (`(tabs)/orders`) | Order history + one-tap reorder |
| **Loyalty** (`(tabs)/loyalty`) | Points balance and history |
| **Profile** (`(tabs)/profile`) | Name/email, saved addresses, account deletion |
| `checkout` | Order type, address, notes, payment |
| `order-confirm` | Confirmation + status |
| `reserve` | Table reservation request |

---

## API surface

All customer-facing endpoints live under `/portal`:

| Endpoint | Use |
|---|---|
| `POST /portal/order` | Place an order |
| `POST /portal/pay-order` | Trigger an M-Pesa STK prompt |
| `GET /portal/pay-status/:checkoutRequestId` | Poll the STK result |
| `POST /portal/reserve` | Request a table reservation |
| `GET /portal/loyalty-lookup` | Points balance |
| `GET · PATCH /portal/me` | Profile |
| `GET /portal/me/orders` | Order history |
| `GET /portal/me/addresses` | Saved delivery addresses |
| `POST /portal/me/delete` | KDPA account-deletion request |

Note the split: **public** portal routes are bare `/portal/*`, **authenticated**
customer routes are namespaced `/portal/me/*` — two `@Controller('portal')` classes
exist on the API side and the public one registers first.

---

## Payments

[lib/payments.ts](lib/payments.ts) initiates an M-Pesa STK push for the order total,
then polls `pay-status` until it settles to `paid` / `failed`, or gives up as
`pending` if the customer never acts within the window.

---

## Reorder

[lib/reorder.ts](lib/reorder.ts) exists because portal orders store their line items
only as a **text summary** in `notes` (`portal.service.placeOrder` writes
`"${orderType}: 2x Pizza, 1x Coke. <notes>"`). Reorder parses that summary and matches
the names back against the live menu to recover item ids and current prices. Pure and
unit-tested — if the summary format on the API changes, this parser must change with
it.

---

## Push

Registration goes through the shared
[`@pos/mobile-push`](../../packages/mobile-push/) package; the token is stored on
`Customer.deviceToken`.

## Check for updates

Settings / Profile has a **Check for updates** button (`components/UpdateCheck.tsx`, logic in
`lib/appUpdates.ts`). It asks the update server, downloads quietly if there is something new, then
offers **Restart now**. It says "You have the latest version" otherwise, and "not available in a
development build" in `expo start` / Expo Go. Updates are JavaScript only and reach phones on the
**same app version** (`runtimeVersion` follows `expo.version`); native changes need a new APK. Publish
one with `eas update --branch <channel>` (channels `preview` / `production` in `eas.json`).


---

## Release

`.github/workflows/mobile-release.yml` — run **Mobile Apps Release**
(app: `mobile-customer` or `all`) or push a `mobile-v*` tag. Produces an Android APK.
CI type-checks this app on every push.

---

When you add a screen or a `/portal` endpoint — or change the order-notes summary
format that reorder parses — update this README in the same change.
