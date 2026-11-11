/**
 * Biometric Authentication — WebAuthn (FIDO2) API.
 *
 * Supports fingerprint, Face ID, Windows Hello, and any platform authenticator.
 * Used for:
 *   1. Staff login at POS terminal (replaces PIN for supported devices)
 *   2. Manager approval for price overrides / voids
 *   3. Secure access to reports
 *
 * The credential is stored on the device. The server receives a signed
 * assertion which it verifies against the stored public key.
 */

/** Returns true if the platform supports biometric authentication. */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

export interface BiometricRegistrationOptions {
  userId: string;
  userName: string;
  displayName: string;
  /** RP ID — should match the domain, e.g. "pos.faida.co.ke" */
  rpId?: string;
  rpName?: string;
}

export interface BiometricCredential {
  credentialId: string;
  publicKey: string;
  userId: string;
}

/**
 * Register a new biometric credential for a user.
 * Returns the credential ID and public key to store server-side.
 */
export async function registerBiometric(
  opts: BiometricRegistrationOptions,
): Promise<BiometricCredential> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = new TextEncoder().encode(opts.userId);

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        id: opts.rpId ?? window.location.hostname,
        name: opts.rpName ?? 'Faida POS',
      },
      user: {
        id: userIdBytes,
        name: opts.userName,
        displayName: opts.displayName,
      },
      pubKeyCredParams: [
        { alg: -7,   type: 'public-key' }, // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  }) as PublicKeyCredential;

  const response = credential.response as AuthenticatorAttestationResponse;
  const credentialId = bufferToBase64url(credential.rawId);
  const publicKey = bufferToBase64url(response.getPublicKey()!);

  return { credentialId, publicKey, userId: opts.userId };
}

// ─── Authentication ───────────────────────────────────────────────────────────

export interface BiometricAuthOptions {
  /** Credential IDs previously registered for this user */
  credentialIds: string[];
  rpId?: string;
  /** Challenge from the server (base64url) */
  challenge?: string;
}

export interface BiometricAuthResult {
  credentialId: string;
  /** Signed assertion — send to server for verification */
  signature: string;
  authenticatorData: string;
  clientDataJSON: string;
}

/**
 * Authenticate using a registered biometric credential.
 * The returned assertion should be sent to the server for verification.
 */
export async function authenticateBiometric(
  opts: BiometricAuthOptions,
): Promise<BiometricAuthResult> {
  const challenge = opts.challenge
    ? base64urlToBuffer(opts.challenge)
    : crypto.getRandomValues(new Uint8Array(32));

  const allowCredentials = opts.credentialIds.map((id) => ({
    id: base64urlToBuffer(id),
    type: 'public-key' as const,
    transports: ['internal'] as AuthenticatorTransport[],
  }));

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: opts.rpId ?? window.location.hostname,
      allowCredentials,
      userVerification: 'required',
      timeout: 60000,
    },
  }) as PublicKeyCredential;

  const response = assertion.response as AuthenticatorAssertionResponse;

  return {
    credentialId: bufferToBase64url(assertion.rawId),
    signature: bufferToBase64url(response.signature),
    authenticatorData: bufferToBase64url(response.authenticatorData),
    clientDataJSON: bufferToBase64url(response.clientDataJSON),
  };
}

/**
 * Quick biometric prompt — resolves true if the user verifies successfully,
 * false if they cancel or it fails. Used for manager approval flows.
 */
export async function promptBiometric(credentialIds: string[]): Promise<boolean> {
  try {
    await authenticateBiometric({ credentialIds });
    return true;
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ─── Sign in through the server (the flow Settings registers credentials for) ──

export interface BiometricSignIn {
  accessToken: string;
  user: { id: string; name: string; role: string; businessId: string; storeId?: string };
}

/**
 * Ask the server for a challenge (and the RP ID it registered the credentials under), have the device verify
 * the fingerprint / face, and send the signed assertion back for a session token.
 *
 * Pass userId when the person has already picked their name on the login screen; without it the browser offers
 * whichever passkeys it holds for this site.
 */
export async function signInWithBiometric(
  api: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T> },
  businessId: string,
  userId?: string,
): Promise<BiometricSignIn | null> {
  const options = await api.get<{
    challenge: string;
    challengeKey: string;
    rpId: string;
    allowCredentials: { type: string; id: string; transports?: AuthenticatorTransport[] }[];
    userVerification: UserVerificationRequirement;
    timeout: number;
  }>(`/auth/webauthn/login/begin?businessId=${encodeURIComponent(businessId)}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`);

  if (userId && options.allowCredentials.length === 0) {
    throw new Error('No fingerprint or Face ID is registered for this account. Use your PIN, or ask a manager to register this device.');
  }

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: base64urlToBuffer(options.challenge),
      rpId: options.rpId,
      allowCredentials: options.allowCredentials.map((c) => ({
        type: 'public-key' as const,
        id: base64urlToBuffer(c.id),
        transports: c.transports,
      })),
      userVerification: options.userVerification,
      timeout: options.timeout,
    },
  })) as PublicKeyCredential | null;
  if (!credential) return null;

  const response = credential.response as AuthenticatorAssertionResponse;
  return api.post<BiometricSignIn>('/auth/webauthn/login/complete', {
    businessId,
    challengeKey: options.challengeKey,
    credentialId: bufferToBase64url(credential.rawId),
    clientDataJSON: bufferToBase64url(response.clientDataJSON),
    authenticatorData: bufferToBase64url(response.authenticatorData),
    signature: bufferToBase64url(response.signature),
    userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : undefined,
  });
}
