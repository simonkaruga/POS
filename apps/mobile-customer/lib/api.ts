import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSessionStore } from '../stores/session';

export const SERVER_URL_KEY  = 'customer_server_url';
export const DEFAULT_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://faida-api.onrender.com/api/v1';

/** Expired/revoked portal session → clear it so the app returns to the login gate. */
async function handleUnauthorized() {
  await useSessionStore.getState().logout().catch(() => {});
}

export async function getBaseUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(SERVER_URL_KEY);
    return stored ?? DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

async function getHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await AsyncStorage.getItem('customer_token').catch(() => null);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function apiGet<T>(path: string): Promise<T> {
  const [baseUrl, headers] = await Promise.all([getBaseUrl(), getHeaders()]);
  const res = await fetch(`${baseUrl}${path}`, { headers });
  if (res.status === 401 && (headers as Record<string, string>).Authorization) {
    await handleUnauthorized();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `API error ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const [baseUrl, headers] = await Promise.all([getBaseUrl(), getHeaders()]);
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 401 && (headers as Record<string, string>).Authorization) {
    await handleUnauthorized();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `API error ${res.status}`);
  }
  return res.json();
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const [baseUrl, headers] = await Promise.all([getBaseUrl(), getHeaders()]);
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 401 && (headers as Record<string, string>).Authorization) {
    await handleUnauthorized();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `API error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function formatKES(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
