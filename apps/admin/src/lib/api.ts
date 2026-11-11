// When VITE_API_URL is set, strip any trailing path segments so we always end up
// with just the origin (e.g. https://faida-api.onrender.com).
// When it is NOT set, use a relative base so the Vercel proxy handles routing.
const _raw = import.meta.env.VITE_API_URL as string | undefined;
const _origin = _raw
  ? _raw.replace(/\/(api(\/v\d+)?(\/super-admin)?)\/?$/, '')
  : '';
const API_BASE = `${_origin}/api/v1/super-admin`;

let _token = '';

export function setAdminToken(token: string, email?: string) {
  _token = token;
  sessionStorage.setItem('admin-token', token);
  if (email) sessionStorage.setItem('admin-email', email);
}

export function getAdminToken(): string {
  if (_token) return _token;
  _token = sessionStorage.getItem('admin-token') ?? '';
  return _token;
}

export function getAdminEmail(): string {
  return sessionStorage.getItem('admin-email') ?? 'admin@faidapos.co.ke';
}

export function clearAdminToken() {
  _token = '';
  sessionStorage.removeItem('admin-token');
  sessionStorage.removeItem('admin-email');
}

async function request<T>(path: string, opts: RequestInit = {}, isLogin = false): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

  if (res.status === 401) {
    if (isLogin) {
      // During login, 401 = wrong credentials — show the error, don't redirect
      const body = await res.json().catch(() => ({})) as { message?: string };
      throw new Error(body.message ?? 'Invalid email or password');
    }
    clearAdminToken();
    window.location.href = '/';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Some admin-authorised endpoints live outside the /super-admin prefix (e.g. the
// affiliate program, guarded by SuperAdminAuthGuard). Hit the API root directly.
const API_ROOT = `${_origin}/api/v1`;
async function requestRoot<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${API_ROOT}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
  });
  if (res.status === 401) { clearAdminToken(); window.location.href = '/'; throw new Error('Session expired'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const adminApi = {
  login: (email: string, password: string) =>
    request<{ token: string }>('/login', { method: 'POST', body: JSON.stringify({ email, password }) }, true),

  getStats: () => request<any>('/stats'),

  getBusinesses: (page = 1, search?: string) =>
    request<any>(`/businesses?page=${page}&limit=20${search ? `&search=${encodeURIComponent(search)}` : ''}`),

  getRecentSignups: () => request<any[]>('/businesses/recent'),

  updateSubscription: (id: string, data: any) =>
    request<any>(`/businesses/${id}/subscription`, { method: 'PATCH', body: JSON.stringify(data) }),

  impersonate: (id: string) =>
    request<{ token: string; businessName: string; ownerEmail: string }>(`/businesses/${id}/impersonate`, { method: 'POST' }),

  getLicenseKeys: () => request<any>('/license-keys'),

  createLicenseKey: (tier: string, expiresAt?: string) =>
    request<any>('/license-keys', { method: 'POST', body: JSON.stringify({ tier, expiresAt }) }),

  releaseLicenseKey: (id: string) =>
    request<any>(`/license-keys/${id}/release`, { method: 'PATCH' }),

  revokeKey: (id: string) =>
    request<any>(`/license-keys/${id}/revoke`, { method: 'PATCH' }),

  resendLicenseKey: (id: string) =>
    request<{ success: boolean; sentTo: string }>(`/license-keys/${id}/resend`, { method: 'POST' }),

  regenerateLicenseKey: (id: string) =>
    request<{ success: boolean; newKey: string; sentTo: string }>(`/license-keys/${id}/regenerate`, { method: 'POST' }),

  getHealth: () => request<any>('/health'),

  getBusinessData: (id: string) => request<any>(`/businesses/${id}/data`),

  triggerForceUpdate: (version: string, message: string, isRequired: boolean) =>
    request<any>('/force-update', { method: 'POST', body: JSON.stringify({ version, message, isRequired }) }),

  getReferrals: (page = 1) => request<any>(`/referrals?page=${page}&limit=20`),

  // Affiliate program (guarded by SuperAdminAuthGuard, outside /super-admin)
  getAffiliates: (status?: string) =>
    requestRoot<any[]>(`/affiliate/admin${status && status !== 'ALL' ? `?status=${status}` : ''}`),
  getAffiliate: (id: string) => requestRoot<any>(`/affiliate/admin/${id}`),
  setAffiliateStatus: (id: string, status: string, commissionPercent?: number) =>
    requestRoot<any>(`/affiliate/admin/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, commissionPercent }) }),
  recordAffiliatePayout: (id: string, data: { amountCents: number; method?: string; reference?: string; notes?: string }) =>
    requestRoot<any>(`/affiliate/admin/${id}/payout`, { method: 'POST', body: JSON.stringify(data) }),

  getBusinessUsers: (id: string) => request<any[]>(`/businesses/${id}/users`),

  resetUserPassword: (userId: string) =>
    request<{ tempPassword: string; email: string | null }>(`/users/${userId}/reset-password`, { method: 'POST' }),

  unlockUser: (userId: string) =>
    request<{ success: boolean; name: string }>(`/users/${userId}/unlock`, { method: 'POST' }),

  updateUser: (userId: string, data: { name?: string; role?: string; email?: string }) =>
    request<any>(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  listAllUsers: (page = 1, search?: string, role?: string, businessName?: string, sortBy?: string, sortDir?: string) =>
    request<any>(`/users?page=${page}&limit=30${search ? `&search=${encodeURIComponent(search)}` : ''}${role && role !== 'ALL' ? `&role=${role}` : ''}${businessName ? `&businessName=${encodeURIComponent(businessName)}` : ''}${sortBy ? `&sortBy=${sortBy}&sortDir=${sortDir ?? 'asc'}` : ''}`),

  deleteUser: (userId: string) =>
    request<any>(`/users/${userId}`, { method: 'DELETE' }),

  deleteBusiness: (id: string) =>
    request<any>(`/businesses/${id}`, { method: 'DELETE' }),

  // ── Analytics ──────────────────────────────────────────────────────────
  getChurnAnalytics:      (from?: string, to?: string) => request<any>(`/analytics/churn${from ? `?from=${from}${to ? `&to=${to}` : ''}` : ''}`),
  getCohortAnalysis:      () => request<any>('/analytics/cohort'),
  getBusinessLTV:         (page = 1, sortBy = 'ltv') => request<any>(`/analytics/ltv?page=${page}&sortBy=${sortBy}`),
  getPaystackRevenue:     () => request<any>('/analytics/paystack-revenue'),
  getCollectedRevenue:    () => request<any>('/analytics/collected-revenue'),
  getTrialsExpiringSoon:  (days = 7) => request<any>(`/analytics/trials-expiring?days=${days}`),
  getDunningList:         () => request<any>('/analytics/dunning'),
  getAlertFeed:           () => request<any[]>('/alerts'),

  // ── Business audit log ────────────────────────────────────────────────
  getBusinessAuditLog: (id: string, page = 1) => request<any>(`/businesses/${id}/audit-log?page=${page}&limit=50`),
  getSuperAdminAuditLog: (page = 1) => request<any>(`/audit-log?page=${page}&limit=50`),

  // ── Bulk subscription update ──────────────────────────────────────────
  bulkUpdateSubscriptions: (businessIds: string[], data: { subscriptionStatus?: string; subscriptionTier?: string; trialDays?: number }) =>
    request<any>('/businesses/bulk-update', { method: 'POST', body: JSON.stringify({ businessIds, ...data }) }),

  cancelBusiness: (id: string, reason: string) =>
    request<any>(`/businesses/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // ── IP Whitelist ──────────────────────────────────────────────────────
  getIpWhitelist: () => request<any[]>('/ip-whitelist'),
  addIp: (ip: string, label?: string) =>
    request<any>('/ip-whitelist', { method: 'POST', body: JSON.stringify({ ip, label }) }),
  removeIp: (id: string) => request<any>(`/ip-whitelist/${id}`, { method: 'DELETE' }),

  // ── Webhooks ──────────────────────────────────────────────────────────
  getWebhooks:   (page = 1) => request<any>(`/webhooks?page=${page}&limit=30`),
  retryWebhook:  (id: string) => request<any>(`/webhooks/${id}/retry`, { method: 'POST' }),
  toggleWebhook: (id: string, isActive: boolean) =>
    request<any>(`/webhooks/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),

  // ── Revenue Export ────────────────────────────────────────────────────
  exportRevenueCsv: async () => {
    const token = getAdminToken();
    const res = await fetch(`${API_BASE}/export/revenue-csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `faida-revenue-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
