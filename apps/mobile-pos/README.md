# Faida POS — Cashier App (mobile-pos)

Expo / React Native app for cashiers, waiters and managers. A **floor app**: selling
first, with a role-gated Manage section for the people who actually run the shop.

- Store name: **Faida POS** · slug `faida-pos-cashier` · package `co.ke.faida.pos`
- Router: `expo-router` (file-based)

---

## Develop

```bash
npm install
npx expo start          # scan the QR with Expo Go
npm run typecheck
```

This app is **outside** the root npm workspace — it has its own `package-lock.json`
and must be installed from this directory.

---

## Server URL

Base URL resolution in [lib/api.ts](lib/api.ts):

1. the URL the user picked on the login screen (`SecureStore` key `pos_server_url`),
2. otherwise `EXPO_PUBLIC_API_URL`,
3. otherwise the deployed cloud API.

Point it at a LAN address to run against a local API. **Android needs cleartext
traffic enabled for plain-HTTP LAN URLs.**

---

## Tabs

| Tab | Contents |
|---|---|
| **POS** | The till — item search, barcode scan, cart, payment |
| **Sales** | Sales history and returns |
| **Customers** | Lookup, credit balance, quick create |
| **Reports** | Day summary, X/Z, staff performance |
| **Manage** | Back-office tiles (role-gated — see below) |
| **Settings** | Server URL, POS mode, receipt printing, logout |

Paying a table: the table's order screen opens `payment?orderId=...`. In that mode the screen
ignores the cart (and the cart's customer, promotion and loyalty), shows the order's own lines,
and posts `/sales/checkout` with the `orderId` and the total it displayed (`expectedTotalCents`).
The server bills the order and closes it in one step and refuses if the bill changed meanwhile.
No service charge is added to a table (the web till adds none either; counter sales still follow the setting), credit is not offered (a table has no customer account) and the payment is never queued offline.
The logic lives in `lib/orderPayment.ts` so it is unit-tested; the screen only wires it in.

Extra screens: `payment` · `barcode-scan` · `cash-drawer` · `table-order` ·
`purchase-order` · `my-hr`, plus ~20 `manage-*` screens covering stock, stocktake
sessions, batches, transfers, suppliers, purchase orders, damaged goods, expenses,
approvals, attendance, users, tables, kitchen, day-close and multi-store rollup.

---

## Role gating ([lib/roles.ts](lib/roles.ts))

Three distinct role sets, deliberately not one:

| Set | Roles | Grants |
|---|---|---|
| `MANAGE_ROLES` | OWNER, MANAGER, ADMIN | The Manage section — stock, transfers, users, settings |
| `FINANCE_ROLES` | + ACCOUNTANT | Reports, expenses, cash-drawer oversight, X/Z |
| `canApprove` | = `MANAGE_ROLES` | Leave, expenses, POs, salary advances |

ACCOUNTANT is intentionally in `FINANCE_ROLES` but **not** `MANAGE_ROLES` — they can
see the money without adjusting stock or editing staff, which is the same line the
web app draws. Cashiers and waiters see only **their own** sales; browsing the whole
store's takings is OWNER/MANAGER/ACCOUNTANT only.

The module is pure (no imports), so it unit-tests in plain Node.

---

## POS modes ([lib/posMode.ts](lib/posMode.ts))

The web app renders a whole separate POS page per business type. On a phone that
makes no sense — every vertical collapses to one single-column cart — so mobile keeps
**one** POS screen and varies three things through a capability map:

1. the pre-cart step (which table / pump / station / patient),
2. a few post-cart steps (send to kitchen, end session),
3. which tabs and Manage tiles are visible.

Modes: `RETAIL` `SUPERMARKET` `HOSPITALITY` `FAST_FOOD` `BAR_TAB` `FUEL_PUMP`
`CYBERCAFE` `CLINIC` `SALON`.
Capabilities: `tables` `kitchen` `serviceCharge` `pumps` `appointments`
`prescriptions` `layaway` `batches` `recipes` `delivery`.

A business can also switch on **optional modules** next to its main till (web
Settings, "Also run"). `RESTAURANT` adds the `tables` and `kitchen` capabilities to any
mode, so a fuel station with a restaurant keeps its pump flow and gains the Tables and
Kitchen tiles. The list comes from `enabledModules` on the business settings.

Adding a vertical is **one row in the map**, not an `if` scattered across a dozen
screens. Cybercafé stations are deliberately excluded — they sit at a fixed counter
that already runs the web app.

---

## Offline

[lib/db.ts](lib/db.ts) is an **AsyncStorage** queue, not SQLite (`expo-sqlite` isn't
installed). A sale that cannot reach the server is queued with its `offlineId` and uploaded by
`lib/sync.ts` against `/sales/checkout`. The API treats `offlineId` as an idempotency key
(`SalesService.createSale`): a repeat returns the sale already recorded instead of creating a second one,
so a request that succeeded but whose response was lost can never double-post revenue or stock. (Before
2026-11-04 the server ignored the key and a replay did duplicate the sale.) `payment.tsx` keeps one key per
checkout attempt and only issues a new one when the sale changes or completes.
Items are cached locally for offline lookup.

**Syncing is automatic** (`lib/useOfflineSync.ts`, mounted in `app/_layout.tsx`): on launch, every 30 s,
and when the app returns to the foreground, while someone is signed in. `processSyncQueue()` is single-flight,
so the timer, the foreground trigger and the Settings "Sync Now" button never upload the same sale twice.
Failures are classified (`classifyFailure`):

- lost connection, 5xx, 408/429: kept and retried; the run stops at the first one rather than hammering.
- 4xx (e.g. out of stock): the SERVER refused the sale. It is parked as `rejected`, does not block the sales behind it,
  and shows in red on the sync banner and in Settings with the reason and a Retry button. It is never silently dropped.
- 401: an expired login, not the sale's fault; nothing is recorded against the sale.

`components/SyncBanner.tsx` (above the tabs) shows how many sales are waiting or refused. Tests: `__tests__/sync.test.ts`.

---

## Receipt printing

**Off by default.** Most mobile selling has no printer and relies on the digital
receipt the API sends by SMS/WhatsApp when the sale has a customer. Switch it on in
Settings (Receipt Printing) and choose how to reach the printer and what paper it takes.

| Method | How it prints | Platform |
|---|---|---|
| **Print dialog** | OS print sheet (`expo-print`): a system-paired printer or a PDF. Needs a tap each time | Android, iOS |
| **Bluetooth** | Raw ESC/POS to a printer already paired in the phone's Bluetooth settings (`react-native-bluetooth-classic`, SPP). Silent | Android only |
| **Wi-Fi / LAN** | Raw ESC/POS to `host:9100` (`react-native-tcp-socket`). Silent | Android, iOS |

**Paper size.** 58 mm (small Bluetooth printers, 32 characters per line) or 80 mm
(standard thermal printers, 48 per line). The receipt is laid out for the chosen roll:
item names wrap instead of being cut off, and the amount column grows so a large total
is never truncated. The print dialog uses the same width for its page.

Bluetooth and LAN can **print automatically** when a sale completes. If the printer
cannot be reached the success screen shows the reason and keeps the Print Receipt
button, so a receipt is never silently lost. iOS cannot talk to ordinary Bluetooth
printers (only Apple MFi devices), which is why iPhone users get LAN or the dialog.

Code map (`lib/`):

- `escpos.ts`, `receiptModel.ts`, `receiptHtml.ts`, `printerConfig.ts`, `printDispatch.ts`:
  **pure TypeScript**, unit-tested in `__tests__/printing.test.ts` with fake transports.
  The receipt layout itself is `@pos/print-core` (shared with the web app); `receiptModel.ts#toReceiptDocument`
  adapts the screen's receipt to it, so mobile receipts carry the KRA eTIMS control number and QR code,
  PENDING / VOID banners and a COPY banner on every print after the first. After a sale, `payment.tsx` registers it
  with KRA (`POST /etims/submit/:id`, 8 s cap) before the receipt prints; if KRA cannot be reached the receipt says
  PENDING and the batch submit picks it up.
- `printTransport.ts`: the only file that touches native modules. They are loaded
  lazily inside each call, so a binary built before they existed (the app also gets OTA
  updates) still starts and only shows "update the app" when someone tries to print.
- `receiptPrint.ts`: saved settings (AsyncStorage `mobile-printer-settings`) and the
  public `printReceipt` / `printTestReceipt`.
- `plugins/with-printer-permissions.js`: removes the `ACCESS_FINE_LOCATION` permission
  the Bluetooth library adds (it is only needed for discovery, which this app does not use).

Needs a **new native build** (the app version was raised to 1.2.0 so OTA updates cannot
reach older binaries). Test on a real printer before rolling out: the Bluetooth path
has been compiled and unit-tested but not run against hardware.

---

## Session handling

JWTs are short-lived (15 min email login, 12 h PIN). `lib/api.ts` refreshes
**proactively** before expiry — `/auth/refresh` requires a still-valid token — and a
401 logs the user out rather than retrying. Without this, an expired token surfaced
to the cashier as a bare "no sales found".

### Fingerprint / face sign-in ([lib/biometricLogin.ts](lib/biometricLogin.ts))

After a PIN or password sign-in the app offers to turn this on (Settings -> Security
toggles it later). The server issues a revocable **device token** (`POST /auth/device-token`,
stored hashed in `UserSession`, 90 days sliding), the app keeps it in `SecureStore`, and
releases it only after `expo-local-authentication` passes. The token is traded for a normal
12 h session at `POST /auth/login/device`. No password, PIN or JWT is stored for this, Logout
keeps it (that is the point), and turning it off or a 401 from the server removes it.
It is native code, so it needs a **new build** (`eas build`), not an OTA update. Only
mobile-pos has it; the customer, driver and agent apps do not.

Push notifications come from the shared [`@pos/mobile-push`](../../packages/mobile-push/)
package.

## Check for updates

Settings / Profile has a **Check for updates** button (`components/UpdateCheck.tsx`, logic in
`lib/appUpdates.ts`). It asks the update server, downloads quietly if there is something new, then
offers **Restart now**. It says "You have the latest version" otherwise, and "not available in a
development build" in `expo start` / Expo Go. Updates are JavaScript only and reach phones on the
**same app version** (`runtimeVersion` follows `expo.version`); native changes need a new APK. Publish
one with `eas update --branch <channel>` (channels `preview` / `production` in `eas.json`).


---

## Release

Built by `.github/workflows/mobile-release.yml`: run **Mobile Apps Release**
(app: `mobile-pos` or `all`) or push a `mobile-v*` tag. Produces an Android APK
artifact. CI type-checks this app on every push.

---

When you add a screen, capability, role rule or offline queue type, update this
README in the same change.
