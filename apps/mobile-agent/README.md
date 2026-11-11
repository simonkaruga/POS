# Faida Agent — Field Sales App (mobile-agent)

Expo / React Native app for **field sales agents** (van sales, distribution). Agents
are `User`s with role `SALES_AGENT`; they log in with credentials created for them in
the web POS (Settings → Users).

- Store name: **Faida Agent** · slug `faida-agent` · package `co.ke.faida.agent`
- Router: `expo-router` (file-based)

---

## Develop

```bash
npm install
npx expo start          # scan the QR with Expo Go
npm run typecheck
```

Outside the root npm workspace — install from this directory.

> **Not covered by CI.** The `.github/workflows/ci.yml` mobile matrix type-checks
> `mobile-pos`, `mobile-customer` and `mobile-driver` only. Run `npm run typecheck`
> here manually before pushing.

---

## Screens

| Screen | What it does |
|---|---|
| **Today** (`(tabs)/today`) | Month stats, commission progress, and the call plan — customers to visit, prioritised by outstanding balance |
| **Customers** (`(tabs)/customers`) | Searchable shop list, quick order / call |
| **Order** (`(tabs)/order`) | Pick a customer, add catalogue items, submit. Handles the `CREDIT_LIMIT_EXCEEDED` response |
| **Collections** (`(tabs)/collections`) | Customers with outstanding balances; record cash / M-Pesa payments against unpaid orders |
| **Profile** (`(tabs)/profile`) | Performance, server URL, logout |
| `customer-register` (modal) | Name, phone, KRA PIN, shop type, credit limit, optional GPS capture |

---

## API

Talks to the `field-sales` controller plus `/items` and `/auth/*`:

`/field-sales/agent-stats` · `/field-sales/call-plan` · `/field-sales/customers` ·
`/field-sales/orders` · `/field-sales/credit-collection` · `/items` ·
`/auth/login` · `/auth/login/pin` · `/auth/refresh`

The default server is the deployed cloud API; it is changeable on the login screen
for LAN servers, and `EXPO_PUBLIC_API_URL` sets the shipped default.

Orders captured here land on the office **Field Orders Kanban** (`/field-orders` in
the web app), where staff invoice them (full or partial), record payments, and see
the invoice link back on `FieldOrder.invoiceNumber` / `invoicedAt`.

---

## Offline queueing

Orders, customer registrations and payments work with no signal:

- Each mutation **tries the network first**, so the credit-limit rejection still shows
  instantly when online. On a network failure it is written to a persistent
  AsyncStorage queue ([lib/offline.ts](lib/offline.ts)) and the agent sees a
  "Saved Offline" confirmation.
- `useOfflineSync` flushes the queue on app launch, every 30 s, and whenever the app
  returns to the foreground. A thin amber **SyncBanner** shows the pending count and
  lets the agent force a retry.
- Every queued action carries an `offlineId` (UUID). The backend deduplicates on it
  (`FieldOrder.offlineId`, `Customer.offlineId`, `FieldOrderPayment.offlineId`), so a
  replay of a request that actually succeeded never double-creates an order or
  **double-counts a payment**. Migration:
  `20260613000000_add_field_offline_idempotency`.

**Limitation:** a customer registered while offline has no server id until it syncs,
so you cannot capture an order against that brand-new shop until the registration has
uploaded.

---

## Session handling

Short-lived JWTs are refreshed **proactively** via `/auth/refresh` before expiry
(refresh requires a still-valid token); a 401 logs the agent out rather than
retrying. Push notifications come from the shared
[`@pos/mobile-push`](../../packages/mobile-push/) package.

## Check for updates

Settings / Profile has a **Check for updates** button (`components/UpdateCheck.tsx`, logic in
`lib/appUpdates.ts`). It asks the update server, downloads quietly if there is something new, then
offers **Restart now**. It says "You have the latest version" otherwise, and "not available in a
development build" in `expo start` / Expo Go. Updates are JavaScript only and reach phones on the
**same app version** (`runtimeVersion` follows `expo.version`); native changes need a new APK. Publish
one with `eas update --branch <channel>` (channels `preview` / `production` in `eas.json`).


---

## Build an APK

Wired into `.github/workflows/mobile-release.yml`:

- run the **Mobile Apps Release** workflow (app: `mobile-agent` or `all`), or
- push a `mobile-v*` tag.

**First-time EAS setup:** the app needs an EAS project id. Run `eas init` in this
directory once — it creates `extra.eas.projectId` and `updates.url` in `app.json` —
before the first cloud or `--local` EAS build, and add the `EXPO_TOKEN` repo secret
if it isn't already present.

---

When you add a screen, a `field-sales` endpoint, or a new queued mutation type,
update this README in the same change.
