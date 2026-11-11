import { defaultDirs, Env, validateBackupDir, validateDataDir } from '../src/paths';

const winEnv: Env = { ProgramData: 'C:\\ProgramData', USERPROFILE: 'C:\\Users\\Wanjiku' };

describe('default folders', () => {
  it('Windows: database under ProgramData, backups in Documents', () => {
    const d = defaultDirs('win32', winEnv, 'C:\\Users\\Wanjiku');
    expect(d.rootDir).toBe('C:\\ProgramData\\Faida');
    expect(d.pgDataDir).toBe('C:\\ProgramData\\Faida\\pgdata');
    expect(d.backupDir).toBe('C:\\Users\\Wanjiku\\Documents\\Faida Backups');
    expect(d.configFile).toBe('C:\\ProgramData\\Faida\\server.json');
  });
  it('falls back sensibly when the environment is bare', () => {
    expect(defaultDirs('win32', {}, 'C:\\Users\\X').rootDir).toBe('C:\\ProgramData\\Faida');
  });
  it('Linux (development only)', () => {
    expect(defaultDirs('linux', {}, '/home/kelvin').rootDir).toBe('/home/kelvin/.local/share/faida');
  });
});

describe('live database folder rules (Windows)', () => {
  const ok = (p: string, env = winEnv) => validateDataDir(p, 'win32', env);
  const reason = (p: string, env = winEnv) => { const r = ok(p, env); return r.ok ? '' : r.reason; };

  it('accepts a plain local folder', () => {
    expect(ok('C:\\ProgramData\\Faida\\pgdata').ok).toBe(true);
    expect(ok('D:\\FaidaData').ok).toBe(true);
  });
  it('refuses network shares', () => expect(reason('\\\\server\\share\\faida')).toMatch(/network share/i));
  it('refuses a whole drive', () => {
    expect(reason('C:\\')).toMatch(/not the whole drive/i);
    expect(reason('D:')).not.toBe('');
  });
  it('refuses relative paths and empty input', () => {
    expect(reason('faida')).toMatch(/full folder path/i);
    expect(reason('   ')).toMatch(/choose a folder/i);
  });
  it('refuses OneDrive, by environment and by name', () => {
    const env = { ...winEnv, OneDrive: 'C:\\Users\\Wanjiku\\OneDrive' };
    expect(reason('C:\\Users\\Wanjiku\\OneDrive\\Faida', env)).toMatch(/OneDrive/);
    expect(reason('C:\\Users\\Wanjiku\\OneDrive - Acme Ltd\\Faida')).toMatch(/synced/i);
    expect(reason('D:\\Dropbox\\Faida')).toMatch(/synced/i);
    expect(reason('E:\\Google Drive\\Faida')).toMatch(/synced/i);
  });
  it('refuses Documents / Desktop / Pictures, which Windows often redirects into OneDrive', () => {
    expect(reason('C:\\Users\\Wanjiku\\Documents\\Faida')).toMatch(/Documents, Desktop/);
    expect(reason('C:\\Users\\Wanjiku\\Desktop\\Faida')).not.toBe('');
  });
  it('refuses Program Files and Windows', () => {
    expect(reason('C:\\Program Files\\Faida\\data')).toMatch(/read-only/i);
    expect(reason('C:\\Windows\\Temp\\faida')).toMatch(/read-only/i);
  });
  it('compares paths without regard to case on Windows', () => {
    expect(reason('c:\\users\\wanjiku\\onedrive\\faida', { ...winEnv, OneDrive: 'C:\\Users\\Wanjiku\\OneDrive' })).toMatch(/OneDrive/);
  });
});

describe('backup folder rules', () => {
  const data = 'C:\\ProgramData\\Faida\\pgdata';
  it('allows Documents, a USB drive and even a OneDrive folder (backups are single files)', () => {
    expect(validateBackupDir('C:\\Users\\Wanjiku\\Documents\\Faida Backups', data, 'win32').ok).toBe(true);
    expect(validateBackupDir('E:\\Faida Backups', data, 'win32').ok).toBe(true);
    expect(validateBackupDir('C:\\Users\\Wanjiku\\OneDrive\\Faida Backups', data, 'win32').ok).toBe(true);
  });
  it('refuses a folder inside the database folder', () => {
    expect(validateBackupDir('C:\\ProgramData\\Faida\\pgdata\\backups', data, 'win32').ok).toBe(false);
    expect(validateBackupDir('c:\\programdata\\faida\\PGDATA', data, 'win32').ok).toBe(false);
  });
  it('allows a sibling folder next to the database', () => {
    expect(validateBackupDir('C:\\ProgramData\\Faida\\backups', data, 'win32').ok).toBe(true);
  });
});
