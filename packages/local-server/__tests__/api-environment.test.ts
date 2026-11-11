import { apiEnvironment } from '../src/api';
import { newConfig } from '../src/config';

const cfg = newConfig({ pgDataDir: '/x/pgdata', backupDir: '/x/bk' });
const base = { nodePath: 'node', apiMain: 'main.js', workDir: '/x/run', logFile: '/x/api.log' };

describe('what the API is told about licensing', () => {
  it('gets the computer id, the licence server and the public key to check licences with', () => {
    const env = apiEnvironment(cfg, { ...base, machineId: 'machine-1234', licenseServerUrl: 'https://licences.example.test', licensePublicKey: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----' });
    expect(env.FAIDA_EDITION).toBe('LOCAL');
    expect(env.FAIDA_MACHINE_ID).toBe('machine-1234');
    expect(env.LICENSE_SERVER_URL).toBe('https://licences.example.test');
    expect(env.FAIDA_LICENSE_PUBLIC_KEY).toContain('BEGIN PUBLIC KEY');
  });

  it('with no public key it passes none, so no paid plan can ever be granted', () => {
    const env = apiEnvironment(cfg, { ...base, machineId: 'machine-1234' });
    expect(env.FAIDA_LICENSE_PUBLIC_KEY).toBeUndefined();
  });
});
