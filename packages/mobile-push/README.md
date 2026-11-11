# @pos/mobile-push

Shared Expo push-notification client used by all four Faida mobile apps
(`mobile-pos`, `mobile-customer`, `mobile-driver`, `mobile-agent`).

Consumed straight from source (`main` / `react-native` both point at `src/index.ts`)
— there is no build step.

---

## Two halves, deliberately separated

| Module | Imports native code? | Use |
|---|---|---|
| [src/routing.ts](src/routing.ts) | **No** | Pure payload parsing + route resolution. Runs under plain-Node ts-jest and is unit-tested |
| [src/client.ts](src/client.ts) | Yes | Token registration, the `usePushNotifications` hook, Android channel setup |

The split exists so the interesting logic — deciding *where a tap should navigate* —
is testable without a device or an Expo runtime.

```ts
import {
  registerForPushNotificationsAsync,
  usePushNotifications,
  setupAndroidChannel,
  parseNotificationData,
  resolveRoute,
} from '@pos/mobile-push';
```

Peer dependencies (provided by each app): `expo-notifications`, `expo-device`,
`expo-constants`, `react`.

---

## Routing

`parseNotificationData(raw)` normalises Expo's arbitrary `data` payload into
`{ type, id, raw }`, accepting either `id` or `entityId` and coercing a numeric id to
a string.

`resolveRoute(data, map)` substitutes the id into a path template and returns
**`null`** when no mapping applies — so the app falls back to its home screen instead
of navigating somewhere wrong.

```ts
const route = resolveRoute(parseNotificationData(notification.data), {
  delivery: '/delivery/:id',
  order:    '/(tabs)/orders',
});
```

Each app passes **its own** route map, because the four apps have different route
trees. That is why this package stays app-agnostic: no route table lives here.

Common `type` values in use: `delivery`, `order`, `collection`, `low_stock`.

---

## Server side

Tokens are registered by the API's `PushModule` and stored on `User.deviceToken`
(staff, driver, agent) or `Customer.deviceToken` (customer app).

---

## Test

```bash
npm test        # jest — covers src/routing.ts
```

---

When you add a notification `type`, change the payload shape, or add a client
export, update this README and the routing tests in the same change.
