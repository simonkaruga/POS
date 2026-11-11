/**
 * Fingerprint / face sign-in.
 *
 * After a normal sign-in the person can turn this on. The server then issues a revocable device token (see
 * DeviceLoginService in the API), which is kept in the secure keystore. Later the app asks the phone to check
 * the fingerprint or face and, only if that passes, trades the token for a fresh session. No password, PIN or
 * session token is ever stored for this, and "Logout" does not remove it (that is the point: log out, then
 * come back with a touch). Turning it off, or the server rejecting the token, removes it.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { mobileApi } from './api';

const TOKEN_KEY = 'pos_device_token';
const WHO_KEY = 'pos_device_user';

export interface BiometricEnrolment {
  userId: string;
  name: string;
}

export interface BiometricSession {
  accessToken: string;
  user: {
    id: string; name: string; email: string | null; role: string; businessId: string; storeId?: string;
  };
}

/** The phone has a sensor and the person has registered a fingerprint or face in the phone's settings. */
export async function isBiometricReady(): Promise<boolean> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  } catch {
    return false;
  }
}

/** Who fingerprint sign-in is switched on for on this phone, if anyone. */
export async function getBiometricEnrolment(): Promise<BiometricEnrolment | null> {
  try {
    const [token, who] = await Promise.all([SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(WHO_KEY)]);
    if (!token || !who) return null;
    return JSON.parse(who) as BiometricEnrolment;
  } catch {
    return null;
  }
}

async function confirm(prompt: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    cancelLabel: 'Cancel',
    // Allow the phone's screen lock as a fallback so a wet finger does not lock the cashier out.
    disableDeviceFallback: false,
  });
  return result.success;
}

/** Switch fingerprint sign-in on for the person who is signed in right now. Returns false if they backed out. */
export async function enableBiometric(user: { id: string; name: string }, deviceName?: string): Promise<boolean> {
  if (!(await isBiometricReady())) {
    throw new Error('Set up a fingerprint or face unlock in your phone settings first.');
  }
  if (!(await confirm('Confirm to turn on fingerprint sign-in'))) return false;

  const { deviceToken } = await mobileApi.post<{ deviceToken: string }>('/auth/device-token', {
    deviceName: deviceName ?? `${Platform.OS} phone`,
  });
  await SecureStore.setItemAsync(TOKEN_KEY, deviceToken);
  await SecureStore.setItemAsync(WHO_KEY, JSON.stringify({ userId: user.id, name: user.name }));
  return true;
}

/** Switch it off on this phone and tell the server to forget the token (best effort: offline still clears locally). */
export async function disableBiometric(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(WHO_KEY).catch(() => {});
  if (token) await mobileApi.post('/auth/device-token/revoke', { deviceToken: token }).catch(() => {});
}

/**
 * Check the fingerprint / face, then sign in. Resolves null when the person cancelled or the check failed.
 * Throws with a readable message when the server no longer accepts this phone (the stored token is removed so
 * the button disappears and they fall back to PIN / password).
 */
export async function signInWithBiometric(baseUrl: string): Promise<BiometricSession | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return null;
  if (!(await confirm('Sign in to Faida POS'))) return null;

  const res = await fetch(`${baseUrl}/auth/login/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken: token }),
  });
  const data = (await res.json().catch(() => ({}))) as BiometricSession & { message?: string };
  if (!res.ok) {
    if (res.status === 401) {
      await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
      await SecureStore.deleteItemAsync(WHO_KEY).catch(() => {});
    }
    throw new Error(data.message ?? 'Fingerprint sign-in failed.');
  }
  return data;
}
