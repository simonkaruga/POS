#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod printer;
mod system_printer;
mod lan_sync;
mod vscu;
mod cash_drawer;
mod backup;
mod setup;
mod oauth;
mod license;
mod discovery;
mod local_server_core;
mod local_server;
mod app_update;

/// Set once the window is closing, so the second "exit" request (the one we make ourselves) goes through.
static SHUTTING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn main() {
    use tauri::Manager;

    let app = tauri::Builder::default()
        .manage(local_server::LocalServerState::default())
        .manage(app_update::AppUpdateState::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let version = app.package_info().version.to_string();
            println!("Faida POS Desktop v{} starting...", version);

            // A computer that keeps its own data starts its database and API now; the web UI shows progress.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let (slot, prep) = {
                    let state = handle.state::<local_server::LocalServerState>();
                    (state.0.clone(), state.1.clone())
                };
                if let Err(e) = local_server::start(&handle, &slot, &prep) {
                    eprintln!("Local server did not start: {}", e);
                }
            });

            // Answer "who is the Faida server?" broadcasts only when other computers are allowed to connect.
            tauri::async_runtime::spawn(async {
                if let Ok(cfg) = setup::get_setup_mode().await {
                    if setup::is_local_server_mode(&cfg.mode) && cfg.lan_enabled.unwrap_or(false) {
                        discovery::start_discovery_responder(3010);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Printer
            printer::connect_printer,
            printer::print_to_network,
            printer::list_system_printers,
            printer::print_to_system_printer,
            // LAN sync
            lan_sync::get_lan_ip,
            lan_sync::get_local_ip,
            lan_sync::start_lan_sync_server,
            lan_sync::broadcast_event,
            lan_sync::send_sync_message,
            // eTIMS / VSCU queue
            vscu::vscu_get_pending_count,
            vscu::vscu_queue_submit,
            vscu::vscu_process_queue,
            // Peripherals
            cash_drawer::open_cash_drawer,
            // Database
            backup::backup_database,
            backup::restore_database,
            backup::list_backups,
            // Setup / mode
            setup::get_setup_mode,
            setup::set_setup_mode,
            setup::reset_setup,
            oauth::oauth_browser_login,
            setup::test_server_connection,
            setup::get_cloud_url,
            // License
            license::get_machine_id,
            // Updating the app (and the offline server inside it)
            app_update::app_version,
            app_update::app_update_check,
            app_update::app_update_install,
            app_update::app_update_status,
            // LAN discovery
            discovery::discover_servers,
            // Local server (this computer's own database + API)
            local_server::local_server_defaults,
            local_server::local_server_validate_folders,
            local_server::local_server_start,
            local_server::local_server_restart,
            local_server::local_server_stop,
            local_server::local_server_set_lan,
            local_server::local_server_status,
            local_server::local_server_backup,
            local_server::local_server_backups,
            local_server::local_server_restore,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Faida POS desktop");

    app.run(|app_handle, event| {
        // Closing the window must not cut the database off mid-write: stop it cleanly (with a backup if the last one is
        // over an hour old) and only then let the app exit.
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            if !SHUTTING_DOWN.swap(true, std::sync::atomic::Ordering::SeqCst) {
                api.prevent_exit();
                let handle = app_handle.clone();
                std::thread::spawn(move || {
                    local_server::shutdown(&handle);
                    handle.exit(0);
                });
            }
        }
    });
}
