/**
 * Role-based access policy for the whole API.
 *
 * Tenant isolation (TenantGuard) stops one business reading another's data. It
 * does nothing about what a logged-in user may do INSIDE their own business, and
 * until this file existed any valid token — cashier, waiter, kitchen, driver,
 * sales agent — could create OWNER users, change settings or read profit and
 * loss. The apps only hid the screens.
 *
 * Two layers, both evaluated by RoleAccessGuard:
 *
 *  1. RULES: ordered, first match wins. A matched rule lists the roles that may
 *     call the route. Routes no rule matches stay open to every authenticated
 *     role, so adding this guard cannot break an endpoint nobody classified yet.
 *     New management-only endpoints must be added here.
 *  2. NARROW_ROLE_ALLOWLIST: DRIVER, SALES_AGENT and KITCHEN sign in to a single
 *     purpose-built screen, so for them the default flips to deny: they reach
 *     only the prefixes their app uses.
 *
 * Paths are matched without the `/api/v1` prefix and without the query string.
 * In a pattern `:x` or `*` matches exactly one segment and a trailing `**`
 * matches any remaining segments (including none).
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const ALL_ROLES = [
  'OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'CASHIER', 'WAITER', 'KITCHEN', 'DRIVER', 'SALES_AGENT',
] as const;

/** ADMIN is a legacy owner-level role string still present in older data. */
const OWN = ['OWNER', 'ADMIN'] as const;
const MGMT = [...OWN, 'MANAGER'] as const;
const FIN = [...MGMT, 'ACCOUNTANT'] as const;
const FLOOR = [...MGMT, 'CASHIER', 'WAITER'] as const;
const FLOOR_ACC = [...FLOOR, 'ACCOUNTANT'] as const;
const DISPATCH = [...MGMT, 'CASHIER'] as const;
const ALL: readonly string[] = ALL_ROLES;

export const NARROW_ROLES = ['DRIVER', 'SALES_AGENT', 'KITCHEN'] as const;

export interface AccessRule {
  /** Omitted = every method. */
  methods?: readonly Method[];
  path: string;
  roles: readonly string[];
}

const r = (
  methods: Method | readonly Method[] | '*',
  path: string,
  roles: readonly string[],
): AccessRule => ({
  methods: methods === '*' ? undefined : typeof methods === 'string' ? [methods] : methods,
  path,
  roles,
});

const WRITE: readonly Method[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

export const ACCESS_RULES: readonly AccessRule[] = [
  // ── Self-service every signed-in user needs ───────────────────────────────
  r('*', '/auth/**', ALL),
  r('*', '/push/**', ALL),
  r('GET', '/health', ALL),

  // ── Licence (the offline edition): everyone may read the status that drives the banner; the owner activates ──────────
  r('GET', '/license/status', ALL),
  r('POST', '/license/activate', OWN),
  r('POST', '/license/renew', MGMT),

  // ── Business: settings, credentials, staff accounts ───────────────────────
  r('POST', '/business/:id/cancel-subscription', OWN),
  r('PATCH', '/business/:id/etims-credentials', OWN),
  r('PATCH', '/business/:id/mpesa-credentials', OWN),
  r('PATCH', '/business/:id/at-credentials', OWN),
  r('POST', '/business/:id/stores', OWN),
  r('PATCH', '/business/:id/settings', MGMT),
  r('GET', '/business/:id/subscription', MGMT),
  // Role/PIN/password changes: MGMT here, then assertCanManageUser stops a
  // manager touching or creating owner-level accounts.
  r('GET', '/business/:id/users', ALL),
  r('*', '/business/:id/users/**', MGMT),
  r('GET', '/business/:id/exchange-rates', ALL),
  r('*', '/business/:id/exchange-rates/**', MGMT),

  // ── Security, roles, integrations, audit ──────────────────────────────────
  r(['POST'], '/security/change-password', ALL),
  r(['POST'], '/security/validate-password', ALL),
  r('GET', '/security/password-policy', ALL),
  r('GET', '/security/password-expiry/:id', ALL),
  r('GET', '/security/audit-logs', FIN),
  r('POST', '/security/tax/zero-rated', MGMT),
  r('GET', '/security/**', MGMT),
  r('*', '/security/**', OWN),
  r('*', '/api-keys/**', OWN),
  r('*', '/webhooks/**', MGMT),
  r('*', '/integrations/**', MGMT),
  r('*', '/audit/**', FIN),
  r('*', '/franchise/**', OWN),
  r('*', '/kdpa/**', MGMT),
  r('POST', '/subscription/checkout', OWN),

  // ── Reports: money. Cashiers keep their own X/Z and the document PDFs ─────
  r('GET', '/reports/x-report', FLOOR_ACC),
  r('POST', '/reports/z-report', FLOOR_ACC),
  // The web dashboard loads today's sales for every role.
  r('GET', '/reports/sales', FLOOR_ACC),
  r('GET', '/reports/pdf/sale/:id', FLOOR_ACC),
  r('GET', '/reports/pdf/customer-statement/:id', FLOOR_ACC),
  r('GET', '/reports/pdf/field-order-invoice/:id', FLOOR_ACC),
  r('GET', '/reports/pdf/field-order-delivery-note/:id', FLOOR_ACC),
  r('GET', '/reports/pdf/delivery-receipt/:id', FLOOR_ACC),
  r('GET', '/reports/pdf/debit-note/:id', FLOOR_ACC),
  r('GET', '/reports/full-data-export', OWN),
  r('GET', '/reports/audit-log-export', OWN),
  r('*', '/reports/**', FIN),
  r('*', '/forecasting/**', MGMT),
  r('*', '/report-schedules/**', MGMT),
  r('*', '/budgets/**', FIN),

  // ── HR: staff self-service first, everything else is management ───────────
  r('*', '/hr/time-entries/**', ALL),
  r('*', '/hr/biometric/**', ALL),
  r('POST', '/hr/attendance/clock-in', ALL),
  r('PATCH', '/hr/attendance/:id/clock-out', ALL),
  r('GET', '/hr/attendance/:id', ALL),
  // Known gap: the employee list includes pay. my-hr (mobile) needs it to find
  // the caller's own record; narrow it when that screen gets a /hr/me endpoint.
  r('GET', '/hr/employees', ALL),
  r(['GET', 'POST'], '/hr/leave', ALL),
  r('GET', '/hr/leave/:id', ALL),
  r('GET', '/hr/leave-balance', ALL),
  r(['GET', 'POST'], '/hr/salary-advances', ALL),
  r(['GET', 'POST'], '/hr/expense-claims', ALL),
  r('GET', '/hr/shifts', ALL),
  r('*', '/hr/**', MGMT),

  // ── Money out ─────────────────────────────────────────────────────────────
  r('PATCH', '/expenses/:id/approve', MGMT),
  r('PATCH', '/expenses/:id/reject', MGMT),
  r('PATCH', '/expenses/approval-steps/**', MGMT),
  r('POST', '/expenses/petty-cash/top-up', MGMT),
  r('POST', '/expenses/petty-cash/disburse', MGMT),
  r('*', '/expenses/**', FIN),
  r('POST', '/payments/mpesa/b2c', OWN),
  r('POST', '/payments/mpesa/b2c-bulk', OWN),
  r('POST', '/payments/mpesa/c2b/register', OWN),
  r('*', '/payments/mpesa/c2b/**', FIN),
  r('*', '/payments/reconciliation/**', FIN),
  r('POST', '/payments/paystack/initiate', FIN),
  r('*', '/payments/cheques/**', FIN),
  r('*', '/accounting/journal/**', FIN),
  r('GET', '/cash-drawer/active-sessions', FIN),
  r('*', '/cash-drawer/**', FLOOR_ACC),
  r('*', '/etims/production-onboarding', OWN),
  r('*', '/etims/switch-production/:id', OWN),
  r('*', '/etims/enable-itax', OWN),
  r('*', '/etims/submit-vat-return', OWN),
  r('GET', '/etims/vat-return-data', FIN),
  r('GET', '/etims/status', FIN),
  r('GET', '/etims/attention', FIN),
  r('GET', '/etims/calls', OWN),
  r('POST', '/etims/sales/:id/retry', FIN),
  r('GET', '/etims/item-classes', MGMT),
  r('POST', '/etims/item-classes/sync', OWN),
  r('PATCH', '/etims/items', MGMT),
  r('PATCH', '/etims/default-item-class', OWN),
  r('POST', '/etims/stock/report', OWN),

  // ── Stock, purchasing, catalogue ──────────────────────────────────────────
  r('POST', '/inventory/adjustment', MGMT),
  r('PATCH', '/items/:id/86', [...FLOOR, 'KITCHEN']),
  r('POST', '/items/gs1-decode', FLOOR),
  r('POST', '/items/check-expiry', FLOOR),
  r(WRITE, '/items/**', MGMT),
  r('GET', '/suppliers/**', FIN),
  r(WRITE, '/suppliers/**', MGMT),
  r('*', '/transfers/**', MGMT),
  r('*', '/stocktake/**', MGMT),
  r(WRITE, '/printers/**', MGMT),

  // ── Promotions, loyalty, outbound messages ────────────────────────────────
  r('POST', '/promotions/:id/apply', FLOOR),
  r(WRITE, '/promotions/**', MGMT),
  r('POST', '/loyalty/earn', FLOOR),
  r('POST', '/loyalty/redeem', FLOOR),
  r(WRITE, '/loyalty/**', MGMT),
  // The shared SMS account is billed per message, so bulk/free-text sending is
  // management only; a receipt to the customer just served stays with the till.
  r('POST', '/notifications/send-receipt', FLOOR),
  r(['POST'], '/notifications/sms', MGMT),
  r(['POST'], '/notifications/whatsapp', MGMT),
  r(['POST'], '/notifications/promotion', MGMT),
  r(['POST'], '/notifications/loyalty-points', MGMT),

  // ── Floor, delivery, field sales ──────────────────────────────────────────
  r('POST', '/hospitality/tables', MGMT),
  r(['PATCH', 'DELETE'], '/hospitality/tables/:id', MGMT),
  r(['POST', 'DELETE'], '/hospitality/happy-hours/**', MGMT),
  r('*', '/delivery-routes/**', MGMT),
  r(['POST'], '/delivery/zones', MGMT),
  r(['POST'], '/delivery/couriers', MGMT),
  r(['POST'], '/delivery/courier/push', DISPATCH),
  r('GET', '/delivery/sla-report', MGMT),
  r('GET', '/delivery/driver-locations', DISPATCH),
  r('GET', '/delivery/driver-locations/:id', DISPATCH),
  r('PATCH', '/delivery/:id/assign', DISPATCH),
  r('PUT', '/delivery/orders/:id/assign-driver', DISPATCH),
  r('PUT', '/delivery/orders/:id/reschedule', DISPATCH),
  r('POST', '/field-sales/routes', MGMT),
  r(['PATCH', 'DELETE'], '/field-sales/routes/:id', MGMT),
  r('PATCH', '/field-sales/customers/:id/route', MGMT),
  r('PATCH', '/field-sales/credit-requests/:id/review', MGMT),
  r('PATCH', '/field-sales/orders/:id/status', DISPATCH),
  r('POST', '/field-sales/orders/:id/generate-invoice', DISPATCH),
  r('POST', '/field-sales/orders/:id/generate-partial-invoice', DISPATCH),
  r('POST', '/field-sales/orders/bulk-generate-invoices', DISPATCH),

  // ── Fuel station ──────────────────────────────────────────────────────────
  // Attendants (cashiers) run the forecourt: authorise pumps, record sales, open and close shifts. Prices,
  // credit limits, tank levels and fleet money are management's: a pump attendant who can edit the price
  // per litre or a fleet account's credit limit can sell fuel for nothing.
  r('POST', '/fuel-pump/sales', FLOOR),
  r('POST', '/fuel-pump/pumps/:id/authorize', FLOOR),
  r('POST', '/fuel-pump/pumps/:id/stop', FLOOR),
  r('POST', '/fuel-pump/shifts/open', FLOOR),
  r('POST', '/fuel-pump/shifts/:id/close', FLOOR),
  r('GET', '/fuel-pump/fleet/:id/transactions', FIN),
  r('POST', '/fuel-pump/fleet/:id/payment', FIN),
  r('GET', '/fuel-pump/variance', FIN),
  r(WRITE, '/fuel-pump/**', MGMT),

  // ── Cyber cafe ────────────────────────────────────────────────────────────
  // Running sessions is front-desk work. Voiding one (it can erase a paid session), the rate card, packages
  // and stations are management's. The kiosk routes are public and carry their own @Public().
  r('POST', '/cybercafe/stations/:id/start', FLOOR),
  r('POST', '/cybercafe/sessions/:id/pause', FLOOR),
  r('POST', '/cybercafe/sessions/:id/resume', FLOOR),
  r('POST', '/cybercafe/sessions/:id/end', FLOOR),
  r('POST', '/cybercafe/sessions/:id/extend', FLOOR),
  r('GET', '/cybercafe/stats', FIN),
  r(WRITE, '/cybercafe/**', MGMT),

  // ── Pharmacy ──────────────────────────────────────────────────────────────
  // Patient names, ID numbers and diagnoses are in these records, so waiters get no access at all. There is
  // no pharmacist role yet: dispensing sits with cashiers and above, and everything that edits clinical
  // reference data or cancels a prescription with management.
  r('GET', '/prescriptions/controlled-log', MGMT),
  r('POST', '/prescriptions/controlled-log', DISPATCH),
  r('PATCH', '/prescriptions/:id/cancel', MGMT),
  r('*', '/prescriptions/**', DISPATCH),
  r('GET', '/pharmacy/claims', FIN),
  r('GET', '/pharmacy/claims/stats', FIN),
  r(['POST', 'PATCH'], '/pharmacy/claims/**', FIN),
  r('GET', '/pharmacy/**', DISPATCH),
  r(WRITE, '/pharmacy/**', MGMT),

  // ── Hotel ─────────────────────────────────────────────────────────────────
  // Reception works bookings and the folio; removing a guest's charge or changing the room list is not theirs.
  r('DELETE', '/hospitality/folio-charges/:id', MGMT),
  r(['POST', 'PATCH', 'DELETE'], '/hospitality/hotel-rooms', MGMT),
  r(['PATCH', 'DELETE'], '/hospitality/hotel-rooms/:id', MGMT),

  // ── Appointments ──────────────────────────────────────────────────────────
  r('DELETE', '/appointments/:id', MGMT),
];

/**
 * What a narrow role may reach at all. Anything not listed is denied, whatever
 * RULES say, and RULES still apply on top (a driver cannot POST delivery zones).
 */
const SELF_SERVICE: readonly AccessRule[] = [
  r('*', '/auth/**', ALL),
  r('*', '/push/**', ALL),
  r('GET', '/health', ALL),
];

export const NARROW_ROLE_ALLOWLIST: Readonly<Record<string, readonly AccessRule[]>> = {
  DRIVER: [
    ...SELF_SERVICE,
    r('*', '/delivery/**', ALL),
  ],
  SALES_AGENT: [
    ...SELF_SERVICE,
    r('*', '/field-sales/**', ALL),
    r('GET', '/items', ALL),
    r('GET', '/items/:id', ALL),
    r('GET', '/inventory/stock/:id', ALL),
    r('*', '/businesses/:id/customers/**', ALL),
    r('*', '/businesses/:id/customers', ALL),
  ],
  KITCHEN: [
    ...SELF_SERVICE,
    r('*', '/hospitality/**', ALL),
    r('PATCH', '/items/:id/86', ALL),
    r('*', '/print-jobs/**', ALL),
    r('*', '/hr/time-entries/**', ALL),
    r('*', '/hr/attendance/**', ALL),
    r('GET', '/business/:id/settings', ALL),
    r('GET', '/business/:id/stores', ALL),
    r('GET', '/subscription/**', ALL),
    r('GET', '/notifications/**', ALL),
  ],
};

/** Strip the global prefix, query string and trailing slash. */
export function normalizePath(rawPath: string): string {
  const noQuery = rawPath.split('?')[0];
  const noPrefix = noQuery.replace(/^\/api(\/v\d+)?(?=\/|$)/, '');
  const trimmed = noPrefix.length > 1 ? noPrefix.replace(/\/+$/, '') : noPrefix;
  return trimmed || '/';
}

export function matchesPattern(pattern: string, path: string): boolean {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '**') return true;
    if (i >= s.length) return false;
    if (p[i] === '*' || p[i].startsWith(':')) continue;
    if (p[i] !== s[i]) return false;
  }
  return p.length === s.length;
}

function findRule(rules: readonly AccessRule[], method: string, path: string): AccessRule | undefined {
  return rules.find(
    (rule) =>
      (!rule.methods || rule.methods.includes(method as Method)) && matchesPattern(rule.path, path),
  );
}

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

export function isNarrowRole(role: string): boolean {
  return (NARROW_ROLES as readonly string[]).includes(role);
}

export function evaluateAccess(role: string, method: string, rawPath: string): AccessDecision {
  const m = method.toUpperCase();
  const path = normalizePath(rawPath);

  const allow = NARROW_ROLE_ALLOWLIST[role];
  if (allow && !findRule(allow, m, path)) {
    return { allowed: false, reason: `${role} accounts cannot use ${m} ${path}` };
  }

  const rule = findRule(ACCESS_RULES, m, path);
  if (rule && !rule.roles.includes(role)) {
    return { allowed: false, reason: `Your role (${role}) cannot ${m} ${path}` };
  }
  return { allowed: true };
}

// ── Who may create or change whom ────────────────────────────────────────────

/** Accounts only an owner may create, promote, demote, edit or delete. */
const OWNER_ONLY_TARGETS = ['OWNER', 'ADMIN', 'MANAGER'];

export const ASSIGNABLE_ROLES = ALL_ROLES.filter((x) => x !== 'ADMIN');

/**
 * Route access lets a manager through to staff management; this decides what
 * they may do there. Without it a manager could mint an OWNER, or reset the
 * owner's PIN/password and sign in as them.
 *
 * @param actorRole  role in the caller's token
 * @param targetRole current role of the account being edited (omit when creating)
 * @param newRole    role being assigned (omit when the role is not changing)
 */
export function assertCanManageUser(
  actorRole: string,
  targetRole: string | undefined,
  newRole: string | undefined,
): void {
  if (newRole !== undefined && !(ASSIGNABLE_ROLES as readonly string[]).includes(newRole)) {
    throw new BadRequestException(`Unknown role: ${newRole}`);
  }
  if ((OWN as readonly string[]).includes(actorRole)) return;
  if (actorRole !== 'MANAGER') {
    throw new ForbiddenException('Only an owner or manager can manage staff accounts');
  }
  if (targetRole && OWNER_ONLY_TARGETS.includes(targetRole)) {
    throw new ForbiddenException('Only an owner can change an owner or manager account');
  }
  if (newRole && OWNER_ONLY_TARGETS.includes(newRole)) {
    throw new ForbiddenException('Only an owner can assign the owner or manager role');
  }
}
