use crate::core::app::commands::get_app_data_folder_path;
use ax_studio_utils::{normalize_file_path, normalize_path};
use std::path::PathBuf;
use tauri::Runtime;

pub fn resolve_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    path: &str,
) -> Result<PathBuf, String> {
    // Allow HTTP/HTTPS URLs to pass through unchanged. These are not local
    // filesystem paths and shouldn't be subject to the path-traversal check
    // that follows; otherwise model downloads from remote URLs are blocked.
    if path.starts_with("http://") || path.starts_with("https://") {
        return Ok(PathBuf::from(path));
    }

    let app_data_folder = get_app_data_folder_path(app_handle.clone());
    let canonical_app_data = app_data_folder
        .canonicalize()
        .unwrap_or_else(|_| normalize_path(&app_data_folder));
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

    // Prefer canonical paths when possible, but keep validation robust when path does not
    // exist yet by normalizing parent components.
    let resolved = path.canonicalize().unwrap_or_else(|_| {
        if let Some(parent) = path.parent() {
            if let Ok(canonical_parent) = parent.canonicalize() {
                if let Some(file_name) = path.file_name() {
                    return canonical_parent.join(file_name);
                }
            }
        }
        normalize_path(&path)
    });

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
