# @pos/local-server

Runs Faida's own PostgreSQL and API on one computer: the engine of the offline desktop edition. The desktop app
(Tauri) only launches `cli.js` and reads its status; everything that can go wrong at a shop counter lives here, in
TypeScript, where it is tested against a real database.

## What it does

| Piece | File | Job |
|---|---|---|
| Folders | `paths.ts` | Windows defaults (`C:\ProgramData\Faida` for the live database, `Documents\Faida Backups` for backups) and the rules that refuse unsafe database folders: network shares, OneDrive/Dropbox/Google Drive, Documents/Desktop/Pictures (Windows redirects them to OneDrive), Program Files, a whole drive |
| Settings and secrets | `config.ts` | `server.json`: ports, and secrets generated once on first run and never regenerated (database password, login-token secret, the key that encrypts saved M-Pesa/eTIMS credentials). Written atomically, owner-only |
| Database | `postgres.ts` | `initdb` on first run (refuses a folder that already holds files), start/stop with `pg_ctl`, localhost only, full durability (fsync on). Recovers by itself after a power cut |
| Updates | `migrate.ts` | `prisma migrate deploy` on every start; first run also creates the empty database |
| API | `api.ts` | Runs the API as a child process, restarts it if it dies (gives up after 5 crashes a minute), `HOST` = `127.0.0.1` unless LAN is on |
| Backups | `backup.ts` | `pg_dump` custom format, verified after writing, atomic rename, retention (all for 7 days, daily to 30 days, monthly to 12 months, safety copies 90 days, newest 3 always) |
| Orchestration | `supervisor.ts` | Start order, safety backup before an app-version change, backup on close (skipped if one is under an hour old), one backup per calendar day (taken just after midnight while the app is open, checked every five minutes; if midnight passed while the app was closed, a minute after it starts), restore with a pre-restore safety backup |
| Launcher | `cli.ts` | JSON lines on stdout (`status`, `log`, `warning`, `result`), JSON commands on stdin (`status`, `backup`, `restore`, `stop`). When stdin closes (the app closed or crashed) it stops the API and database instead of leaving them running |

## Running the tests

```bash
npm test                      # unit tests; the integration test skips itself
```

The integration test starts a real PostgreSQL and the real API. It needs the PostgreSQL programs (`initdb`, `pg_ctl`,
`postgres`, `pg_dump`, `pg_restore`), the API built (`apps/api/dist`) and Prisma installed:

```bash
FAIDA_PG_BIN=/path/to/postgres/bin [FAIDA_PG_LIB=/path/to/lib] npm test
```

It runs in a temporary folder on free ports and never touches real data.

## Settings and crashes

- **The app's choices win on every start**: `lanEnabled`, `backupDir` and `pgDataDir` passed on the command line replace what
  `server.json` saved (folders are checked again first, and an unsafe one stops the start). What the app does not say, the
  saved settings keep.
- **Nothing is left running behind a crash**: stdout/stdin errors are ignored (a dead parent breaks both pipes), an `exit`
  handler kills the API and stops the database synchronously, and the API's process id is kept in `run/api.pid` so a later
  start can stop a leftover API (only if that process is alive AND still answers the health check on our port).

## Licensing

The server program passes the API what it needs to check a licence: `--machine-id` (`FAIDA_MACHINE_ID`),
`--license-server` (`LICENSE_SERVER_URL`) and `--license-public-key <file>` (read and handed over as
`FAIDA_LICENSE_PUBLIC_KEY`). Without the public key the API can never accept a paid plan. The checking itself is in
`apps/api/src/licensing`; `__tests__/licensing.integration.test.ts` runs the real API against a stand-in licence server.

## Also in this package

- `folders.ts` checks a chosen folder on the real disk (empty, writable, not someone's files) for the setup wizard; the
  `defaults` and `validate` subcommands of `cli.js` expose it so the rules live in one place.
- Server addresses are ranked (`addressRank`): the shop network (192.168.x, 10.x) before the virtual adapters Docker, WSL and
  VPNs create, so the console can say which one the tills should type.

## Not done yet

- Seeing the whole thing run on a real Windows machine: the bundle, the Windows CI job and the installer hooks are written and
  tested on Linux, and run on Windows for the first time in CI (see apps/desktop/README.md, Packaging).
- Backups do not contain the encryption key: after restoring onto a NEW computer, saved M-Pesa/eTIMS credentials must be
  entered again. Key escrow comes with the cloud backup.
- The cloud backup.
- A client/server version check (a till on an older app than its server).
