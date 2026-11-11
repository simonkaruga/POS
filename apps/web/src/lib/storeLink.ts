/**
 * The Online Store address a business can hand to customers.
 *
 * A customer's phone has to reach BOTH the storefront page and the API behind it over the internet. That is true for the
 * hosted website and for a desktop app that is connected to the cloud. It is NOT true for a desktop app whose data lives
 * on this computer or on the shop's own network: there the page address is the app's internal `tauri.localhost`, and the
 * API is a private address, so a scanned QR code opens nothing.
 */
export type StoreLink = { kind: 'link'; url: string } | { kind: 'unavailable'; reason: string };

export interface StoreLinkInput {
  inDesktopApp: boolean;
  /** localStorage 'faida-server-url' (set by the desktop setup wizard); null when the app uses the cloud API. */
  serverUrl: string | null;
  /** window.location.origin (used by the hosted website). */
  origin: string;
  /** Build-time address of the hosted website (VITE_PUBLIC_WEB_URL); only needed by the desktop app. */
  publicWebUrl?: string | null;
  businessId: string;
}

/** True for an address only this computer or the shop's own network can reach. */
export function isPrivateAddress(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '[::1]') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export function onlineStoreLink(i: StoreLinkInput): StoreLink {
  const path = `/shop/${i.businessId}`;
  if (!i.inDesktopApp) return { kind: 'link', url: `${i.origin}${path}` };
  if (i.serverUrl && isPrivateAddress(i.serverUrl)) {
    return {
      kind: 'unavailable',
      reason:
        'This computer keeps your data on your own premises, so customers cannot reach it from the internet. ' +
        'The online store is available to businesses connected to the Faida cloud.',
    };
  }
  const base = (i.publicWebUrl ?? '').trim().replace(/\/$/, '');
  if (!base) {
    return {
      kind: 'unavailable',
      reason: 'Open Faida in a web browser and find this card in Settings to get the store link and QR code to share.',
    };
  }
  return { kind: 'link', url: `${base}${path}` };
}
