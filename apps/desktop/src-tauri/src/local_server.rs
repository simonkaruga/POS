//! Tauri commands for the local server (the private PostgreSQL + API that "this computer" and "server only" setups run).
//! All the real work is in `local_server_core.rs`; this file only finds the installed files, keeps the one running
//! server in app state, and keeps slow requests (a backup can take a minute) off the window's thread.

use crate::discovery;
use crate::local_server_core::{ensure_extracted, run_once, LaunchOptions, LocalServer, ServerPaths};
use crate::setup;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

pub type Slot = Arc<RwLock<Option<Arc<LocalServer>>>>;

/// Where the server files are in their life: not yet needed, being unpacked from the installer's single archive, or failed.
#[derive(Clone, Debug, Default)]
pub enum Prep {
    #[default]
    Idle,
    Working(String),
    Failed(String),
}

/// The one running server (or none), and what is happening before it can run. Cloning the inner `Arc`s lets slow requests
/// run without holding a lock.
#[derive(Default)]
pub struct LocalServerState(pub Slot, pub Arc<Mutex<Prep>>);

/// Where the server's files are. Installed: the installer carries the server as ONE file, `server.tar.gz` (11,000 small files
/// make a poor installer), and it is unpacked once per build into the user's local app data folder, then reused. Developers
/// can run from a checkout instead: set FAIDA_DEV_REPO to the repository folder and FAIDA_PG_BIN (and FAIDA_PG_LIB where
/// needed) to a PostgreSQL `bin` folder.
///
/// Unpacking can take a minute the first time, so this must run off the window's thread. Progress is kept in `prep` so the
/// screen can say "Preparing the server" instead of looking stuck.
fn server_paths(app: &AppHandle, prep: &Mutex<Prep>) -> Result<ServerPaths, String> {
    if let Ok(repo) = std::env::var("FAIDA_DEV_REPO") {
        let pg_bin = std::env::var("FAIDA_PG_BIN").map_err(|_| "FAIDA_PG_BIN must point to a PostgreSQL bin folder when FAIDA_DEV_REPO is set".to_string())?;
        let pg_lib = std::env::var("FAIDA_PG_LIB").ok();
        return Ok(ServerPaths::from_repo(Path::new(&repo), Path::new(&pg_bin), pg_lib.as_deref().map(Path::new)));
    }
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    // Where Tauri puts a bundled file depends on how tauri.conf.json lists it; accept both likely places.
    let archive = [resources.join("server.tar.gz"), resources.join("resources").join("server.tar.gz")]
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "The offline server is missing from this installation. Reinstall Faida POS.".to_string())?;
    let versions = dirs_next::data_local_dir()
        .ok_or_else(|| "Cannot find this computer's local app data folder.".to_string())?
        .join("Faida")
        .join("server");
    let size = std::fs::metadata(&archive).map(|m| m.len()).unwrap_or(0);
    let key = format!("{}-{}", app.package_info().version, size);

    *prep.lock().unwrap() = Prep::Working("Preparing the server (first time after an install or an update)".to_string());
    let unpacked = ensure_extracted(&archive, &versions, &key);
    *prep.lock().unwrap() = match &unpacked {
        Ok(_) => Prep::Idle,
        Err(e) => Prep::Failed(e.clone()),
    };
    Ok(ServerPaths::from_server_dir(&unpacked?))
}

/// Start the server for this computer if its setup says it runs one. Safe to call twice.
pub fn start(app: &AppHandle, slot: &Slot, prep: &Mutex<Prep>) -> Result<bool, String> {
    if slot.read().unwrap().is_some() {
        return Ok(true);
    }
    let cfg = setup::read_config()?;
    if !setup::is_local_server_mode(&cfg.mode) {
        return Ok(false);
    }
    let paths = server_paths(app, prep)?;
    let opts = LaunchOptions {
        root_dir: None,
        data_dir: cfg.data_dir,
        backup_dir: cfg.backup_dir,
        lan_enabled: cfg.lan_enabled.unwrap_or(false),
        app_version: app.package_info().version.to_string(),
        pg_port: None,
        api_port: None,
        machine_id: Some(crate::license::machine_id()),
        license_server_url: Some(setup::cloud_url()),
    };
    let server = LocalServer::spawn(&paths, &opts)?;
    *slot.write().unwrap() = Some(Arc::new(server));
    Ok(true)
}

/// Stop the server and wait for it (it saves a backup first when the last one is over an hour old).
pub fn shutdown(app: &AppHandle) {
    let slot = app.state::<LocalServerState>().0.clone();
    let server = slot.write().unwrap().take();
    if let Some(s) = server {
        s.stop(Duration::from_secs(120));
    }
}

fn current(state: &State<'_, LocalServerState>) -> Result<Arc<LocalServer>, String> {
    state.0.read().unwrap().clone().ok_or_else(|| "The server is not running.".to_string())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// The default folders for this computer, for the setup wizard.
#[tauri::command]
pub async fn local_server_defaults(app: AppHandle, state: State<'_, LocalServerState>) -> Result<Value, String> {
    let prep = state.1.clone();
    blocking(move || run_once(&server_paths(&app, &prep)?, &["defaults"])).await
}

/// Check the folders the owner chose; returns `{ dataDir: {ok, reason?}, backupDir: {ok, reason?} }`.
#[tauri::command]
pub async fn local_server_validate_folders(app: AppHandle, state: State<'_, LocalServerState>, data_dir: String, backup_dir: String) -> Result<Value, String> {
    let prep = state.1.clone();
    blocking(move || run_once(&server_paths(&app, &prep)?, &["validate", "--data-dir", &data_dir, "--backup-dir", &backup_dir])).await
}

/// Start (idempotent). Returns at once; the web polls `local_server_status`.
#[tauri::command]
pub async fn local_server_start(app: AppHandle, state: State<'_, LocalServerState>) -> Result<bool, String> {
    let (slot, prep) = (state.0.clone(), state.1.clone());
    // Off the window's thread: the first start unpacks the server, which takes a while.
    blocking(move || start(&app, &slot, &prep)).await
}

/// Stop the server (if running) and start it again, for the "Try again" button after an error.
#[tauri::command]
pub async fn local_server_restart(app: AppHandle, state: State<'_, LocalServerState>) -> Result<bool, String> {
    let old = state.0.write().unwrap().take();
    if let Some(s) = old {
        blocking(move || {
            s.stop(Duration::from_secs(120));
            Ok(())
        })
        .await?;
    }
    let (slot, prep) = (state.0.clone(), state.1.clone());
    blocking(move || start(&app, &slot, &prep)).await
}

/// Stop the server and forget it (used when this computer is being reconfigured).
#[tauri::command]
pub async fn local_server_stop(state: State<'_, LocalServerState>) -> Result<bool, String> {
    let old = state.0.write().unwrap().take();
    if let Some(s) = old {
        blocking(move || {
            s.stop(Duration::from_secs(120));
            Ok(())
        })
        .await?;
    }
    Ok(true)
}

/// Let other computers on the network connect to this server, or stop them. Saves the choice, restarts the server so it
/// listens accordingly (about ten seconds), and starts or silences the "who is the server?" answer.
#[tauri::command]
pub async fn local_server_set_lan(app: AppHandle, state: State<'_, LocalServerState>, enabled: bool) -> Result<bool, String> {
    let cfg = setup::update_config(|c| c.lan_enabled = Some(enabled))?;
    if !setup::is_local_server_mode(&cfg.mode) {
        return Err("This computer does not keep its own data.".to_string());
    }
    let restarted = local_server_restart(app, state).await?;
    if enabled {
        discovery::start_discovery_responder(3010);
    } else {
        discovery::stop_discovery_responder();
    }
    Ok(restarted)
}

#[tauri::command]
pub async fn local_server_status(state: State<'_, LocalServerState>) -> Result<Value, String> {
    if let Some(s) = state.0.read().unwrap().as_ref() {
        return Ok(s.status());
    }
    // No server yet: say whether its files are being unpacked or could not be.
    Ok(match &*state.1.lock().unwrap() {
        Prep::Working(message) => json!({ "phase": "starting", "message": message, "addresses": [] }),
        Prep::Failed(message) => json!({ "phase": "error", "message": message, "addresses": [] }),
        Prep::Idle => json!({ "phase": "stopped", "message": "Not started", "addresses": [] }),
    })
}

#[tauri::command]
pub async fn local_server_backup(state: State<'_, LocalServerState>) -> Result<Value, String> {
    let s = current(&state)?;
    blocking(move || s.request("backup", None, Duration::from_secs(30 * 60))).await
}

#[tauri::command]
pub async fn local_server_backups(state: State<'_, LocalServerState>) -> Result<Value, String> {
    let s = current(&state)?;
    blocking(move || s.request("backups", None, Duration::from_secs(30))).await
}

#[tauri::command]
pub async fn local_server_restore(state: State<'_, LocalServerState>, file: String) -> Result<bool, String> {
    let s = current(&state)?;
    blocking(move || s.request("restore", Some(&file), Duration::from_secs(60 * 60)).map(|_| true)).await
}
