mod commands;
mod core;

use core::{
    downloads::models::DownloadManagerState, mcp::models::McpSettings, setup, state::AppState,
};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    if let Err(error) = core::mlx::runtime::configure_bundled_metallib() {
        eprintln!("Failed to configure bundled MLX runtime: {error}");
        return;
    }

    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        |app, argv, _cwd| {
            log::info!(
                "A new app instance was opened with {argv:?} and the deep link event was already triggered"
            );
            // Windows "Open with" on a running instance delivers the target
            // files via argv — forward them like a macOS Dock drop.
            let paths = core::open_files::extract_file_paths_from_argv(&argv);
            core::open_files::handle_opened_paths(app, paths);
        },
    ));

    let mut app_builder = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(all(feature = "deep-link", desktop))]
    {
        app_builder = app_builder.plugin(tauri_plugin_deep_link::init());
    }
    #[cfg(desktop)]
    {
        app_builder = app_builder.plugin(tauri_plugin_hardware::init());
        app_builder = app_builder.plugin(tauri_plugin_llamacpp::init());
        app_builder = app_builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(core::global_shortcut::handle_shortcut)
                .build(),
        );
    }

    let app_builder = app_builder.invoke_handler(commands::desktop_handlers!());

    let app_builder = app_builder.manage(AppState {
        mcp_servers: Arc::new(Mutex::new(HashMap::new())),
        download_manager: Arc::new(Mutex::new(DownloadManagerState::default())),
        mcp_active_servers: Arc::new(Mutex::new(HashMap::new())),
        server_handle: Arc::new(Mutex::new(None)),
        tool_call_cancellations: Arc::new(Mutex::new(HashMap::new())),
        akidb_sync_cancellation: Arc::new(Mutex::new(None)),
        mcp_settings: Arc::new(Mutex::new(McpSettings::default())),
        mcp_shutdown_in_progress: Arc::new(Mutex::new(false)),
        mcp_monitoring_tasks: Arc::new(Mutex::new(HashMap::new())),
        background_cleanup_handle: Arc::new(Mutex::new(None)),
        mcp_server_pids: Arc::new(Mutex::new(HashMap::new())),
        provider_state: Arc::new(Mutex::new(crate::core::state::ProviderState::default())),
        approved_save_paths: Arc::new(Mutex::new(std::collections::HashSet::new())),
        approved_read_files: Arc::new(Mutex::new(std::collections::HashSet::new())),
        approved_read_directories: Arc::new(Mutex::new(std::collections::HashSet::new())),
        factory_reset_lock: Arc::new(Mutex::new(())),
        active_streams: Arc::new(Mutex::new(HashMap::new())),
        pending_open_files: Arc::new(crate::core::open_files::PendingOpenFiles::default()),
    });

    // Voice input state (worker thread owning cpal capture + whisper context,
    // spawned lazily on first voice command).
    let app_builder = app_builder.manage(crate::core::voice::state::VoiceState::default());

    // In-process MLX state (worker thread holding ax-engine-sdk EngineSessions).
    // macOS-only — `ax-engine-mlx` doesn't build on other platforms.
    #[cfg(target_os = "macos")]
    let app_builder = app_builder.manage(crate::core::mlx::state::MlxState::new());

    let app = app_builder
        .setup(setup::app_setup)
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(err) => {
            log::error!("Failed to build Tauri application: {err}");
            return;
        }
    };

    app.run(setup::app_run_handler);
}
