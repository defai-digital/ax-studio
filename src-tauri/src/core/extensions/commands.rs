use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

use crate::core::app::commands::get_app_data_folder_path;
use crate::core::setup;

// ── helpers ────────────────────────────────────────────────────────────────

fn read_manifest(path: &Path) -> Result<Vec<serde_json::Value>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read extensions.json: {e}"))?;
    serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse extensions.json: {e}"))
}

fn write_manifest(path: &Path, manifests: &[serde_json::Value]) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(manifests)
        .map_err(|e| format!("Failed to serialize extensions.json: {e}"))?;
    fs::write(path, serialized)
        .map_err(|e| format!("Failed to write extensions.json: {e}"))
}

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
    let extensions_path = get_app_extensions_path(app.clone());
    let path = extensions_path.join("extensions.json");
    log::info!("get app extensions, path: {path:?}");

    match read_active_extension_manifests(&path, &extensions_path) {
        Ok(exts) => exts,
        Err(error) => {
            log::error!("{error}");
            let backup_path = path.with_extension("json.corrupt");
            if let Err(rename_error) = fs::rename(&path, &backup_path) {
                log::error!("Failed to quarantine corrupted extensions.json: {rename_error}");
            }

            match app.path().resource_dir() {
                Ok(resource_dir) => setup::schedule_extension_install_if_needed(
                    extensions_path,
                    resource_dir.join("resources").join("pre-install"),
                    true,
                ),
                Err(resource_error) => {
                    log::error!("Failed to resolve pre-install extension path: {resource_error}");
                }
            }
            vec![]
        }
    }
}

fn read_active_extension_manifests(
    path: &Path,
    extensions_path: &Path,
) -> Result<Vec<serde_json::Value>, String> {
    let data = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read extensions.json: {error}"))?;

    let exts = serde_json::from_str::<Vec<serde_json::Value>>(&data)
        .map_err(|error| format!("Failed to parse extensions.json: {error}"))?;

    Ok(exts
        .into_iter()
        .map(|ext| {
            let url = safe_relative_extension_url(&ext, extensions_path);

            serde_json::json!({
                "url": url,
                "name": ext["name"],
                "productName": ext["productName"],
                "active": ext["active"],
                "description": ext["description"],
                "version": ext["version"]
            })
        })
        .collect())
}

fn safe_relative_extension_url(ext: &serde_json::Value, extensions_path: &Path) -> String {
    ext["url"]
        .as_str()
        .and_then(|value| Path::new(value).strip_prefix(extensions_path).ok())
        .and_then(|path| {
            let is_safe_relative = path
                .components()
                .all(|component| matches!(component, Component::Normal(_) | Component::CurDir));

            is_safe_relative.then(|| path.to_string_lossy().replace('\\', "/"))
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "index.js".to_string())
}

/// Adds extension manifests to extensions.json.
/// Entries with the same `name` as an already-registered extension are skipped.
/// Returns only the manifests that were actually inserted.
#[tauri::command]
pub fn install_extension<R: Runtime>(
    app: AppHandle<R>,
    extensions: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    if extensions.is_empty() {
        return Ok(vec![]);
    }

    let extensions_path = get_app_extensions_path(app);
    let manifest_path = extensions_path.join("extensions.json");

    let mut existing = read_manifest(&manifest_path)?;

    let mut added: Vec<serde_json::Value> = vec![];
    for ext in extensions {
        let name = ext.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if name.is_empty() {
            log::warn!("install_extension: skipping entry with missing or empty name");
            continue;
        }
        let already_present = existing
            .iter()
            .any(|e| e.get("name").and_then(|v| v.as_str()) == Some(name));
        if !already_present {
            existing.push(ext.clone());
            added.push(ext);
        }
    }

    if !added.is_empty() {
        write_manifest(&manifest_path, &existing)?;
        log::info!("install_extension: registered {} extension(s)", added.len());
    }

    Ok(added)
}

/// Removes extension manifests from extensions.json by name.
/// Returns `true` if at least one entry was removed.
/// The `reload` parameter is accepted for API compatibility but is handled
/// by the frontend — the backend only mutates the manifest file.
#[tauri::command]
pub fn uninstall_extension<R: Runtime>(
    app: AppHandle<R>,
    extensions: Vec<String>,
    _reload: Option<bool>,
) -> Result<bool, String> {
    if extensions.is_empty() {
        return Ok(false);
    }

    let extensions_path = get_app_extensions_path(app);
    let manifest_path = extensions_path.join("extensions.json");

    let mut existing = read_manifest(&manifest_path)?;
    if existing.is_empty() {
        return Ok(false);
    }

    let before = existing.len();
    existing.retain(|e| {
        let name = e.get("name").and_then(|v| v.as_str()).unwrap_or("");
        !extensions.iter().any(|n| n == name)
    });

    let removed = existing.len() < before;
    if removed {
        write_manifest(&manifest_path, &existing)?;
        log::info!(
            "uninstall_extension: removed {} extension(s)",
            before - existing.len()
        );
    }

    Ok(removed)
}
