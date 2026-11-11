import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { databaseUrl, ensureConfig, loadConfig, newConfig, saveConfig } from '../src/config';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'faida-cfg-'));
const opts = { pgDataDir: '/x/pgdata', backupDir: '/x/backups' };

describe('server.json', () => {
  it('generates strong, correctly shaped secrets', () => {
    const c = newConfig(opts);
    expect(c.encryptionKey).toMatch(/^[0-9a-f]{64}$/); // the API requires 64 hex characters
    expect(c.jwtSecret).toHaveLength(64);
    expect(c.dbPassword.length).toBeGreaterThanOrEqual(32);
    expect(newConfig(opts).jwtSecret).not.toBe(c.jwtSecret);
  });

  it('creates on first run and NEVER regenerates the secrets afterwards', () => {
    const file = path.join(tmp(), 'server.json');
    const first = ensureConfig(file, opts);
    expect(first.created).toBe(true);
    const again = ensureConfig(file, opts);
    expect(again.created).toBe(false);
    expect(again.config.encryptionKey).toBe(first.config.encryptionKey);
    expect(again.config.dbPassword).toBe(first.config.dbPassword);
  });

  it('keeps the file private on systems that support it', () => {
    if (process.platform === 'win32') return;
    const file = path.join(tmp(), 'server.json');
    ensureConfig(file, opts);
    expect(fs.statSync(file).mode & 0o077).toBe(0);
  });

  it('writes atomically (no temp file left behind)', () => {
    const dir = tmp();
    saveConfig(path.join(dir, 'server.json'), newConfig(opts));
    expect(fs.readdirSync(dir)).toEqual(['server.json']);
  });

  it('refuses a damaged file instead of silently starting a fresh database', () => {
    const file = path.join(tmp(), 'server.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, dbPassword: 'x' }));
    expect(() => loadConfig(file)).toThrow(/damaged|newer version/i);
  });

  it('builds a connection address that survives odd characters in the password', () => {
    // Characters that break a connection address unless they are encoded, followed by random text; generated, not written down.
    const awkward = `@:/#?%${crypto.randomBytes(4).toString('hex')}`;
    const c = { ...newConfig(opts), dbPassword: awkward };
    expect(databaseUrl(c)).toBe(`postgresql://faida:${encodeURIComponent(awkward)}@127.0.0.1:${c.pgPort}/faida`);
    expect(databaseUrl(c)).not.toContain(awkward); // the raw password never appears in the address
  });
});
