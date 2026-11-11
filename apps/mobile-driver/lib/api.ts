import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../stores/auth';
import { secondsUntilExpiry } from './jwt';

export const SERVER_URL_KEY  = 'driver_server_url';
export const DEFAULT_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://faida-api.onrender.com/api/v1';
const TOKEN_KEY = 'driver_token';

export async function getBaseUrl(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(SERVER_URL_KEY);
    return stored ?? DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

let refreshInFlight: Promise<string | null> | null = null;

/** Proactively refresh the access token while still valid so an active driver
 *  isn't bounced to login mid-delivery (login issues a short-lived token). */
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
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401 && token) {
    useAuthStore.getState().clearAuth();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `API error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const driverApi = {
  get:    <T>(path: string)                  => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown)   => request<T>('POST',   path, body),
  patch:  <T>(path: string, body: unknown)   => request<T>('PATCH',  path, body),
  delete: <T>(path: string)                  => request<T>('DELETE', path),
};

export function formatKES(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
