/**
 * The signed licence.
 *
 * The Faida server signs a small statement ("this computer may use this plan until this date") with a PRIVATE key that only
 * it holds. The offline app carries only the matching PUBLIC key, so it can check a licence but cannot make one: there is no
 * calculation inside the app that anyone could copy to forge a key. (The old check was a checksum whose recipe shipped in the
 * app.) Ed25519 is used: small keys and signatures, fast, no parameters to get wrong.
 *
 * A token looks like  kl1.<payload>.<signature>  with both parts base64url. It carries no secret, only the statement.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

export interface LicensePayload {
  v: 1;
  /** The licence key's id on the server (not the key itself). */
  lid: string;
  /** Plan: FREE | STARTER | GROWTH | PRO | ENTERPRISE (LIFETIME is issued as ENTERPRISE). */
  tier: string;
  /** The one computer this licence is for. */
  machineId: string;
  issuedAt: string;
  /** How long THIS token is good for. The app renews it quietly whenever it is online. */
  tokenExpiresAt: string;
  /** When the licence itself ends (null: no end). A token never outlives it. */
  licenseExpiresAt: string | null;
}

export type VerifyResult =
  | { ok: true; payload: LicensePayload }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'UNSUPPORTED' };

const PREFIX = 'kl1';
const b64u = (buf: Buffer) => buf.toString('base64url');

/** Accepts a PEM, or a PEM wrapped in base64 (one line, easy to put in an environment variable). */
export function toPem(raw: string): string {
  const text = raw.trim();
  if (text.includes('-----BEGIN')) return text.replace(/\\n/g, '\n');
  return Buffer.from(text, 'base64').toString('utf8').trim();
}

export function generateLicenseKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function signLicense(payload: LicensePayload, privateKeyPem: string): string {
  const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = sign(null, Buffer.from(`${PREFIX}.${body}`), createPrivateKey(toPem(privateKeyPem)));
  return `${PREFIX}.${body}.${b64u(signature)}`;
}

export function verifyLicense(token: string, publicKeyPem: string): VerifyResult {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'MALFORMED' };
  if (parts[0] !== PREFIX) return { ok: false, reason: 'UNSUPPORTED' };
  let valid = false;
  try {
    valid = verify(null, Buffer.from(`${PREFIX}.${parts[1]}`), createPublicKey(toPem(publicKeyPem)), Buffer.from(parts[2], 'base64url'));
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (!valid) return { ok: false, reason: 'BAD_SIGNATURE' };
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as LicensePayload;
    if (payload?.v !== 1 || !payload.machineId || !payload.tokenExpiresAt || !payload.tier) return { ok: false, reason: 'UNSUPPORTED' };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
}
