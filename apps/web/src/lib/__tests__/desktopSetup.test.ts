import { describe, expect, it } from 'vitest';
import {
  buildSetupPayload, defaultLanEnabled, describeConnection, googleSignInAvailable, validateOwnerAccount, flowFor, isLocalTopology, keepsOwnData, localServerUrl, normalizeServerUrl,
  stepAfter, stepBefore, topologyName, type SetupDraft,
} from '../desktopSetup';
import { formatBytes, timeAgo } from '../desktopServer';

const draft = (over: Partial<SetupDraft> = {}): SetupDraft => ({
  topology: 'SERVER_POS', deviceRole: 'FULL_POS', serverUrl: '',
  terminalName: '', businessName: '', dataDir: 'C:\\ProgramData\\Faida\\pgdata', backupDir: 'C:\\Users\\X\\Documents\\Faida Backups',
  lanEnabled: false, ...over,
});

describe('the steps each choice leads through', () => {
  it('before anything is chosen: welcome, licence, data, done', () => {
    expect(flowFor(null, null)).toEqual(['WELCOME', 'LICENSE', 'PLACE', 'DONE']);
  });
  it('cloud goes straight to the network step', () => {
    expect(flowFor('CLOUD', 'CLOUD')).toEqual(['WELCOME', 'LICENSE', 'PLACE', 'NETWORK', 'DONE']);
  });
  it('a computer on its own (server and till) chooses folders and is done', () => {
    expect(flowFor('LOCAL', 'SERVER_POS')).toEqual(['WELCOME', 'LICENSE', 'PLACE', 'TOPOLOGY', 'FOLDERS', 'OWNER', 'DONE']);
  });
  it('a server-only computer takes the same path', () => {
    expect(flowFor('LOCAL', 'SERVER')).toEqual(['WELCOME', 'LICENSE', 'PLACE', 'TOPOLOGY', 'FOLDERS', 'OWNER', 'DONE']);
  });
  it('a till chooses its device role, then finds its server', () => {
    expect(flowFor('LOCAL', 'CLIENT')).toEqual(['WELCOME', 'LICENSE', 'PLACE', 'TOPOLOGY', 'ROLE', 'NETWORK', 'DONE']);
  });
  it('local with no role picked yet shows the role step so the person can pick one', () => {
    expect(flowFor('LOCAL', null)).toContain('TOPOLOGY');
  });
  it('moves forward and back, stopping at both ends', () => {
    const f = flowFor('LOCAL', 'CLIENT');
    expect(stepAfter(f, 'ROLE')).toBe('NETWORK');
    expect(stepBefore(f, 'NETWORK')).toBe('ROLE');
    expect(stepBefore(f, 'WELCOME')).toBe('WELCOME');
    expect(stepAfter(f, 'DONE')).toBe('DONE');
  });
});

describe('what each role means', () => {
  it('only the two server roles run their own database', () => {
    expect(isLocalTopology('SERVER_POS')).toBe(true);
    expect(isLocalTopology('SERVER')).toBe(true);
    expect(isLocalTopology('CLIENT')).toBe(false);
    expect(isLocalTopology('CLOUD')).toBe(false);
  });
  it('a dedicated server lets other computers connect by default; a single shop computer does not', () => {
    expect(defaultLanEnabled('SERVER')).toBe(true);
    expect(defaultLanEnabled('SERVER_POS')).toBe(false);
  });
  it('names for the summary', () => {
    expect(topologyName('SERVER_POS')).toMatch(/server and till/i);
    expect(topologyName('STANDALONE')).toMatch(/server and till/i); // the old name still reads
    expect(topologyName('SERVER')).toMatch(/server only/i);
  });
});

describe('which computers keep their own data', () => {
  it('server+till and server-only do, the old STANDALONE name still does; tills, cloud and unset do not', () => {
    for (const m of ['SERVER_POS', 'SERVER', 'STANDALONE']) expect(keepsOwnData(m)).toBe(true);
    for (const m of ['CLIENT', 'CLOUD', 'UNCONFIGURED', null, undefined]) expect(keepsOwnData(m as string | null | undefined)).toBe(false);
  });
});

describe('server addresses', () => {
  it('adds http:// and the default port', () => {
    expect(normalizeServerUrl('192.168.1.20')).toBe('http://192.168.1.20:3010');
    expect(normalizeServerUrl(' 192.168.1.20:3010/ ')).toBe('http://192.168.1.20:3010');
  });
  it('keeps an explicit port and https', () => {
    expect(normalizeServerUrl('http://shop-server:4000')).toBe('http://shop-server:4000');
    expect(normalizeServerUrl('https://faida-api.onrender.com')).toBe('https://faida-api.onrender.com');
  });
  it('empty stays empty', () => expect(normalizeServerUrl('   ')).toBe(''));
  it('the till on the server computer talks to 127.0.0.1, not "localhost" (Windows may pick IPv6)', () => {
    expect(localServerUrl()).toBe('http://127.0.0.1:3010');
  });
});

describe('what the wizard saves', () => {
  it('server and till: folders, LAN choice and the local address; no remote server', () => {
    const p = buildSetupPayload(draft({ lanEnabled: false, businessName: ' Wazi Biz ' }));
    expect(p.invokeArgs).toMatchObject({
      mode: 'SERVER_POS', deviceRole: 'FULL_POS', serverUrl: null, dataDir: 'C:\\ProgramData\\Faida\\pgdata',
      backupDir: 'C:\\Users\\X\\Documents\\Faida Backups', lanEnabled: false, businessName: 'Wazi Biz',
    });
    expect(p.apiServerUrl).toBe('http://127.0.0.1:3010');
    expect(p.startsLocalServer).toBe(true);
  });
  it('server only keeps full-POS role internally and LAN as chosen', () => {
    const p = buildSetupPayload(draft({ topology: 'SERVER', lanEnabled: true, deviceRole: 'KDS' }));
    expect(p.invokeArgs.mode).toBe('SERVER');
    expect(p.invokeArgs.deviceRole).toBe('FULL_POS'); // device role only applies to tills
    expect(p.invokeArgs.lanEnabled).toBe(true);
  });
  it('a till saves its role and its server, and no folders', () => {
    const p = buildSetupPayload(draft({ topology: 'CLIENT', deviceRole: 'CASHIER', serverUrl: '192.168.1.20' }));
    expect(p.invokeArgs).toMatchObject({ mode: 'CLIENT', deviceRole: 'CASHIER', serverUrl: 'http://192.168.1.20:3010', dataDir: null, backupDir: null, lanEnabled: null });
    expect(p.apiServerUrl).toBe('http://192.168.1.20:3010');
    expect(p.startsLocalServer).toBe(false);
  });
  it('cloud saves the cloud address', () => {
    const p = buildSetupPayload(draft({ topology: 'CLOUD', serverUrl: 'https://faida-api.onrender.com/' }));
    expect(p.apiServerUrl).toBe('https://faida-api.onrender.com');
    expect(p.startsLocalServer).toBe(false);
  });
  it('never carries a licence key: activation is done by the server, after setup', () => {
    expect(Object.keys(buildSetupPayload(draft({})).invokeArgs)).not.toContain('licenseKey');
  });
});

describe('wording', () => {
  it('sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(423308)).toBe('413 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('times', () => {
    const now = new Date('2026-11-06T12:00:00');
    expect(timeAgo('2026-11-06T11:59:40', now)).toBe('just now');
    expect(timeAgo('2026-11-06T11:55:00', now)).toBe('5 minutes ago');
    expect(timeAgo('2026-11-06T09:00:00', now)).toBe('3 hours ago');
    expect(timeAgo('2026-11-05T11:00:00', now)).toBe('yesterday');
  });
});

describe('Google sign-in', () => {
  it('is offered in a browser and in a desktop app that uses the cloud', () => {
    expect(googleSignInAvailable(false, null)).toBe(true);
    expect(googleSignInAvailable(true, 'CLOUD')).toBe(true);
  });
  it('is not offered on an offline setup, a till of one, or before the setup is known', () => {
    for (const m of ['SERVER_POS', 'SERVER', 'STANDALONE', 'CLIENT', 'UNCONFIGURED', null, undefined]) {
      expect(googleSignInAvailable(true, m as string | null | undefined)).toBe(false);
    }
  });
});

describe('owner account details', () => {
  const ok = { businessName: 'Premier Cafe', name: 'Amina', email: 'amina@shop.test', password: 'Goodpass1', confirm: 'Goodpass1' };
  it('accepts good details', () => expect(validateOwnerAccount(ok)).toBeNull());
  it('says what is wrong, in this order', () => {
    expect(validateOwnerAccount({ ...ok, businessName: ' ' })).toMatch(/business/);
    expect(validateOwnerAccount({ ...ok, name: '' })).toMatch(/name/);
    expect(validateOwnerAccount({ ...ok, email: 'amina' })).toMatch(/email/);
    expect(validateOwnerAccount({ ...ok, password: 'Short1', confirm: 'Short1' })).toMatch(/8 characters/);
    expect(validateOwnerAccount({ ...ok, password: 'lowercase1', confirm: 'lowercase1' })).toMatch(/capital/);
    expect(validateOwnerAccount({ ...ok, password: 'NoNumberHere', confirm: 'NoNumberHere' })).toMatch(/number/);
    expect(validateOwnerAccount({ ...ok, confirm: 'Different1' })).toMatch(/match/);
  });
});

describe('what this computer is connected to', () => {
  it('says nothing before setup', () => {
    expect(describeConnection(null)).toBeNull();
    expect(describeConnection({ mode: 'UNCONFIGURED' })).toBeNull();
  });
  it('names the offline setups, a till and the cloud', () => {
    expect(describeConnection({ mode: 'SERVER_POS', business_name: ' Premier Cafe ' })).toEqual({ where: 'This computer keeps the data and works offline', business: 'Premier Cafe' });
    expect(describeConnection({ mode: 'SERVER' })?.where).toMatch(/shop server/);
    expect(describeConnection({ mode: 'CLIENT', server_url: 'http://192.168.1.20:3010' })?.where).toContain('192.168.1.20:3010');
    expect(describeConnection({ mode: 'CLOUD' })?.where).toMatch(/Cloud/);
  });
});
