# Faida Driver — Delivery App (mobile-driver)

Expo / React Native app for delivery drivers. Drivers are `User`s with the driver
role, created in the web POS; they log in with the credentials issued to them.

- Store name: **Faida Driver** · slug `faida-driver` · package `co.ke.faida.driver`
- Router: `expo-router` (file-based)

---

## Develop

```bash
npm install
npx expo start
npm run typecheck
```

Outside the root npm workspace — install from this directory. The server URL is
chosen on the login screen (defaults to `EXPO_PUBLIC_API_URL` or the deployed cloud
API), so it can be pointed at a LAN server.

---

## Screens

| Screen | What it does |
|---|---|
| **Deliveries** (`(tabs)/deliveries`) | Assigned jobs, status, accept/start |
| **Map** (`(tabs)/map`) | Jobs with coordinates; hands off to the phone's maps app for turn-by-turn |
| **Earnings** (`(tabs)/earnings`) | Payout summary from `/delivery/driver-earnings/:driverId` |
| **History** (`(tabs)/history`) | Completed deliveries |
| **Profile** (`(tabs)/profile`) | Server URL, pay rate, logout |
| `delivery/[id]` | Full job detail — customer, address, items, status transitions, proof of delivery |

Navigation is **not** an embedded map — `react-native-maps` is not a dependency. The
map tab lists jobs and opens the device's native maps app via `Linking`, which keeps
the bundle small and gives drivers the navigation app they already know.

---

## Live location

[lib/location.ts](lib/location.ts) broadcasts the driver's position to
`POST /delivery/driver-location` while the app is open and the driver is logged in,
tagging the active delivery id so the server can run its proximity/arrival check.
Dispatch and the customer's public tracking page (`/track/:orderNumber` on the web
app) read from this.

**Foreground only** — no background-location permission is requested.

---

## Offline queue

Drivers lose signal in basements, lifts and rural drops. Status updates (picked up /
delivered / failed) are written to a persistent AsyncStorage queue
([lib/offline.ts](lib/offline.ts)) and flushed when connectivity returns, so a tap in
a dead zone is never lost.

Each queued action carries an `offlineId`, and status PATCHes are idempotent —
setting a status twice yields the same result — so replaying a request that actually
succeeded is safe. `useOfflineSync` flushes on launch, every 30 s, and whenever the
app returns to the foreground.

This mirrors `apps/mobile-agent/lib/offline.ts` but is generalised to any HTTP method
(`POST` / `PATCH` / `PUT` / `DELETE`).

---

## Session handling

`/auth/login`, `/auth/login/pin`, and proactive `/auth/refresh` before expiry — a 401
logs out rather than retrying, since `/auth/refresh` requires a still-valid token.

Push notifications via the shared
[`@pos/mobile-push`](../../packages/mobile-push/) package. Receipts/PODs can be
produced through `expo-print`.

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
(app: `mobile-driver` or `all`) or push a `mobile-v*` tag. Produces an Android APK.
CI type-checks this app on every push.

---

When you add a screen, a `/delivery` endpoint, or a new queued action type, update
this README in the same change.
