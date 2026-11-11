import { run } from './postgres';
import { databaseUrl, ServerConfig } from './config';

export interface MigrateOptions {
  /** Path to Node (the bundled node.exe in the installer). */
  nodePath: string;
  /** Prisma's CLI entry point, node_modules/prisma/build/index.js. */
  prismaCli: string;
  /** prisma/schema.prisma, with its migrations folder beside it. */
  schemaPath: string;
}

/**
 * Bring the database up to this version of the app. Safe to run on every start: it applies only what is missing.
 * The first run also creates the (empty) `faida` database, which Prisma does when it is absent.
 */
export async function migrate(cfg: ServerConfig, o: MigrateOptions): Promise<string> {
  const url = databaseUrl(cfg);
  const r = await run(o.nodePath, [o.prismaCli, 'migrate', 'deploy', '--schema', o.schemaPath], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    timeoutMs: 10 * 60 * 1000,
  });
  if (r.code !== 0) {
    throw new Error(`Updating the database failed. ${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join(' | ')}`);
  }
  return r.stdout;
}

/**
 * Is there anything for `migrate` to do (or anything wrong)? True means the database is NOT in step with this version of the
 * app: a migration is waiting, or an earlier one failed. Used to decide whether a safety backup is needed before the start,
 * even when the version number did not change (a developer build, a release that forgot to bump the version).
 */
export async function needsMigration(cfg: ServerConfig, o: MigrateOptions): Promise<boolean> {
  const url = databaseUrl(cfg);
  const r = await run(o.nodePath, [o.prismaCli, 'migrate', 'status', '--schema', o.schemaPath], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    timeoutMs: 2 * 60 * 1000,
  });
  return r.code !== 0;
}
