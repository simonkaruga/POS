import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../stores/auth';
import { secondsUntilExpiry } from './jwt';

/** An error from the server, with its HTTP status so callers can tell a rejected request from a lost connection. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// Must match DEFAULT_URL in app/(auth)/login.tsx — the login screen stores the
// chosen URL under SERVER_URL_KEY, which this module reads for every request.
// Same deployed API the web app uses (see apps/web/vercel.json rewrite).
const DEFAULT_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://faida-api.onrender.com/api/v1';
const SERVER_URL_KEY = 'pos_server_url';
const TOKEN_KEY = 'pos_token';

async function getBaseUrl(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(SERVER_URL_KEY);
    return stored ?? DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

// ── Session handling ─────────────────────────────────────────────────────────
let refreshInFlight: Promise<string | null> | null = null;

/** Proactively refresh the access token while it is still valid, so an active
 *  cashier is never bounced to login mid-shift. Returns the token to use. */
async function ensureFreshToken(token: string | null, baseUrl: string): Promise<string | null> {
  if (!token) return null;
  const left = secondsUntilExpiry(token);
  // Refresh when <2 min remain but still valid (refresh endpoint needs a live token).
  if (left === null || left > 120 || left <= 0) return token;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return token;
        const data = (await res.json().catch(() => ({}))) as { accessToken?: string };
        const next = data.accessToken;
        if (next) {
          await SecureStore.setItemAsync(TOKEN_KEY, next).catch(() => {});
          useAuthStore.getState().setTokenFromStorage(next);
          return next;
        }
        return token;
      } catch {
        return token;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return (await refreshInFlight) ?? token;
}

/** Wipe the session so the SessionGuard redirects to the login screen. */
function forceLogout() {
  SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  useAuthStore.getState().clearAuth();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const baseUrl = await getBaseUrl();
  let token = await getToken();
  token = await ensureFreshToken(token, baseUrl);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  // Expired/invalid session → log out cleanly instead of showing empty data.
  if (res.status === 401 && token) {
    forceLogout();
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError((err as { message?: string }).message ?? `API error ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const mobileApi = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export function formatKES(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
