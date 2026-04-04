mod extensions;
mod lifecycle;
mod mcp_bootstrap;
mod store_migration;
mod tray;

pub use extensions::{extract_extension_manifest, install_extensions};
pub use lifecycle::{app_run_handler, setup_theme_listener};
pub use mcp_bootstrap::setup_mcp;
pub use store_migration::migrate_mcp_servers;

#[cfg(desktop)]
pub use tray::setup_tray;

use tauri::{App, Manager};
use tauri_plugin_store::StoreExt;

use crate::core::app::commands::get_app_data_folder_path;

/// Tauri `.setup()` callback — runs once after the app is built.
pub fn app_setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    app.handle().plugin(
        tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Debug)
            .targets([
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                    path: get_app_data_folder_path(app.handle().clone()).join("logs"),
                    file_name: Some("app".to_string()),
                }),
            ])
            .build(),
    )?;
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;

    let mut store_path = get_app_data_folder_path(app.handle().clone());
    store_path.push("store.json");
    let store = app.handle().store(store_path)?;
    let stored_version = store
        .get("version")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    let app_version = app.config().version.clone().unwrap_or_default();
    if let Err(e) = install_extensions(app.handle().clone(), stored_version != app_version) {
        log::error!("Failed to install extensions: {e}");
    }
    if let Err(e) = migrate_mcp_servers(app.handle().clone(), store.clone()) {
        log::error!("Failed to migrate MCP servers: {e}");
    }
    store.set("version", serde_json::json!(app_version));
    store.save()?;

    #[cfg(desktop)]
    if option_env!("ENABLE_SYSTEM_TRAY_ICON").unwrap_or("false") == "true" {
        log::info!("Enabling system tray icon");
        let _ = setup_tray(app);
    }
    #[cfg(all(feature = "deep-link", any(windows, target_os = "linux")))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link().register_all()?;
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::core::threads::db::init_database(&app_handle).await {
                log::error!("Failed to initialize mobile database: {}", e);
            }
        });
    }

    setup_mcp(app);
    setup_theme_listener(app)?;
    Ok(())
}
