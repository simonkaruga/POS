import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { canWrite, checkFolders } from '../src/folders';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'faida-fld-'));
const platform = process.platform as 'linux';

describe('folder checks on a real disk', () => {
  it('accepts a new folder under a writable parent, creating nothing', () => {
    const root = tmp();
    const r = checkFolders(path.join(root, 'pgdata'), path.join(root, 'backups'), platform, {});
    expect(r.dataDir.ok).toBe(true);
    expect(r.backupDir.ok).toBe(true);
    expect(fs.readdirSync(root)).toEqual([]); // validation must not leave folders behind
  });

  it('accepts an existing empty folder', () => {
    const root = tmp();
    const data = path.join(root, 'pgdata');
    fs.mkdirSync(data);
    expect(checkFolders(data, path.join(root, 'bk'), platform, {}).dataDir.ok).toBe(true);
  });

  it('refuses a folder that already holds files, and says why', () => {
    const root = tmp();
    const data = path.join(root, 'pgdata');
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'photos.zip'), 'x');
    const r = checkFolders(data, path.join(root, 'bk'), platform, {});
    expect(r.dataDir.ok).toBe(false);
    expect((r.dataDir as { reason: string }).reason).toMatch(/already contains files/i);
  });

  it('accepts a folder that is already a Faida database (reinstall, new computer from a disk copy)', () => {
    const root = tmp();
    const data = path.join(root, 'pgdata');
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'PG_VERSION'), '17');
    fs.writeFileSync(path.join(data, 'postgresql.conf'), '');
    expect(checkFolders(data, path.join(root, 'bk'), platform, {}).dataDir.ok).toBe(true);
  });

  it('refuses backups inside the database folder', () => {
    const root = tmp();
    const data = path.join(root, 'pgdata');
    expect(checkFolders(data, path.join(data, 'bk'), platform, {}).backupDir.ok).toBe(false);
  });

  it('refuses a path that is a file', () => {
    const root = tmp();
    const file = path.join(root, 'afile');
    fs.writeFileSync(file, 'x');
    expect(canWrite(file).ok).toBe(false);
  });
});
