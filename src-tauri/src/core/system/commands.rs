use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::core::app::commands::{
    default_data_folder_path, get_app_data_folder_path, update_app_configuration,
};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::{stop_mcp_servers_with_context, ShutdownContext};
use crate::core::state::AppState;

fn validate_open_path(path: &PathBuf) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("Path must not be empty".to_string());
    }

    let canonical_path = fs::canonicalize(path).map_err(|e| format!("Invalid path: {e}"))?;
    let home_dir = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let temp_dir = std::env::temp_dir();

    if canonical_path.starts_with(&home_dir) || canonical_path.starts_with(&temp_dir) {
        Ok(canonical_path)
    } else {
        Err(format!(
            "Refusing to open path outside allowed user directories: {}",
            canonical_path.display()
        ))
    }
}

#[tauri::command]
pub fn canonicalize_path(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    // Apply the same allow-list used by the file-explorer opener: only paths
    // under the user's home directory or the system temp directory can be
    // probed. Without this, the command doubled as a filesystem enumeration
    // oracle (e.g. `/etc/passwd` canonicalizes → discloses absolute paths and
    // home-dir usernames).
    let canonical = validate_open_path(&path)?;
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub fn factory_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let windows = app_handle.webview_windows();
    for (label, window) in windows.iter() {
        window.close().unwrap_or_else(|_| {
            log::warn!("Failed to close window: {label:?}");
        });
    }
    let data_folder = get_app_data_folder_path(app_handle.clone());
    log::info!("Factory reset, removing data folder: {data_folder:?}");

    tauri::async_runtime::block_on(async {
        let _ =
            stop_mcp_servers_with_context(&app_handle, &state, ShutdownContext::FactoryReset).await;

        {
            let mut active_servers = state.mcp_active_servers.lock().await;
            active_servers.clear();
        }

        use crate::core::mcp::lockfile::cleanup_own_locks;
        if let Err(e) = cleanup_own_locks(&app_handle) {
            log::warn!("Failed to cleanup lock files: {}", e);
        }
        if data_folder.exists() {
            if let Err(e) = fs::remove_dir_all(&data_folder) {
                let message = format!("Failed to remove data folder: {e}");
                log::error!("{message}");
                return Err(message);
            }
        }

        // Recreate the data folder
        fs::create_dir_all(&data_folder)
            .map_err(|e| format!("Failed to recreate data folder: {e}"))?;

        // Reset the configuration
        let mut default_config = AppConfiguration::default();
        default_config.data_folder = default_data_folder_path(app_handle.clone());
        update_app_configuration(app_handle.clone(), default_config)?;

        app_handle.restart();
        #[allow(unreachable_code)]
        Ok(())
    })
}

#[tauri::command]
pub fn relaunch<R: Runtime>(app: AppHandle<R>) {
    app.restart()
}

#[tauri::command]
pub fn open_file_explorer(path: String) -> Result<(), String> {
    let path = validate_open_path(&PathBuf::from(path))?;
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(path)
            .status()
            .map_err(|e| format!("Failed to open file explorer: {e}"))?;
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg("--")
            .arg(path)
            .status()
            .map_err(|e| format!("Failed to open file explorer: {e}"))?;
    } else {
        std::process::Command::new("xdg-open")
            .arg("--")
            .arg(path)
            .status()
            .map_err(|e| format!("Failed to open file explorer: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn read_logs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let log_path = get_app_data_folder_path(app).join("logs").join("app.log");
    if log_path.exists() {
        let content = fs::read_to_string(log_path).map_err(|e| e.to_string())?;
        Ok(content)
    } else {
        Err("Log file not found".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_open_path_rejects_empty() {
        let result = validate_open_path(&PathBuf::from(""));
        assert!(result.is_err());
    }
}
