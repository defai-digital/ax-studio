use std::fs;
use tauri::{App, Emitter, Manager, Runtime};

use crate::core::app::commands::get_app_data_folder_path;
use crate::core::mcp::constants::DEFAULT_MCP_CONFIG;
use crate::core::mcp::helpers::run_mcp_commands;
use crate::core::state::McpState;

pub fn setup_mcp<R: Runtime>(app: &App<R>) {
    let state = app.state::<McpState>();
    let servers = state.servers.clone();
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
