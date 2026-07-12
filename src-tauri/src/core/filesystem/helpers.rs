use crate::core::app::commands::get_app_data_folder_path;
use ax_studio_utils::{normalize_file_path, normalize_path};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use tauri::Runtime;

const MAX_FILESYSTEM_PATH_BYTES: usize = 4 * 1024;

fn normalize_with_existing_ancestor(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return normalize_path(&canonical);
    }

    let mut missing_components: Vec<OsString> = Vec::new();
    let mut current = path;
    loop {
        if let Ok(canonical) = current.canonicalize() {
            let mut resolved = canonical;
            for component in missing_components.iter().rev() {
                resolved.push(component);
            }
            return normalize_path(&resolved);
        }

        if let Some(file_name) = current.file_name() {
            missing_components.push(file_name.to_os_string());
        }
        match current.parent() {
            Some(parent) if parent != current => current = parent,
            _ => return normalize_path(path),
        }
    }
}

pub fn resolve_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    path: &str,
) -> Result<PathBuf, String> {
    if path.is_empty()
        || path.len() > MAX_FILESYSTEM_PATH_BYTES
        || path.chars().any(char::is_control)
    {
        return Err(format!(
            "Filesystem path must contain between 1 and {MAX_FILESYSTEM_PATH_BYTES} non-control bytes"
        ));
    }

    // Network URLs are never filesystem paths. The previous passthrough let
    // mutating commands interpret `https://...` as a relative local path and
    // write outside the app-data boundary.
    if path.starts_with("http://") || path.starts_with("https://") {
        return Err("Network URLs are not valid filesystem paths".to_string());
    }

    let app_data_folder = get_app_data_folder_path(app_handle.clone());
    let canonical_app_data = normalize_path(
        &app_data_folder
            .canonicalize()
            .unwrap_or_else(|_| app_data_folder.clone()),
    );
    let path = if path.starts_with("file:/") || path.starts_with("file:\\") {
        let normalized = normalize_file_path(path);
        let relative_normalized = normalized
            .trim_start_matches(std::path::MAIN_SEPARATOR)
            .trim_start_matches('/')
            .trim_start_matches('\\');
        app_data_folder.join(relative_normalized)
    } else {
        PathBuf::from(path)
    };

    // Resolve the deepest existing ancestor, not only the immediate parent.
    // This closes escapes such as app-data/link/missing/file where `link` is a
    // symlink and the immediate parent does not exist yet.
    let resolved = normalize_with_existing_ancestor(&path);

    // Security: ensure resolved path is within the app data folder
    // This check must be done after canonicalize to close symlink TOCTOU
    if !resolved.starts_with(&canonical_app_data) {
        let message = format!(
            "Path traversal blocked: {} is outside app data folder {}",
            resolved.display(),
            canonical_app_data.display()
        );
        log::warn!("{message}");
        return Err(message);
    }

    Ok(resolved)
}
