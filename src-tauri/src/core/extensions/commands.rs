use std::fs;
use std::path::{Component, Path, PathBuf};
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
    let extensions_path = get_app_extensions_path(app);
    let path = extensions_path.join("extensions.json");
    log::info!("get app extensions, path: {path:?}");

    let contents = fs::read_to_string(path);
    match contents {
        Ok(data) => match serde_json::from_str::<Vec<serde_json::Value>>(&data) {
            Ok(exts) => exts
                .into_iter()
                .map(|ext| {
                    let url = safe_relative_extension_url(&ext, &extensions_path);

                    serde_json::json!({
                        "url": url,
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
    }
}

fn safe_relative_extension_url(ext: &serde_json::Value, extensions_path: &Path) -> String {
    ext["url"]
        .as_str()
        .and_then(|value| Path::new(value).strip_prefix(extensions_path).ok())
        .and_then(|path| {
            let is_safe_relative = path.components().all(|component| {
                matches!(component, Component::Normal(_) | Component::CurDir)
            });

            is_safe_relative.then(|| path.to_string_lossy().replace('\\', "/"))
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "index.js".to_string())
}
