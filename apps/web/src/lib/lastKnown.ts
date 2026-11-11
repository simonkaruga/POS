/**
 * The last answer the server gave for something that rarely changes (the business's settings and subscription), kept in
 * this browser so the next page load can draw the right screen at once and correct it when the server answers.
 *
 * Without it the sidebar had to wait for two API calls before it knew what kind of business this is: until they came
 * back it showed the RETAIL menu, and a restaurant, fuel station or pharmacy then watched it rebuild. Over a slow link
 * to a remote database that took seconds. Nothing secret is stored: it is what the menu already shows.
 */
const PREFIX = 'faida:last:';

export function readLastKnown<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined; // storage unavailable or corrupt: behave as a first visit
  }
}

export function writeLastKnown(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: not worth failing for */
  }
}

/** Forget what was remembered, for example on sign-out, so the next person starts clean. */
export function clearLastKnown(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
