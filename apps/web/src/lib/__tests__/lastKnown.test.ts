import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readLastKnown, writeLastKnown, clearLastKnown } from '../lastKnown';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _keys: () => [...m.keys()],
  };
}
// Object.keys(localStorage) must list the stored keys, as in a browser
const withKeys = (s: ReturnType<typeof memoryStorage>) => new Proxy(s, { ownKeys: () => s._keys(), getOwnPropertyDescriptor: (t, k) => (s._keys().includes(String(k)) ? { enumerable: true, configurable: true, value: 1 } : Object.getOwnPropertyDescriptor(t, k)) });

describe('lastKnown', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', withKeys(memoryStorage())); });

  it('hands back what was stored, so the menu can draw before the server answers', () => {
    writeLastKnown('settings:biz1', { posMode: 'HOSPITALITY', enabledModules: '["FUEL"]' });
    expect(readLastKnown('settings:biz1')).toEqual({ posMode: 'HOSPITALITY', enabledModules: '["FUEL"]' });
  });

  it('knows nothing on a first visit', () => {
    expect(readLastKnown('settings:nobody')).toBeUndefined();
  });

  it('keeps one business apart from another', () => {
    writeLastKnown('settings:a', { posMode: 'RETAIL' });
    writeLastKnown('settings:b', { posMode: 'HOSPITALITY' });
    expect((readLastKnown('settings:b') as { posMode: string }).posMode).toBe('HOSPITALITY');
  });

  it('treats corrupt data as a first visit rather than crashing the app', () => {
    localStorage.setItem('faida:last:settings:x', '{not json');
    expect(readLastKnown('settings:x')).toBeUndefined();
  });

  it('forgets everything on sign-out, and only its own keys', () => {
    writeLastKnown('settings:a', { posMode: 'RETAIL' });
    writeLastKnown('subscription:a', { subscriptionStatus: 'ACTIVE' });
    localStorage.setItem('pos-theme', 'dark');
    clearLastKnown();
    expect(readLastKnown('settings:a')).toBeUndefined();
    expect(readLastKnown('subscription:a')).toBeUndefined();
    expect(localStorage.getItem('pos-theme')).toBe('dark');
  });

  it('survives storage that is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => writeLastKnown('k', 1)).not.toThrow();
    expect(readLastKnown('k')).toBeUndefined();
  });
});
