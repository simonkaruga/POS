/**
 * API base URL resolution order:
 *  1. localStorage 'faida-server-url'  — set by desktop setup wizard (cloud or LAN server)
 *  2. Tauri desktop with no stored URL  — deployed cloud API (a relative URL would
 *     resolve against tauri://localhost and every request would silently fail)
 *  3. VITE_API_URL env var              — set at build time for web deployment
 *  4. /api/v1                           — relative path (works via Vite proxy in dev)
 */
const FAIDA_CLOUD_API = 'https://faida-api.onrender.com/api/v1';

function resolveApiUrl(): string {
  try {
    const stored = localStorage.getItem('faida-server-url');
    if (stored) return stored.replace(/\/$/, '') + '/api/v1';
  } catch { /* localStorage unavailable (kiosk/standalone context) */ }
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  if (w.__TAURI_INTERNALS__ ?? w.__TAURI__) return FAIDA_CLOUD_API;
  return import.meta.env.VITE_API_URL ?? '/api/v1';
}

const API_URL = resolveApiUrl();
export function getApiUrl(): string { return API_URL; }

// Token stored in memory (module-level) — NOT localStorage per security rules.
// sessionStorage is acceptable for tab-scoped persistence.
let _accessToken = '';
let _tokenExpiry = 0; // timestamp when token expires
let _refreshPromise: Promise<void> | null = null; // prevent concurrent refresh calls

/**
 * Read the expiry out of a JWT (milliseconds since the epoch). A token whose expiry cannot be read is assumed to last
 * 15 minutes, which is what the API issues for an email login.
 */
export function tokenExpiryMs(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    if (typeof payload.exp === 'number') return payload.exp * 1000;
  } catch {
    /* fall through */
  }
  return Date.now() + 15 * 60 * 1000;
}

export function setToken(token: string): void {
  _accessToken = token;
  sessionStorage.setItem('pos-access-token', token);
  _tokenExpiry = tokenExpiryMs(token);
}

export function getToken(): string {
  if (_accessToken) return _accessToken;
  // Restore from sessionStorage on page refresh
  const stored = sessionStorage.getItem('pos-access-token');
  if (stored) {
    _accessToken = stored;
    // Work out when it expires. Without this the expiry stayed 0 after every reload, so the first request of every page
    // load did a needless /auth/refresh and every other request waited behind it.
    _tokenExpiry = tokenExpiryMs(stored);
    return _accessToken;
  }
  // Pick up token passed from a parent tab (kiosk new-tab handoff)
  const kioskToken = localStorage.getItem('kiosk-tab-token');
  if (kioskToken) {
    _accessToken = kioskToken;
    _tokenExpiry = tokenExpiryMs(kioskToken);
    sessionStorage.setItem('pos-access-token', kioskToken);
    localStorage.removeItem('kiosk-tab-token'); // consume so it's not reused
  }
  return _accessToken;
}

export function clearToken(): void {
  _accessToken = '';
  _tokenExpiry = 0;
  _refreshPromise = null;
  sessionStorage.removeItem('pos-access-token');
}

/**
 * Auto-refresh token if it's expiring soon (within 2 minutes)
 * Returns true if refresh was needed and succeeded
 */
async function maybeRefreshToken(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  
  const now = Date.now();
  const timeUntilExpiry = _tokenExpiry - now;
  
  // If token expires in less than 2 minutes, refresh it
  if (timeUntilExpiry < 2 * 60 * 1000) {
    // Prevent concurrent refresh calls
    if (_refreshPromise) {
      await _refreshPromise;
      return true;
    }
    
    _refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (res.ok) {
          const data = await res.json() as { accessToken: string };
          setToken(data.accessToken);
        } else {
          // Refresh failed - token is invalid, log out
          clearToken();
          sessionStorage.removeItem('pos-auth');
          window.location.href = '/';
        }
      } catch (err) {
        console.error('Token refresh failed:', err);
      } finally {
        _refreshPromise = null;
      }
    })();
    
    await _refreshPromise;
    return true;
  }
  
  return false;
}

/** An error response from the server. `status` tells a REFUSED request (4xx) from a server that is not there (502-504). */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    clearToken();
    sessionStorage.removeItem('pos-auth'); // Clear Zustand persisted auth so reload shows login
    window.location.href = '/';
    throw new Error('Session expired');
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json() as { message?: string };
      message = body.message ?? message;
    } catch {
      // ignore parse error
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function authHeaders(includeContentType = true): HeadersInit {
  const token = getToken();
  return {
    ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const api = {
  async get<T>(endpoint: string): Promise<T> {
    await maybeRefreshToken();
    const res = await fetch(`${API_URL}${endpoint}`, {
      headers: authHeaders(false),
    });
    return handleResponse<T>(res);
  },

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    await maybeRefreshToken();
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: authHeaders(),
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    return handleResponse<T>(res);
  },

  async patch<T>(endpoint: string, data: unknown): Promise<T> {
    await maybeRefreshToken();
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<T>(res);
  },

  /**
   * PATCH as another signed-in person. A shared kitchen screen stays logged in as
   * the terminal; when a chef types their PIN to claim a ticket the change must be
   * made under THEIR token, or the server records the terminal as the cook.
   */
  async patchAs<T>(token: string, endpoint: string, data: unknown): Promise<T> {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    return handleResponse<T>(res);
  },

  async put<T>(endpoint: string, data: unknown): Promise<T> {
    await maybeRefreshToken();
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<T>(res);
  },

  async delete<T>(endpoint: string): Promise<T> {
    await maybeRefreshToken();
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'DELETE',
      headers: authHeaders(false),
    });
    return handleResponse<T>(res);
  },
};

export async function openPdfReport(path: string): Promise<void> {
  // Fetch the HTML report with auth token, then open in a new tab as a Blob URL
  // (window.open directly would fail because the new tab has no JWT in sessionStorage)
  await maybeRefreshToken();
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `Could not open the document (${res.status})`;
    try {
      const body = await res.json() as { message?: string };
      if (body.message) message = body.message;
    } catch { /* response was not JSON */ }
    throw new Error(message);
  }
  const html = await res.text();
  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  // Revoke the blob URL after a delay so the new tab has time to load
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  if (!w) {
    // Popup blocked — fall back: create a hidden link and click it
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.click();
  }
}

export default api;
