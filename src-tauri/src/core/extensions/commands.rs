use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

use crate::core::app::commands::get_app_data_folder_path;
use crate::core::setup;

#[tauri::command]
pub fn get_app_extensions_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    get_app_data_folder_path(app_handle).join("extensions")
}

#[tauri::command]
pub fn install_extensions<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    setup::install_extensions(app, true).map_err(|e| format!("Failed to install extensions: {e}"))
}

#[tauri::command]
pub fn get_active_extensions<R: Runtime>(app: AppHandle<R>) -> Vec<serde_json::Value> {
    {
        let mut path = get_app_extensions_path(app);
        path.push("extensions.json");
        log::info!("get app extensions, path: {path:?}");

        let contents = fs::read_to_string(path);
        let contents: Vec<serde_json::Value> = match contents {
            Ok(data) => match serde_json::from_str::<Vec<serde_json::Value>>(&data) {
                Ok(exts) => exts
                    .into_iter()
                    .map(|ext| {
                        serde_json::json!({
                            "url": ext["url"],
                            "name": ext["name"],
                            "productName": ext["productName"],
                            "active": ext["active"],
                            "description": ext["description"],
                            "version": ext["version"]
                        })
                    })
                    .collect(),
                Err(error) => {
                    log::error!("Failed to parse extensions.json: {error}");
                    vec![]
                }
            },
            Err(error) => {
                log::error!("Failed to read extensions.json: {error}");
                vec![]
            }
        };
        contents
    }
}
