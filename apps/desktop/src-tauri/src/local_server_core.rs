//! Launches and talks to Faida's local server program (`packages/local-server`, `cli.js`), which runs the private
//! PostgreSQL and the API on this computer.
//!
//! No Tauri code in this file on purpose: it uses only the standard library and `serde_json`, so its tests build and run
//! on any machine, against the real server program. `local_server.rs` wraps it in Tauri commands.
//!
//! Protocol (see `packages/local-server/src/cli.ts`): the program prints one JSON object per line on stdout
//! (`status`, `error`, `result`, ...) and reads one JSON command per line on stdin. When stdin closes it stops the API
//! and the database by itself, so a crash of this app never leaves them running in the background.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Where each piece lives. In the installed app they are all under `<resources>/server` (see `from_server_dir`).
#[derive(Clone, Debug)]
pub struct ServerPaths {
    pub node: PathBuf,
    pub cli: PathBuf,
    pub api_main: PathBuf,
    pub prisma_cli: PathBuf,
    pub schema: PathBuf,
    pub pg_bin: PathBuf,
    /// Only where the PostgreSQL libraries are not next to the programs (Linux/macOS builds; Windows keeps DLLs in bin).
    pub pg_lib: Option<PathBuf>,
    /// The PUBLIC key licences are checked against, written into the bundle at build time. Absent in developer runs and
    /// in test builds, where no paid plan can then be activated.
    pub license_public_key: PathBuf,
}

impl ServerPaths {
    /// The layout the installer builds:
    ///
    /// ```text
    /// server/node/node(.exe)            bundled Node
    /// server/local-server/dist/cli.js   this program
    /// server/api/dist/main.js           the API (its packages in server/node_modules)
    /// server/node_modules/prisma/...    Prisma CLI for migrations
    /// server/prisma/schema.prisma       schema + migrations
    /// server/postgres/bin, lib, share   PostgreSQL
    /// ```
    pub fn from_server_dir(dir: &Path) -> ServerPaths {
        let node = if cfg!(windows) { "node.exe" } else { "node" };
        let lib = dir.join("postgres").join("lib");
        ServerPaths {
            node: dir.join("node").join(node),
            cli: dir.join("local-server").join("dist").join("cli.js"),
            api_main: dir.join("api").join("dist").join("main.js"),
            prisma_cli: dir.join("node_modules").join("prisma").join("build").join("index.js"),
            schema: dir.join("prisma").join("schema.prisma"),
            pg_bin: dir.join("postgres").join("bin"),
            pg_lib: if cfg!(windows) || !lib.exists() { None } else { Some(lib) },
            license_public_key: dir.join("license-public-key.pem"),
        }
    }

    /// Developer machines: run straight from a checkout, with `node` from the PATH and PostgreSQL from `pg_bin`.
    pub fn from_repo(repo: &Path, pg_bin: &Path, pg_lib: Option<&Path>) -> ServerPaths {
        ServerPaths {
            node: PathBuf::from("node"),
            cli: repo.join("packages").join("local-server").join("dist").join("cli.js"),
            api_main: repo.join("apps").join("api").join("dist").join("main.js"),
            prisma_cli: repo.join("node_modules").join("prisma").join("build").join("index.js"),
            schema: repo.join("prisma").join("schema.prisma"),
            pg_bin: pg_bin.to_path_buf(),
            pg_lib: pg_lib.map(|p| p.to_path_buf()),
            license_public_key: repo.join("license-public-key.pem"),
        }
    }

    /// Say exactly what is missing instead of failing later with a puzzling error.
    pub fn check(&self) -> Result<(), String> {
        let mut missing = Vec::new();
        for (name, p) in [("Node", &self.node), ("server program", &self.cli), ("API", &self.api_main), ("Prisma", &self.prisma_cli), ("database schema", &self.schema)] {
            // A bare command name like "node" is looked up on the PATH when spawned.
            if p.components().count() > 1 && !p.exists() {
                missing.push(format!("{} ({})", name, p.display()));
            }
        }
        if !self.pg_bin.exists() {
            missing.push(format!("PostgreSQL ({})", self.pg_bin.display()));
        }
        if missing.is_empty() {
            Ok(())
        } else {
            Err(format!("These parts of the server are missing from this installation: {}. Reinstall Faida POS.", missing.join(", ")))
        }
    }
}

/// The program that unpacks the server archive. On Windows it is the `tar.exe` that ships with Windows 10 and later, called
/// by its full path: a GNU `tar` from Git for Windows is often first on the PATH and reads `C:\\...` as a network host.
fn tar_program() -> PathBuf {
    if cfg!(windows) {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        PathBuf::from(root).join("System32").join("tar.exe")
    } else {
        PathBuf::from("tar")
    }
}

const READY_MARKER: &str = ".faida-ready";

/// An archive smaller than this is the empty placeholder a developer build carries, not a real server.
pub const MIN_REAL_ARCHIVE_BYTES: u64 = 1_000_000;

/// Unpack the server archive (`server.tar.gz`, one file in the installer) into `<versions_dir>/<key>` and return that folder.
///
/// The key names the build (app version and archive size), so an update unpacks fresh and an unchanged build reuses what is
/// there. Unpacking goes to a temporary sibling folder and is renamed into place only when complete, so a power cut halfway
/// never leaves a half-unpacked server that looks finished. Other builds' folders are removed afterwards to save disk.
/// Only folders directly inside `versions_dir` are ever touched.
pub fn ensure_extracted(archive: &Path, versions_dir: &Path, key: &str) -> Result<PathBuf, String> {
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());
    let _guard = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());

    let size = std::fs::metadata(archive).map(|m| m.len()).map_err(|e| format!("Cannot read the server package {}: {}", archive.display(), e))?;
    if size < MIN_REAL_ARCHIVE_BYTES {
        return Err("This build of Faida POS does not include the offline server (it is a developer build). Install the full installer, or set FAIDA_DEV_REPO to run from a checkout.".to_string());
    }
    let dest = versions_dir.join(key);
    if dest.join(READY_MARKER).exists() {
        return Ok(dest);
    }
    std::fs::create_dir_all(versions_dir).map_err(|e| format!("Cannot create {}: {}", versions_dir.display(), e))?;
    let tmp = versions_dir.join(format!("{}.unpacking", key));
    let _ = std::fs::remove_dir_all(&tmp); // leftovers of an earlier attempt that did not finish
    let _ = std::fs::remove_dir_all(&dest); // a folder without the marker is a failed earlier unpack
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let mut c = Command::new(tar_program());
    c.arg("-xzf").arg(archive).arg("-C").arg(&tmp).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let out = c.output().map_err(|e| format!("Could not run tar to unpack the server: {}", e))?;
    if !out.status.success() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("Unpacking the server failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    std::fs::write(tmp.join(READY_MARKER), "ok").map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &dest).map_err(|e| format!("Could not finish unpacking the server: {}", e))?;

    // Remove the builds we are no longer using (each is a full copy, about 300 MB).
    if let Ok(entries) = std::fs::read_dir(versions_dir) {
        for entry in entries.flatten() {
            if entry.path() != dest && entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
    Ok(dest)
}

/// What to run with.
#[derive(Clone, Debug, Default)]
pub struct LaunchOptions {
    /// Faida's settings/secrets/logs folder; `None` uses the default (C:\ProgramData\Faida). Tests point it at a temp folder.
    pub root_dir: Option<String>,
    /// Folder for the live database; `None` uses the default (C:\ProgramData\Faida\pgdata).
    pub data_dir: Option<String>,
    pub backup_dir: Option<String>,
    pub lan_enabled: bool,
    pub app_version: String,
    pub pg_port: Option<u16>,
    pub api_port: Option<u16>,
    /// This computer's id and where licences are issued; the licence is bound to the first and renewed from the second.
    pub machine_id: Option<String>,
    pub license_server_url: Option<String>,
}

#[derive(Default)]
struct Shared {
    status: Option<Value>,
    last_error: Option<String>,
    exited: bool,
    pending: HashMap<u64, Sender<Value>>,
}

pub struct LocalServer {
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    shared: Arc<Mutex<Shared>>,
    next_id: Mutex<u64>,
}

fn command(paths: &ServerPaths) -> Command {
    let mut c = Command::new(&paths.node);
    c.arg(&paths.cli);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: never flash a console
    }
    c
}

/// Run a one-shot subcommand (`defaults`, `validate`) and return the one JSON line it prints.
pub fn run_once(paths: &ServerPaths, args: &[&str]) -> Result<Value, String> {
    let mut c = command(paths);
    c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let out = c.output().map_err(|e| format!("Could not start the server program: {}", e))?;
    if !out.status.success() {
        return Err(format!("The server program failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().rev().find(|l| l.trim_start().starts_with('{')).ok_or("The server program gave no answer")?;
    serde_json::from_str(line).map_err(|e| format!("Unreadable answer from the server program: {}", e))
}

impl LocalServer {
    /// Start the server program. Returns immediately; poll `status()` until it reports `running` (or `error`).
    pub fn spawn(paths: &ServerPaths, opts: &LaunchOptions) -> Result<LocalServer, String> {
        paths.check()?;
        let mut c = command(paths);
        c.arg("run")
            .args(["--pg-bin", &paths.pg_bin.to_string_lossy()])
            .args(["--api-main", &paths.api_main.to_string_lossy()])
            .args(["--prisma-cli", &paths.prisma_cli.to_string_lossy()])
            .args(["--schema", &paths.schema.to_string_lossy()])
            .args(["--app-version", &opts.app_version])
            .args(["--lan", if opts.lan_enabled { "true" } else { "false" }]);
        if let Some(lib) = &paths.pg_lib {
            c.args(["--pg-lib", &lib.to_string_lossy()]);
        }
        if let Some(r) = &opts.root_dir {
            c.args(["--root", r]);
        }
        if let Some(d) = &opts.data_dir {
            c.args(["--data-dir", d]);
        }
        if let Some(b) = &opts.backup_dir {
            c.args(["--backup-dir", b]);
        }
        if let Some(p) = opts.pg_port {
            c.args(["--pg-port", &p.to_string()]);
        }
        if let Some(p) = opts.api_port {
            c.args(["--api-port", &p.to_string()]);
        }
        if let Some(m) = &opts.machine_id {
            c.args(["--machine-id", m]);
        }
        if let Some(u) = &opts.license_server_url {
            c.args(["--license-server", u]);
        }
        if paths.license_public_key.exists() {
            c.args(["--license-public-key", &paths.license_public_key.to_string_lossy()]);
        }
        c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = c.spawn().map_err(|e| format!("Could not start the server program: {}", e))?;
        let stdin = child.stdin.take().ok_or("No input pipe to the server program")?;
        let stdout = child.stdout.take().ok_or("No output pipe from the server program")?;
        let shared = Arc::new(Mutex::new(Shared::default()));

        let reader_shared = Arc::clone(&shared);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
                let mut s = reader_shared.lock().unwrap();
                match msg.get("type").and_then(Value::as_str) {
                    Some("status") => s.status = Some(msg),
                    Some("error") => s.last_error = msg.get("message").and_then(Value::as_str).map(str::to_string),
                    Some("result") => {
                        if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                            if let Some(tx) = s.pending.remove(&id) {
                                let _ = tx.send(msg);
                            }
                        }
                    }
                    _ => {}
                }
            }
            reader_shared.lock().unwrap().exited = true;
        });

        Ok(LocalServer { child: Mutex::new(child), stdin: Mutex::new(Some(stdin)), shared, next_id: Mutex::new(1) })
    }

    /// The latest status line, or a "starting" placeholder before the first one arrives. If the program died without
    /// saying why, say so.
    pub fn status(&self) -> Value {
        let s = self.shared.lock().unwrap();
        if let Some(st) = &s.status {
            if s.exited && st.get("phase").and_then(Value::as_str) != Some("stopped") {
                return json!({"phase": "error", "message": s.last_error.clone().unwrap_or_else(|| "The server stopped unexpectedly.".into()), "addresses": []});
            }
            return st.clone();
        }
        if s.exited {
            return json!({"phase": "error", "message": s.last_error.clone().unwrap_or_else(|| "The server could not start.".into()), "addresses": []});
        }
        json!({"phase": "starting", "message": "Starting", "addresses": []})
    }

    /// Send a command and wait for its answer. Returns the `data` of a successful result, or the program's error text.
    pub fn request(&self, cmd: &str, file: Option<&str>, timeout: Duration) -> Result<Value, String> {
        let id = {
            let mut n = self.next_id.lock().unwrap();
            let id = *n;
            *n += 1;
            id
        };
        let (tx, rx) = channel();
        self.shared.lock().unwrap().pending.insert(id, tx);
        let mut msg = json!({"id": id, "cmd": cmd});
        if let Some(f) = file {
            msg["file"] = json!(f);
        }
        {
            let mut guard = self.stdin.lock().unwrap();
            let stdin = guard.as_mut().ok_or("The server is shutting down")?;
            writeln!(stdin, "{}", msg).and_then(|_| stdin.flush()).map_err(|e| format!("The server program is not answering: {}", e))?;
        }
        match rx.recv_timeout(timeout) {
            Ok(res) => {
                if res.get("ok").and_then(Value::as_bool) == Some(true) {
                    Ok(res.get("data").cloned().unwrap_or(Value::Null))
                } else {
                    Err(res.get("error").and_then(Value::as_str).unwrap_or("The request failed").to_string())
                }
            }
            Err(_) => {
                self.shared.lock().unwrap().pending.remove(&id);
                Err("The server took too long to answer".to_string())
            }
        }
    }

    /// Ask the server program to stop (it backs up first if the last backup is over an hour old), then wait for it to
    /// finish. Returns true if it exited within `wait`; otherwise it is killed.
    pub fn stop(&self, wait: Duration) -> bool {
        // Closing stdin is the signal: the program stops the API and database cleanly, takes the on-close backup, exits.
        self.stdin.lock().unwrap().take();
        let deadline = Instant::now() + wait;
        loop {
            if let Ok(Some(_)) = self.child.lock().unwrap().try_wait() {
                return true;
            }
            if Instant::now() > deadline {
                let _ = self.child.lock().unwrap().kill();
                return false;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }
}

impl Drop for LocalServer {
    fn drop(&mut self) {
        // Dropping the handle closes stdin, which makes the server program shut everything down.
        self.stdin.lock().unwrap().take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_dir_layout_is_what_the_installer_builds() {
        let p = ServerPaths::from_server_dir(Path::new("/res/server"));
        assert!(p.cli.ends_with("local-server/dist/cli.js") || p.cli.ends_with("local-server\\dist\\cli.js"));
        assert!(p.schema.ends_with("prisma/schema.prisma") || p.schema.ends_with("prisma\\schema.prisma"));
        assert!(p.pg_bin.ends_with("postgres/bin") || p.pg_bin.ends_with("postgres\\bin"));
        assert!(p.license_public_key.ends_with("server/license-public-key.pem") || p.license_public_key.ends_with("server\\license-public-key.pem"));
    }

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("faida-core-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// A real tar.gz over the minimum size, holding a dot-folder like Prisma's `.prisma`.
    fn make_archive(dir: &Path, name: &str) -> PathBuf {
        let src = dir.join("src");
        std::fs::create_dir_all(src.join("node_modules").join(".prisma").join("client")).unwrap();
        std::fs::write(src.join("node_modules").join(".prisma").join("client").join("index.js"), "x").unwrap();
        std::fs::write(src.join("filler.bin"), vec![7u8; 2_000_000]).unwrap(); // incompressible enough to pass the size floor after gzip
        let mut rng = 0x9E3779B97F4A7C15u64;
        let noise: Vec<u8> = (0..1_500_000).map(|_| { rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; (rng >> 24) as u8 }).collect();
        std::fs::write(src.join("noise.bin"), noise).unwrap();
        let archive = dir.join(name);
        let st = Command::new("tar").arg("-czf").arg(&archive).arg("-C").arg(&src).arg(".").status().unwrap();
        assert!(st.success());
        archive
    }

    #[test]
    fn unpacks_once_keeps_dot_folders_and_reuses_the_result() {
        let d = scratch("unpack");
        let archive = make_archive(&d, "server.tar.gz");
        let versions = d.join("versions");
        let first = ensure_extracted(&archive, &versions, "1.0.0-abc").unwrap();
        assert!(first.join(".faida-ready").exists());
        assert!(first.join("node_modules").join(".prisma").join("client").join("index.js").exists(), "dot-folders must survive");
        // the second call does not unpack again
        std::fs::write(first.join("touched"), "yes").unwrap();
        let again = ensure_extracted(&archive, &versions, "1.0.0-abc").unwrap();
        assert_eq!(first, again);
        assert!(again.join("touched").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_update_unpacks_fresh_and_removes_the_old_build() {
        let d = scratch("update");
        let archive = make_archive(&d, "server.tar.gz");
        let versions = d.join("versions");
        let old = ensure_extracted(&archive, &versions, "1.0.0-abc").unwrap();
        let new = ensure_extracted(&archive, &versions, "1.1.0-def").unwrap();
        assert!(new.exists() && !old.exists(), "the previous build's folder is removed");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_half_finished_unpack_is_not_mistaken_for_a_good_one() {
        let d = scratch("half");
        let archive = make_archive(&d, "server.tar.gz");
        let versions = d.join("versions");
        std::fs::create_dir_all(versions.join("1.0.0-abc")).unwrap(); // no marker: a failed earlier attempt
        std::fs::write(versions.join("1.0.0-abc").join("junk"), "x").unwrap();
        std::fs::create_dir_all(versions.join("1.0.0-abc.unpacking")).unwrap();
        let dir = ensure_extracted(&archive, &versions, "1.0.0-abc").unwrap();
        assert!(dir.join(".faida-ready").exists());
        assert!(!dir.join("junk").exists());
        assert!(!versions.join("1.0.0-abc.unpacking").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_developer_placeholder_is_refused_with_a_clear_message() {
        let d = scratch("placeholder");
        let empty = d.join("server.tar.gz");
        std::fs::write(&empty, "").unwrap();
        let err = ensure_extracted(&empty, &d.join("versions"), "1.0.0").unwrap_err();
        assert!(err.contains("developer build"), "{}", err);
        assert!(!d.join("versions").exists(), "nothing is created for a placeholder");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_damaged_archive_reports_the_failure_and_leaves_nothing_behind() {
        let d = scratch("damaged");
        let bad = d.join("server.tar.gz");
        std::fs::write(&bad, vec![1u8; 2_000_000]).unwrap(); // big enough, but not a tar.gz
        let versions = d.join("versions");
        let err = ensure_extracted(&bad, &versions, "1.0.0").unwrap_err();
        assert!(err.contains("Unpacking the server failed"), "{}", err);
        assert!(!versions.join("1.0.0").exists() && !versions.join("1.0.0.unpacking").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn missing_parts_are_named() {
        let p = ServerPaths::from_server_dir(Path::new("/definitely/not/here"));
        let err = p.check().unwrap_err();
        assert!(err.contains("API") && err.contains("PostgreSQL") && err.contains("Reinstall"));
    }
}
