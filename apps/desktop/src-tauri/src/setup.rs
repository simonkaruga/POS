use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct SetupConfig {
    /// Where this computer's data lives and what it does:
    ///   CLOUD        data in Faida Cloud; this app is a till
    ///   SERVER_POS   data on THIS computer, which is also a till (a small shop's single PC)
    ///   SERVER       data on this computer, which only serves the tills (a dedicated server PC)
    ///   CLIENT       a till that connects to a server on the network
    /// (STANDALONE is the old name for SERVER_POS and is still read.)
    pub mode: String,
    /// Device role: FULL_POS | CASHIER | KIOSK | KDS | MANAGER
    /// Meaningful on CLIENT; defaults to FULL_POS for STANDALONE/SERVER
    pub device_role: Option<String>,
    /// Only set when mode == CLIENT
    pub server_url: Option<String>,
    pub store_id: Option<String>,
    /// Activated license key (on-premise deployments)
    pub license_key: Option<String>,
    /// Display name for this terminal (shown in admin panel)
    pub terminal_name: Option<String>,
    /// Business name entered in the wizard; pre-fills registration
    pub business_name: Option<String>,
    /// Folder for the live database (SERVER_POS / SERVER). None = the default, C:\ProgramData\Faida\pgdata.
    #[serde(default)]
    pub data_dir: Option<String>,
    /// Folder for backups. None = Documents\Faida Backups.
    #[serde(default)]
    pub backup_dir: Option<String>,
    /// May other computers on the network connect to this server?
    #[serde(default)]
    pub lan_enabled: Option<bool>,
}

/// Does this computer run its own database and API?
pub fn is_local_server_mode(mode: &str) -> bool {
    matches!(mode, "SERVER_POS" | "SERVER" | "STANDALONE")
}

/// Change part of the saved setup (for example the "other computers may connect" choice) and write it back.
pub fn update_config(change: impl FnOnce(&mut SetupConfig)) -> Result<SetupConfig, String> {
    let mut cfg = read_config()?;
    change(&mut cfg);
    let content = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(get_config_path(), content).map_err(|e| e.to_string())?;
    Ok(cfg)
}

/// Read mode.json without async, for code that already runs on its own thread.
pub fn read_config() -> Result<SetupConfig, String> {
    let path = get_config_path();
    if !path.exists() {
        return Err("This computer has not been set up yet.".to_string());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn get_config_path() -> PathBuf {
    let mut path = dirs_next::config_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    path.push("faida-pos");
    fs::create_dir_all(&path).ok();
    path.push("mode.json");
    path
}

/// What `get_setup_mode` answers when there is no usable setup: the web app shows the wizard for `UNCONFIGURED`.
fn unconfigured() -> SetupConfig {
    SetupConfig {
        mode: "UNCONFIGURED".to_string(),
        device_role: None,
        server_url: None,
        store_id: None,
        license_key: None,
        terminal_name: None,
        business_name: None,
        data_dir: None,
        backup_dir: None,
        lan_enabled: None,
    }
}

#[tauri::command]
pub async fn get_setup_mode() -> Result<SetupConfig, String> {
    let path = get_config_path();
    if !path.exists() {
        // Return a sentinel value so the UI knows first-run wizard must be shown
        return Ok(unconfigured());
    }
    // An unreadable or damaged file must not leave the app guessing: keep it aside for inspection and start the wizard.
    let parsed = fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|c| serde_json::from_str::<SetupConfig>(&c).map_err(|e| e.to_string()));
    match parsed {
        Ok(cfg) => Ok(cfg),
        Err(_) => {
            let _ = fs::rename(&path, path.with_extension("json.unreadable"));
            Ok(unconfigured())
        }
    }
}

#[tauri::command]
pub async fn set_setup_mode(
    mode: String,
    device_role: Option<String>,
    server_url: Option<String>,
    store_id: Option<String>,
    license_key: Option<String>,
    terminal_name: Option<String>,
    business_name: Option<String>,
    data_dir: Option<String>,
    backup_dir: Option<String>,
    lan_enabled: Option<bool>,
) -> Result<bool, String> {
    let config = SetupConfig {
        mode,
        device_role,
        server_url,
        store_id,
        license_key,
        terminal_name,
        business_name,
        data_dir,
        backup_dir,
        lan_enabled,
    };
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    let path = get_config_path();
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Reset setup config — shows the wizard again on next launch
#[tauri::command]
pub async fn reset_setup() -> Result<bool, String> {
    let path = get_config_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

/// Return the vendor's cloud server URL baked in at build time.
/// Set VITE_FAIDA_CLOUD_URL in the web .env before building the installer.
#[tauri::command]
pub fn get_cloud_url() -> String {
    cloud_url()
}

/// The Faida cloud address this build talks to (licences are issued and renewed there).
pub fn cloud_url() -> String {
    // The env var is embedded at compile-time via the build script or
    // via the web Vite build that Tauri bundles.
    // We expose it as a Tauri command so the setup wizard can read it.
    option_env!("FAIDA_CLOUD_URL")
        .unwrap_or("https://faida-api.onrender.com")
        .to_string()
}

#[tauri::command]
pub async fn test_server_connection(server_url: String) -> Result<bool, String> {
    use tokio::net::TcpStream;

    let url = server_url.trim_end_matches('/');

    // Derive host:port from the URL
    let host_port = if url.starts_with("http://") {
        let h = url.trim_start_matches("http://");
        if h.contains(':') {
            h.to_string()
        } else {
            format!("{}:3010", h)
        }
    } else if url.starts_with("https://") {
        let h = url.trim_start_matches("https://");
        if h.contains(':') {
            h.to_string()
        } else {
            format!("{}:443", h)
        }
    } else {
        // Bare host — assume default API port
        if url.contains(':') {
            url.to_string()
        } else {
            format!("{}:3010", url)
        }
    };

    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        TcpStream::connect(&host_port),
    )
    .await
    {
        Ok(Ok(_)) => Ok(true),
        _ => Ok(false),
    }
}
