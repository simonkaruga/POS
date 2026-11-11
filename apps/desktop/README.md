# Faida POS — Desktop (Tauri v2)

Native desktop shell around the Faida POS web app, adding the hardware and
offline capabilities a browser cannot reach: direct printer sockets, cash-drawer
kick, LAN peer sync, an offline eTIMS/VSCU queue in SQLite, and a signed,
online-activated licence for the offline edition.

- Product name: **Faida POS** · identifier `co.ke.faida.pos`
- Frontend: `apps/web` — dev from the Vite server, release from `apps/web/dist`

---

## Prerequisites

- Rust toolchain — https://rustup.rs
- Node.js 20+
- Tauri v2 system dependencies for your OS (WebKitGTK on Linux, WebView2 on Windows)

---

## Development

```bash
npm run dev          # tauri dev — also starts the web dev server for you
```

`beforeDevCommand` runs `npm run dev:web` from the repo root, so you don't need a
second terminal.

`devUrl` in `src-tauri/tauri.conf.json` is `http://localhost:3005`, the port `apps/web` serves on.

## Building

```bash
cd ../web && npm run build     # REQUIRED FIRST — Tauri bundles apps/web/dist
cd ../desktop && npm run build
```

Installers land in `src-tauri/target/release/bundle/`.

`beforeBuildCommand` builds the web app, but if you build the web app separately
make sure it finished — a stale `apps/web/dist` ships silently.

Releases are automated by `.github/workflows/desktop-release.yml`.

---

## Native modules (`src-tauri/src/`)

| Module | Capability |
|---|---|
| `printer.rs` | Network ESC/POS printers over a raw TCP socket, with connect timeout. `print_to_network` is what the web **print bridge** (`apps/web/src/lib/printBridge.ts`) calls to deliver queued jobs; it only connects to a private IPv4 literal (`private_printer_addr`: 10.x, 172.16-31.x, 192.168.x), so a hostile or wrong job cannot make this computer connect to loopback, a public host or a metadata address. `private_printer_addr` is unit-tested by compiling it in a scratch crate; the full crate still cannot be built on every machine |
| `system_printer.rs` | Printers installed on this computer: lists them and sends raw ESC/POS to one by name with no print dialog (Windows spooler RAW datatype; CUPS `lpstat` / `lp -o raw` on Linux and macOS). Commands `list_system_printers` and `print_to_system_printer` live in `printer.rs`; the web side is `apps/web/src/lib/desktopPrinter.ts`. The platform code has no Tauri dependency, so its unit tests run from a scratch crate that includes the file |
| `cash_drawer.rs` | Drawer kick — ESC/POS `ESC p` pulse over USB/serial |
| `discovery.rs` | LAN server auto-discovery. UDP :47480 — client broadcasts `FAIDA_DISCOVER`, servers reply `FAIDA_SERVER:{api_port}:{hostname}`; client collects responses for 2 s |
| `lan_sync.rs` | TCP peer sync — a server terminal holds a registry of connected client streams and pushes events to all of them |
| `vscu.rs` | Offline eTIMS/VSCU queue in local SQLite (`rusqlite`) — sales are signed and held until KRA is reachable |
| `license.rs` | This computer's stable id (Windows MachineGuid / `/etc/machine-id` / macOS platform UUID, hostname hash as a last resort). It is handed to the server program, which binds the licence to it. **Nothing here decides whether a licence is valid**: the old checksum check, whose recipe shipped in the app and could be copied, is gone (see `apps/api/README.md`, Licensing) |
| `setup.rs` | First-run setup saved in `mode.json`: mode `CLOUD` / `SERVER_POS` / `SERVER` / `CLIENT` (`STANDALONE` is the old name for `SERVER_POS`), device role `FULL_POS` / `CASHIER` / `KIOSK` / `KDS` / `MANAGER` (tills only), and for server computers the database folder, backup folder and whether other computers may connect |
| `local_server_core.rs` | Launches and talks to the local server program (`packages/local-server`): JSON lines out, JSON commands in, stops everything when this app closes. **No Tauri code in it**, so its tests build anywhere (see Local server below) |
| `local_server.rs` | The `local_server_*` Tauri commands (defaults, validate folders, start, restart, stop, set_lan, status, backup, backups, restore); finds the installed files; keeps slow requests off the window thread |
| `backup.rs` | Local database backup/restore to disk |
| `app_update.rs` | Updating the app and the offline server inside it (see Updates below) |

## Updates

Installed apps update themselves, with the owner's go-ahead. Parts:

| Part | Where | What it does |
|---|---|---|
| `app_update.rs` | `src-tauri/src` | `app_update_check` asks the manifest whether a newer version exists; `app_update_install` downloads it, **stops the offline server cleanly (with a backup)**, runs the installer and restarts; `app_update_status` is polled for progress. If the installer cannot run, the server is started again |
| Banner and card | `apps/web`: `UpdateBanner.tsx` (top of every screen), `AppUpdateCard.tsx` (Settings, General), state in `lib/appUpdate.ts` | A check 20 s after start and every 6 h. The banner says "Faida 1.2.0 is ready"; the **owner or a manager** presses *Install and restart* (a cashier is told to ask). Quiet when offline |
| The signed manifest | `tauri.conf.json` `plugins.updater` | The app only accepts an installer signed with Faida's update key: the **public** key is in `tauri.conf.json`, the private key is the GitHub secret `TAURI_SIGNING_PRIVATE_KEY` |
| Manifest address | `https://github.com/simonkaruga/POS/releases/download/desktop-updates/latest.json` | One fixed address. The release workflow copies each release's `latest.json` there (a pre-release called `desktop-updates`, so it never becomes the repository's "latest release") |

**Data safety on the first start of a new version** (`packages/local-server`, `supervisor.ts`): the new version unpacks its own
server, then, before touching the database, saves a `pre-upgrade` backup (when the version changed, or when the database is
behind this version's migrations even if the number did not change). It then applies the database changes. If they fail, the
database is **put back from that backup** and the owner is told so, so a shop is never left half-updated. `update.integration.test.ts`
proves this on a real PostgreSQL and the real API, with records already in the database.

**No offline copy of the screens in the desktop app.** The website registers a service worker that answers pages from a saved
copy; inside the desktop app that copy outlived installs and updates, so the app opened on the PREVIOUS version's screens (a new
screen, such as the update banner, only appeared on the second launch). `main.tsx` now registers the worker only in a browser,
and the desktop app removes any worker and saved copy left by earlier versions (`lib/desktopCache.ts`, reloads once). An install
older than this fix still shows the previous screens for one launch after it first updates to a version with the fix.

### Shipping an update

```bash
node apps/desktop/scripts/app-version.mjs --set 1.2.0     # changes tauri.conf.json, Cargo.toml, Cargo.lock, package.json
git commit -am "release: desktop 1.2.0" && git push origin main
git tag desktop-v1.2.0 && git push origin desktop-v1.2.0   # the release workflow builds, signs and publishes
```

The version must go **up** (the app only updates to a higher number) and the tag must match it: the workflow checks both and
stops in seconds if not. The workflow builds Windows, Linux and both macOS targets, then copies `latest.json` to the fixed address
once all of them are done.

### One-time setup

1. The signing key pair is made with `npx tauri signer generate -w <file>`. Keep the private key and its password somewhere safe
   (**losing them means installed apps can never be updated again**, they would need a manual reinstall).
2. GitHub, Settings, Secrets and variables, Actions, **Secrets**: `TAURI_SIGNING_PRIVATE_KEY` (the whole key file's text) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. The public key in `tauri.conf.json` must be the matching one. To change keys, change both, and ship one manual installer
   first (apps built with the old public key reject updates signed with the new key).

### What an update does on a computer

- **Windows:** the installer runs in "passive" mode (a progress bar) and asks for administrator permission (the app installs for
  all users). Settings and the database are kept: the installer only removes `mode.json` on a *fresh* install.
- **Linux:** AppImage updates itself; a `.deb` install must be updated by installing the new `.deb`.
- **macOS:** the app is replaced and restarts.
- A **till** (client) updates on its own. Updating tills and their server to different versions is possible for a while: update
  the server first. (A version check between them is not built yet.)

---

## Setups

The wizard asks two questions: where does your data live, and what does THIS computer do?

- **CLOUD** — the app is a till for Faida Cloud (`get_cloud_url`); needs internet to sign in and sell.
- **SERVER_POS** — data on this computer, which is also the till (a small shop's one PC). Works fully offline. Other
  computers may not connect unless the owner ticks "Let other computers on this network connect".
- **SERVER** — data on this computer, which only serves the tills (a supermarket's back-room PC). It shows the server
  console (`ServerConsolePage`): status, the address tills type, backups, restore. LAN access is on by default.
- **CLIENT** — a till that finds (UDP discovery) or is given the server's address, with a device role.

Owners reach the server from inside the app: a server-and-till computer has **Server and backups** in the sidebar
(`/server`, `ServerSettingsPage`), a server-only computer has the same panel as its whole screen. Both show status, the
addresses tills type (shop network first), "Back up now", Restore, and the switch **Let other computers on this network
connect**, which saves the choice in `mode.json`, restarts the server so it listens accordingly (about ten seconds) and
switches the discovery answer (`discovery.rs`) on or off. The server applies the app's current choices on every start
(network access, backup folder, database folder), not just the first.

A computer that keeps its own data starts its database and API when the app starts and stops them (with a backup if the
last one is over an hour old) when the app closes. The web UI waits for them behind `LocalServerGate` and shows what is
happening ("Creating your database (first time only)").

## Local server

`packages/local-server` (TypeScript, see its README) runs a private PostgreSQL and the API on this computer: folders and
their safety rules, secrets, database start/stop, migrations, API process, backups, restore. This app only launches
`cli.js` and relays its status; the live database goes in `C:\ProgramData\Faida\pgdata` by default (never OneDrive,
Documents or a network share) and backups in `Documents\Faida Backups`.

## Packaging the offline server (Windows installer)

The Windows installer (NSIS `.exe`) carries the whole offline server as ONE file, `resources/server.tar.gz`: bundled Node,
the compiled API, Prisma, the server program (`packages/local-server`) and a trimmed PostgreSQL 17 (about 290 MB unpacked, about
110 MB packed). One file, not 11,000: an installer with that many files is slow and fragile, and a file glob can skip folders
whose names start with a dot, such as Prisma's generated `.prisma` client.

```bash
# on Windows, after: npm ci, prisma generate, build apps/api and packages/local-server
node apps/desktop/scripts/build-server-bundle.mjs     # assembles src-tauri/resources/server/ and server.tar.gz
node apps/desktop/scripts/smoke-server-bundle.mjs     # proves the bundle runs on its own (start, register, back up, stop)
```

- **Downloads are pinned**: `scripts/server-bundle.pins.json` holds the exact Node and PostgreSQL (EnterpriseDB build) URLs and
  SHA-256 hashes; a download with the wrong hash is deleted and the build stops. Upgrading means changing version and hash together.
- **What goes in**: the packages are copied from this repository's own `node_modules` (the versions that were tested, with their
  native parts, so build on Windows for Windows), PostgreSQL is cut down to the programs Faida runs (initdb, pg_ctl, postgres,
  pg_dump, pg_restore, psql and two support tools), their DLLs and Microsoft's runtime DLLs, the extension libraries and the
  shared data, without pgAdmin, documentation, translations or the Perl/Python/Tcl languages.
- **Unpacking**: the app unpacks the file once per build (app version + size) into `%LOCALAPPDATA%\Faida\server\<build>`
  using Windows' own `tar.exe` (by full path: a GNU tar from Git for Windows reads `C:\...` as a network host), into a
  temporary folder renamed into place only when complete, and removes older builds' folders. The wizard's folders step and the
  start-up screen say "Preparing the server" while it happens (up to a minute the first time).
- **Licence public key**: `build-server-bundle.mjs` writes `license-public-key.pem` into the bundle from the `LICENSE_PUBLIC_KEY`
  environment variable (or `--license-public-key FILE`) and **fails the build without it**, unless `--allow-unlicensed` is
  given (CI's server job uses that; it makes no installer). The release workflow reads it from the repository *variable*
  `LICENSE_PUBLIC_KEY`. Make the pair with `apps/api/scripts/generate-license-keys.mjs`; the private half never enters this repo.
- **Developer builds** have no real archive: `build.rs` leaves an empty placeholder, and starting a server says so. Run from a
  checkout with `FAIDA_DEV_REPO` instead (below).
- **Installer extras** (`src-tauri/windows/installer-hooks.nsh`, installs for all users so it can add firewall rules): inbound
  rules for TCP 3010 (API) and UDP 47480 (finding the server) on Private and Domain networks only. They are harmless on a
  single-computer setup, since the server listens on this computer only unless network access is switched on. **Uninstalling
  removes those rules and the unpacked server program, and never touches the database (`C:\ProgramData\Faida`) or the
  backups (`Documents\Faida Backups`).**
  **A fresh install opens on the setup wizard**: the wizard shows when `%APPDATA%\faida-pos\mode.json` is missing, and that file
  outlives an uninstall, so the installer's pre-install hook deletes it when Faida is not installed yet (an update over an existing
  installation keeps it). A damaged `mode.json` is moved aside (`mode.json.unreadable`) and the wizard starts. The installer check
  tests both the fresh and the update case.
- **CI**: the `offline-server` job in `ci.yml` builds the real Windows bundle, checks the packed file keeps `.prisma`, runs the
  smoke test and runs the server package's tests (including the real-database ones) against the Windows PostgreSQL;
  `desktop-release.yml` assembles and smoke-tests the bundle before building the installer, and builds only the NSIS `.exe` on
  Windows (an MSI would list every file).
- **Installer check without a release**: `desktop-installer-check.yml` (run it by hand from the Actions tab, or it runs when the
  installer's files change on `main`) builds the real NSIS installer on Windows and **publishes nothing**. It installs it silently,
  checks the program, uninstaller, `server.tar.gz` (same size as the one built) and both firewall rules, unpacks the installed
  server file with Windows' own `tar.exe` and runs the bundle smoke test on it, starts the installed app and requires it to stay
  up for 25 seconds, then uninstalls and proves a canary file in `C:\ProgramData\Faida` survived and the rules and files are
  gone. The installer is kept as a workflow artifact for 7 days so it can be tried on a real PC. Without the repository variable
  `LICENSE_PUBLIC_KEY` the artifact is named `UNLICENSED-test-build` and cannot activate a paid plan.
- **Not verified on a real Windows machine yet**: the workflow above has not been run yet, so the Visual C++ runtime DLLs taken
  from EnterpriseDB's package, Windows `tar.exe` unpacking, the NSIS hooks and the firewall rules are exercised for the first time
  by its first run; the installed app's window and the wizard have only been seen through a Linux stand-in.

**If the app crashes or is killed**, the server program stops the API and database by itself (a broken pipe is ignored and
an exit handler stops both), and if something still survives, the next start finds the leftover API by its saved process
id and stops it before starting a new one. Both are covered by integration tests.

**Running it from a checkout** (developers): build the API (`apps/api`) and the server program
(`packages/local-server`: `npm run build`), then start the desktop app with
`FAIDA_DEV_REPO=<repo> FAIDA_PG_BIN=<postgres bin folder> [FAIDA_PG_LIB=<its lib folder>]`.

**Testing the Rust launcher without Tauri:** `local_server_core.rs` uses only the standard library and `serde_json`; a scratch
crate that includes it with `#[path]` can run it against the real server program (spawn, status, backup, stop, a start that
fails for a non-empty folder). The Tauri wrappers in `local_server.rs` are type-checked the same way against a small stand-in
for the Tauri types; the full crate itself needs the Windows/Linux Tauri system libraries.

## First-run setup and reinstalls

The setup wizard (`web/src/pages/DesktopSetupPage.tsx`; its step order and what it saves are in
`web/src/lib/desktopSetup.ts`, unit-tested) shows whenever `get_setup_mode` reports `UNCONFIGURED`. The choice is saved in
`mode.json` under the OS config dir (`%APPDATA%\faida-pos\` on Windows), including the optional `business_name`.

**Owner account.** On a computer that keeps its own data (server and till, or server only) the wizard has an *Owner account*
step (business name, name, email, password; the same password rules as the server, checked first). On *Launch* it starts the
server, waits for it (`web/src/lib/ownerSetup.ts`: the first start creates the database, and the button shows what the
server is doing), registers the owner against the port the server really took, signs that owner in (token in
`sessionStorage`, never the password) and opens `/setup`. Any failure (email already used, server slow) falls back to the
login screen, where the same account can still be made; the step also has a *Skip* link. The password is held in memory only
until it is sent.

**Which server this is connected to.** The login screen shows the business name and where the data lives ("This computer keeps
the data and works offline", "Till connected to the server at 192.168.1.20:3010", "Faida Cloud") from `mode.json`
(`describeConnection`). Google sign-in is shown only in a browser or a desktop app set up for the cloud
(`googleSignInAvailable`): an offline server has no Google settings and no internet to rely on.

"Reconfigure this terminal" stops the local server and forgets `mode.json` but never deletes the database; setting up again on
the same folder picks the data up where it was.

**Fresh installs.** The NSIS installer's pre-install hook (`windows/installer-hooks.nsh`) deletes `mode.json` when Faida is not
installed yet, and keeps it on an update; the installer check proves both. (`wix/setup-cleanup.wxs` does the same on an MSI
uninstall, but Windows builds are NSIS-only now, so it does not run there.) To reset by hand, delete the file or use
Reconfigure on the login page.

## Google sign-in

The popup flow used on the web cannot work in the desktop webview, so
`oauth_browser_login` (`src-tauri/src/oauth.rs`) opens Google in the system browser and
catches the redirect on a one-shot `127.0.0.1` port. `web/src/lib/googleDesktop.ts`
drives it with PKCE; the API's `POST /auth/google/desktop-exchange` swaps the code for a
Google token (it holds the client secret), and the normal `google/token` or
`google/register` endpoint finishes the login. The API needs
`GOOGLE_DESKTOP_CLIENT_ID` and `GOOGLE_DESKTOP_CLIENT_SECRET` from a Google OAuth client
of type "Desktop app"; the desktop build itself needs no Google variable.

---

When you add a Tauri command, change the discovery/sync protocol, or alter the
setup topology, update this README in the same change.

---

## App icon

The icon is the Faida "F" mark (white and orange on a navy tile, cut from `design/faida-pos-logo.png`): `icon-src/logo.png` (1024 px) is the one source.
`icon-src/build_icons.py` cuts the rounded tile out of its white canvas (smooth edges, white inside the logo is kept),
trims it to a 3% margin, and scales that one 1024 px master to every size. Regenerate every platform file with:

```bash
cd apps/desktop
python3 icon-src/build_icons.py     # needs Python + Pillow; the .icns also needs the Tauri CLI (npx tauri icon)
```

It writes `src-tauri/icons/`: the PNGs `tauri.conf.json` lists (up to 1024 px), `icon.ico` (ten sizes from 16 to 256 px,
each scaled from the master, not from a smaller icon) and `icon.icns`. To change the icon, replace `icon-src/logo.png` with
a square image of 1024 px or more and re-run the script; do not edit the generated files.

Two details matter for sharpness. Frames of 64 px and below come from a zoomed "small" master (the shield fills the icon
instead of a quarter of it being empty gradient) and are lightly sharpened. And `icon.ico` lists the 48 px frame **first**
on purpose: Tauri builds the running window's title-bar and taskbar icon from the first entry and Windows rescales it, so a
16 px first entry is blown up (blurry). Do not let a tool re-sort the entries by size. Windows caches shortcut icons; after
an update, a stale one clears on restart or with `ie4uinit.exe -show`.
