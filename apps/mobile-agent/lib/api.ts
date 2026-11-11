import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../stores/auth';
import { secondsUntilExpiry } from './jwt';

export const SERVER_URL_KEY = 'agent_server_url';
// Same deployed API the web app uses (apps/web/vercel.json proxies /api here).
export const DEFAULT_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://faida-api.onrender.com/api/v1';
const TOKEN_KEY = 'agent_token';

export async function getBaseUrl(): Promise<string> {
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

let refreshInFlight: Promise<string | null> | null = null;

/** Proactively refresh the access token while still valid so an active agent
 *  isn't bounced to login mid-visit (login issues a short-lived token). */
async function ensureFreshToken(token: string | null, baseUrl: string): Promise<string | null> {
  if (!token) return null;
  const left = secondsUntilExpiry(token);
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
        if (data.accessToken) {
          await SecureStore.setItemAsync(TOKEN_KEY, data.accessToken).catch(() => {});
          useAuthStore.setState({ token: data.accessToken });
          return data.accessToken;
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

  if (res.status === 401 && token) {
    useAuthStore.getState().clearAuth();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? `API error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const agentApi = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** RN fetch fails with the opaque "Network request failed" — translate it. */
export function friendlyError(e: unknown, fallback: string): string {
  const msg = (e as Error)?.message ?? '';
  if (msg.includes('Network request failed')) {
    return 'Could not reach the server. Check your internet connection, or if using a LAN server make sure this phone is on the same Wi-Fi.';
  }
  return msg || fallback;
}

export function formatKES(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
