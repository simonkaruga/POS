//! Updating the app itself (the program, and the offline server inside it).
//!
//! The web screen asks `app_update_check` now and then. When a newer version exists, the owner presses "Install and restart"
//! and the screen starts `app_update_install`, then polls `app_update_status`. The order matters because a shop's database
//! lives on this computer:
//!
//!   1. download the new installer (the till keeps working meanwhile; the file is checked against the public key in
//!      tauri.conf.json, so only an installer signed with Faida's update key is accepted),
//!   2. stop the offline server cleanly (it takes a backup first), because Windows ends this program the moment the
//!      installer starts and would otherwise cut the database off mid-write,
//!   3. run the installer, which starts the new version.
//!
//! The first start of the new version unpacks its server, saves a safety backup, applies the database changes and puts the
//! data back if they fail (`packages/local-server`, supervisor.ts). If the installer cannot run, the server is started again.

use crate::local_server::{self, LocalServerState};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How far an update has got, for the screen. `stage`: idle | downloading | stopping | installing | error.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
}

impl Default for Progress {
    fn default() -> Self {
        Progress { stage: "idle".to_string(), downloaded: 0, total: None, error: None }
    }
}

/// The update found by the last check (kept so installing does not need a second round trip) and how its install is going.
#[derive(Default)]
pub struct AppUpdateState {
    found: Mutex<Option<Update>>,
    progress: Arc<Mutex<Progress>>,
}

fn set_stage(progress: &Mutex<Progress>, stage: &str) {
    progress.lock().unwrap().stage = stage.to_string();
}

/// The version of this installed app.
#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Ask for a newer version. `None` when this is the newest; an error when the check could not be made (usually no internet).
#[tauri::command]
pub async fn app_update_check(app: AppHandle, state: State<'_, AppUpdateState>) -> Result<Option<Value>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| format!("Could not check for updates: {}", e))?;
    let info = found.as_ref().map(|u| {
        json!({
            "version": u.version,
            "currentVersion": u.current_version,
            "notes": u.body,
            "date": u.date.map(|d| d.to_string()),
        })
    });
    *state.found.lock().unwrap() = found;
    Ok(info)
}

/// Start installing the update found by the last check. Returns at once; poll `app_update_status`. On Windows this program
/// is ended by the installer, on the other systems it restarts itself.
#[tauri::command]
pub async fn app_update_install(app: AppHandle, state: State<'_, AppUpdateState>) -> Result<(), String> {
    let update = state
        .found
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No update has been found yet. Check for updates first.".to_string())?;
    let progress = state.progress.clone();
    {
        let mut p = progress.lock().unwrap();
        if matches!(p.stage.as_str(), "downloading" | "stopping" | "installing") {
            return Err("An update is already being installed.".to_string());
        }
        *p = Progress { stage: "downloading".to_string(), ..Progress::default() };
    }
    tauri::async_runtime::spawn(async move {
        if let Err(message) = run_install(&app, update, progress.clone()).await {
            // The installer did not run: the server was stopped for it, so bring it back before reporting the problem.
            let a = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || restart_server(&a)).await;
            *progress.lock().unwrap() = Progress { stage: "error".to_string(), error: Some(message), ..Progress::default() };
        }
    });
    Ok(())
}

async fn run_install(app: &AppHandle, update: Update, progress: Arc<Mutex<Progress>>) -> Result<(), String> {
    let on_chunk = progress.clone();
    let mut downloaded: u64 = 0;
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let mut p = on_chunk.lock().unwrap();
                p.downloaded = downloaded;
                p.total = total;
            },
            || {},
        )
        .await
        .map_err(|e| format!("The download did not finish: {}", e))?;

    set_stage(&progress, "stopping");
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || local_server::shutdown(&a)).await.map_err(|e| e.to_string())?;

    set_stage(&progress, "installing");
    update.install(bytes).map_err(|e| format!("The update could not be installed: {}", e))?;
    // Windows never gets here (the installer has already ended this program). On the other systems, start the new version.
    app.restart()
}

fn restart_server(app: &AppHandle) {
    let state = app.state::<LocalServerState>();
    let (slot, prep) = (state.0.clone(), state.1.clone());
    let _ = local_server::start(app, &slot, &prep);
}

#[tauri::command]
pub fn app_update_status(state: State<'_, AppUpdateState>) -> Progress {
    state.progress.lock().unwrap().clone()
}
