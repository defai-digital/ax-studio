use flate2::read::GzDecoder;
use std::{
    fs::{self, File},
    io::Read,
    path::PathBuf,
    sync::Arc,
};
use tar::Archive;
use tauri::{App, Emitter, Manager, RunEvent, Runtime, WindowEvent, Wry};

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_store::{Store, StoreExt};

use crate::core::app::commands::get_app_data_folder_path;
use crate::core::mcp::constants::DEFAULT_MCP_CONFIG;
use crate::core::mcp::helpers::add_server_config;

use super::{
    extensions::commands::get_app_extensions_path, mcp::helpers::run_mcp_commands, state::AppState,
};

pub fn install_extensions<R: Runtime>(app: tauri::AppHandle<R>, force: bool) -> Result<(), String> {
    // Skip extension installation on mobile platforms
    // Mobile uses pre-bundled extensions loaded via MobileCoreService in the frontend
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return Ok(());
    }

    let extensions_path = get_app_extensions_path(app.clone());
    let pre_install_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?
        .join("resources")
        .join("pre-install");

    let mut clean_up = force;

    // Check IS_CLEAN environment variable to optionally skip extension install
    if std::env::var("IS_CLEAN").is_ok() {
        clean_up = true;
    }
    log::info!("Installing extensions. Clean up: {clean_up}");
    if !clean_up && extensions_path.exists() {
        return Ok(());
    }

    // Attempt to remove extensions folder
    if extensions_path.exists() {
        fs::remove_dir_all(&extensions_path).unwrap_or_else(|_| {
            log::info!("Failed to remove existing extensions folder, it may not exist.");
        });
    }

    // Attempt to create it again
    if !extensions_path.exists() {
        fs::create_dir_all(&extensions_path).map_err(|e| e.to_string())?;
    }

    let extensions_json_path = extensions_path.join("extensions.json");
    let mut extensions_list = if extensions_json_path.exists() {
        let existing_data =
            fs::read_to_string(&extensions_json_path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str::<Vec<serde_json::Value>>(&existing_data).unwrap_or_else(|_| vec![])
    } else {
        vec![]
    };

    for entry in fs::read_dir(&pre_install_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().is_some_and(|ext| ext == "tgz") {
            let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
            let gz_decoder = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(gz_decoder);

            let mut extension_name = None;
            let mut extension_manifest = None;
            extract_extension_manifest(&mut archive)
                .map_err(|e| e.to_string())
                .and_then(|manifest| match manifest {
                    Some(manifest) => {
                        extension_name = manifest["name"].as_str().map(|s| s.to_string());
                        extension_manifest = Some(manifest);
                        Ok(())
                    }
                    None => Err("Manifest is None".to_string()),
                })?;

            let extension_name = extension_name.ok_or("package.json not found in archive")?;
            let extension_dir = extensions_path.join(extension_name.clone());
            fs::create_dir_all(&extension_dir).map_err(|e| e.to_string())?;

            let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
            let gz_decoder = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(gz_decoder);
            for entry in archive.entries().map_err(|e| e.to_string())? {
                let mut entry = entry.map_err(|e| e.to_string())?;
                let file_path = entry.path().map_err(|e| e.to_string())?;
                let components: Vec<_> = file_path.components().collect();
                if components.len() > 1 {
                    let relative_path: PathBuf = components[1..].iter().collect();
                    let target_path = extension_dir.join(relative_path);
                    if let Some(parent) = target_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    let _result = entry.unpack(&target_path).map_err(|e| e.to_string())?;
                }
            }

            let main_entry = extension_manifest
                .as_ref()
                .and_then(|manifest| manifest["main"].as_str())
                .unwrap_or("index.js");
            let url = extension_dir.join(main_entry).to_string_lossy().to_string();

            let new_extension = serde_json::json!({
                "url": url,
                "name": extension_name.clone(),
                "origin": extension_dir.to_string_lossy(),
                "active": true,
                "description": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["description"].as_str())
                    .unwrap_or(""),
                "version": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["version"].as_str())
                    .unwrap_or(""),
                "productName": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["productName"].as_str())
                    .unwrap_or(""),
            });

            extensions_list.push(new_extension);

            log::info!("Installed extension to {extension_dir:?}");
        }
    }
    fs::write(
        &extensions_json_path,
        serde_json::to_string_pretty(&extensions_list).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// Migrate MCP servers configuration
pub fn migrate_mcp_servers(
    app_handle: tauri::AppHandle,
    store: Arc<Store<Wry>>,
) -> Result<(), String> {
    let mcp_version = store
        .get("mcp_version")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    if mcp_version < 1 {
        log::info!("Migrating MCP schema version 1");
        let result = add_server_config(
            app_handle.clone(),
            "exa".to_string(),
            serde_json::json!({
                  "command": "npx",
                  "args": ["-y", "exa-mcp-server"],
                  "env": { "EXA_API_KEY": "YOUR_EXA_API_KEY_HERE" },
                  "active": false
            }),
        );
        if let Err(e) = result {
            log::error!("Failed to add server config: {e}");
        }
    }
    if mcp_version < 2 {
        log::info!("Migrating MCP schema version 2: Adding Ax-Studio Browser MCP");
        let result = add_server_config(
            app_handle.clone(),
            "Ax-Studio Browser MCP".to_string(),
            serde_json::json!({
                "command": "npx",
                "args": ["-y", "search-mcp-server@latest"],
                "env": {
                    "BRIDGE_HOST": "127.0.0.1",
                    "BRIDGE_PORT": "17389"
                },
                "active": false,
                "official": true
            }),
        );
        if let Err(e) = result {
            log::error!("Failed to add Ax-Studio Browser MCP server config: {e}");
        }
    }
    if mcp_version < 3 {
        log::info!("Migrating MCP schema version 3: Updating Exa to streamable HTTP");
        if let Err(e) = migrate_exa_to_http(app_handle.clone()) {
            log::error!("Failed to migrate Exa to HTTP: {e}");
        }
    }
    if mcp_version < 4 {
        log::info!("Migrating MCP schema version 4: Adding AX Studio MCP server");
        let mcp_config = resolve_ax_fabric_mcp_config();
        let result = add_server_config(app_handle.clone(), "ax-studio".to_string(), mcp_config);
        if let Err(e) = result {
            log::error!("Failed to add AX Studio MCP server config: {e}");
        }
    }
    if mcp_version < 5 {
        log::info!("Migrating MCP schema version 5: Renaming ax-fabric MCP server to ax-studio");
        if let Err(e) = rename_mcp_server_key(app_handle, "ax-fabric", "ax-studio") {
            log::error!("Failed to rename ax-fabric MCP server config: {e}");
        }
    }
    store.set("mcp_version", 5);
    store.save().expect("Failed to save store");
    Ok(())
}

const AX_STUDIO_MCP_PACKAGE: &str = "@ax-studio/fabric-ingest";

/// Build the default MCP server config for ax-fabric.
/// Uses npx as the default command which will work once the package is
/// published to npm. Users can override the command and path via
/// Settings → MCP Servers in the UI.
fn resolve_ax_fabric_mcp_config() -> serde_json::Value {
    serde_json::json!({
        "command": "npx",
        "args": ["-y", AX_STUDIO_MCP_PACKAGE, "mcp", "server"],
        "env": {},
        "active": false,
        "official": true
    })
}

fn rename_mcp_server_key(
    app_handle: tauri::AppHandle,
    old_key: &str,
    new_key: &str,
) -> Result<(), String> {
    let config_path = get_app_data_folder_path(app_handle).join("mcp_config.json");

    if !config_path.exists() {
        return Ok(());
    }

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        if !servers.contains_key(new_key) {
            if let Some(old_value) = servers.remove(old_key) {
                servers.insert(new_key.to_string(), old_value);
            }
        }
    }

    fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
    )
    .map_err(|e| format!("Failed to write MCP config: {e}"))?;

    Ok(())
}

fn migrate_exa_to_http(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_app_data_folder_path(app_handle).join("mcp_config.json");

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        servers.insert(
            "exa".to_string(),
            serde_json::json!({
                "type": "http",
                "url": "https://mcp.exa.ai/mcp".to_string(),
                "command": "",
                "args": [],
                "env": {},
                "active": true
            }),
        );
    }

    fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
    )
    .map_err(|e| format!("Failed to write MCP config: {e}"))?;

    Ok(())
}

pub fn extract_extension_manifest<R: Read>(
    archive: &mut Archive<R>,
) -> Result<Option<serde_json::Value>, String> {
    let entry = archive
        .entries()
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()) // Ignore errors in individual entries
        .find(|entry| {
            if let Ok(file_path) = entry.path() {
                let path_str = file_path.to_string_lossy();
                path_str == "package/package.json" || path_str == "package.json"
            } else {
                false
            }
        });

    if let Some(mut entry) = entry {
        let mut content = String::new();
        entry
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;

        let package_json: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(Some(package_json));
    }

    Ok(None)
}

pub fn setup_mcp<R: Runtime>(app: &App<R>) {
    let state = app.state::<AppState>();
    let servers = state.mcp_servers.clone();
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        use crate::core::mcp::lockfile::cleanup_all_stale_locks;

        // Create default mcp_config.json if it doesn't exist
        let config_path = get_app_data_folder_path(app_handle.clone()).join("mcp_config.json");
        if !config_path.exists() {
            log::info!("mcp_config.json not found, creating default config");
            if let Err(e) = fs::write(&config_path, DEFAULT_MCP_CONFIG) {
                log::error!("Failed to create default MCP config: {e}");
            }
        }

        if let Err(e) = cleanup_all_stale_locks(&app_handle).await {
            log::debug!("Lock file cleanup error: {}", e);
        }

        if let Err(e) = run_mcp_commands(&app_handle, servers).await {
            log::error!("Failed to run mcp commands: {e}");
        }
        let _ = app_handle.emit("mcp-update", "MCP servers updated");
    });
}

#[cfg(desktop)]
pub fn setup_tray(app: &App) -> tauri::Result<TrayIcon> {
    let show_i = MenuItem::with_id(app.handle(), "open", "Open Ax-Studio", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app.handle(), "quit", "Quit", true, None::<&str>)?;
    let separator_i = PredefinedMenuItem::separator(app.handle())?;
    let menu = Menu::with_items(app.handle(), &[&show_i, &separator_i, &quit_i])?;
    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
            log::warn!("No default window icon configured, using empty icon");
            tauri::image::Image::new(&[], 0, 0)
        }))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                // let's show and focus the main window when the tray is clicked
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {
                log::debug!("unhandled event {event:?}");
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            other => {
                println!("menu item {other} not handled");
            }
        })
        .build(app)
}

pub fn setup_theme_listener<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    // Setup theme listener for main window
    if let Some(window) = app.get_webview_window("main") {
        setup_window_theme_listener(app.handle().clone(), window);
    }

    Ok(())
}

fn setup_window_theme_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) {
    let window_label = window.label().to_string();
    let app_handle_clone = app_handle.clone();

    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let theme_str = match theme {
                tauri::Theme::Light => "light",
                tauri::Theme::Dark => "dark",
                _ => "auto",
            };
            log::info!("System theme changed to: {theme_str} for window: {window_label}");
            let _ = app_handle_clone.emit("theme-changed", theme_str);
        }
    });
}

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
    let store = app.handle().store(store_path).expect("Store not initialized");
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
    store.save().expect("Failed to save store");

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

/// Tauri `.run()` event handler — handles app lifecycle events.
pub fn app_run_handler(app: &tauri::AppHandle, event: RunEvent) {
    if let RunEvent::Exit = event {
        let app_handle = app.clone();
        #[cfg(not(any(target_os = "ios", target_os = "android")))]
        {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.emit("app-shutting-down", ());
                let _ = window.hide();
            }
        }
        let state = app_handle.state::<super::state::AppState>();
        let cleanup_already_running = tokio::task::block_in_place(|| {
            tauri::async_runtime::block_on(async {
                let handle = state.background_cleanup_handle.lock().await;
                handle.is_some()
            })
        });
        if cleanup_already_running {
            return;
        }
        tokio::task::block_in_place(|| {
            tauri::async_runtime::block_on(async {
                use crate::core::mcp::helpers::background_cleanup_mcp_servers;
                let state = app_handle.state::<super::state::AppState>();
                let cleanup_future = background_cleanup_mcp_servers(&app_handle, &state);
                match tokio::time::timeout(
                    tokio::time::Duration::from_secs(10),
                    cleanup_future,
                )
                .await
                {
                    Ok(_) => log::info!("MCP cleanup completed successfully"),
                    Err(_) => log::warn!("MCP cleanup timed out after 10 seconds"),
                }
                #[cfg(not(any(target_os = "ios", target_os = "android")))]
                {
                    let _ =
                        tauri_plugin_llamacpp::cleanup_llama_processes(app_handle.clone()).await;
                    log::info!("llama.cpp process cleanup completed");
                }
                log::info!("App cleanup completed");
            });
        });
    }
}
