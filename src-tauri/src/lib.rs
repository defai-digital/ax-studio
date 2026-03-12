mod commands;
mod core;

use ax_studio_utils::generate_app_token;
use core::{
    downloads::models::DownloadManagerState,
    mcp::models::McpSettings,
    setup,
    state::AppState,
};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

#[cfg_attr(
    all(mobile, any(target_os = "android", target_os = "ios")),
    tauri::mobile_entry_point
)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            println!("a new app instance was opened with {argv:?} and the deep link event was already triggered");
        }));
    }

    let mut app_builder = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init());

    #[cfg(feature = "deep-link")]
    { app_builder = app_builder.plugin(tauri_plugin_deep_link::init()); }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    { app_builder = app_builder.plugin(tauri_plugin_hardware::init()); }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    { app_builder = app_builder.plugin(tauri_plugin_llamacpp::init()); }

    // Desktop: include updater commands
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let app_builder =
        app_builder.invoke_handler(commands::desktop_handlers!());

    // Mobile: no updater commands
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let app_builder =
        app_builder.invoke_handler(commands::mobile_handlers!());

    let app = app_builder
        .manage(AppState {
            app_token: Some(generate_app_token()),
            mcp_servers: Arc::new(Mutex::new(HashMap::new())),
            download_manager: Arc::new(Mutex::new(DownloadManagerState::default())),
            mcp_active_servers: Arc::new(Mutex::new(HashMap::new())),
            server_handle: Arc::new(Mutex::new(None)),
            tool_call_cancellations: Arc::new(Mutex::new(HashMap::new())),
            mcp_settings: Arc::new(Mutex::new(McpSettings::default())),
            mcp_shutdown_in_progress: Arc::new(Mutex::new(false)),
            mcp_monitoring_tasks: Arc::new(Mutex::new(HashMap::new())),
            background_cleanup_handle: Arc::new(Mutex::new(None)),
            mcp_server_pids: Arc::new(Mutex::new(HashMap::new())),
            provider_configs: Arc::new(Mutex::new(HashMap::new())),
            approved_save_paths: Arc::new(Mutex::new(std::collections::HashSet::new())),
        })
        .setup(|app| Ok(setup::app_setup(app)?))
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(setup::app_run_handler);
}
