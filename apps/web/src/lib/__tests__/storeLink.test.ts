import { describe, expect, it } from 'vitest';
import { isPrivateAddress, onlineStoreLink } from '../storeLink';

const base = { inDesktopApp: false, serverUrl: null, origin: 'https://pos.example.com', businessId: 'b1' };

describe('onlineStoreLink', () => {
  it('uses the website address in a browser', () => {
    expect(onlineStoreLink(base)).toEqual({ kind: 'link', url: 'https://pos.example.com/shop/b1' });
  });

  it('never hands out the internal tauri address from the desktop app', () => {
    const r = onlineStoreLink({ ...base, inDesktopApp: true, origin: 'http://tauri.localhost', serverUrl: 'http://127.0.0.1:3010' });
    expect(r.kind).toBe('unavailable');
    expect(JSON.stringify(r)).not.toContain('tauri.localhost');
  });

  it('is unavailable on a LAN server', () => {
    expect(onlineStoreLink({ ...base, inDesktopApp: true, serverUrl: 'http://192.168.1.20:3010' }).kind).toBe('unavailable');
  });

  it('uses the public website when the desktop app is on the cloud and the address is known', () => {
    const r = onlineStoreLink({ ...base, inDesktopApp: true, serverUrl: null, publicWebUrl: 'https://pos.example.com/' });
    expect(r).toEqual({ kind: 'link', url: 'https://pos.example.com/shop/b1' });
  });

  it('points a cloud desktop at the browser when the website address is not configured', () => {
    expect(onlineStoreLink({ ...base, inDesktopApp: true, serverUrl: 'https://api.example.com' }).kind).toBe('unavailable');
  });
});

describe('isPrivateAddress', () => {
  it.each(['http://localhost:3010', 'http://127.0.0.1:3010', 'http://10.0.0.5', 'http://172.20.1.1', 'http://192.168.0.9:3010', 'http://till.local'])(
    '%s is private',
    (u) => expect(isPrivateAddress(u)).toBe(true),
  );
  it.each(['https://faida-api.onrender.com', 'http://172.32.0.1', 'http://8.8.8.8', 'not a url'])('%s is not', (u) =>
    expect(isPrivateAddress(u)).toBe(false),
  );
});
