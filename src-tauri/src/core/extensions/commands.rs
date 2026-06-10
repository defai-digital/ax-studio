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

#[cfg(test)]
mod tests {
    //! Unit tests for the extensions manifest manager.
    //!
    //! These only exercise the *file-level* helpers (`read_manifest`,
    //! `write_manifest`, `read_active_extension_manifests`, and the
    //! security-critical `safe_relative_extension_url`). The five Tauri
    //! commands themselves are thin wrappers over these helpers + an
    //! `AppHandle` lookup — testing the helpers exhaustively covers the
    //! behavior that matters.
    //!
    //! Tests are gated by `#[cfg(test)]` so this module compiles to nothing
    //! in `dev`/`release` builds. They have no effect on the shipped app.

    use super::*;
    use serde_json::json;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Create a unique temp dir per test so parallel test runs don't collide.
    /// Combines the test name with a process-unique counter + nanos timestamp.
    /// Cleanup is on-Drop via the returned guard.
    fn unique_temp_dir(name: &str) -> TempPath {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let count = COUNTER.fetch_add(1, Ordering::SeqCst);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir()
            .join(format!("ax_studio_ext_test_{name}_{count}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        TempPath { path: dir }
    }

    /// RAII guard that removes the temp dir when dropped.
    struct TempPath {
        path: PathBuf,
    }
    impl TempPath {
        fn path(&self) -> &Path {
            &self.path
        }
    }
    impl Drop for TempPath {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    // ── safe_relative_extension_url ──────────────────────────────────────
    // Security-critical: this is the function that prevents an extension
    // manifest from pointing at arbitrary files outside the extensions dir.

    #[test]
    fn safe_url_returns_relative_path_for_valid_url_inside_dir() {
        let tmp = unique_temp_dir("safe_valid");
        let ext_dir = tmp.path();
        let url = ext_dir.join("foo").join("index.js").to_string_lossy().to_string();
        let ext = json!({ "url": url });
        assert_eq!(safe_relative_extension_url(&ext, ext_dir), "foo/index.js");
    }

    #[test]
    fn safe_url_returns_nested_subdir_path() {
        let tmp = unique_temp_dir("safe_nested");
        let ext_dir = tmp.path();
        let url = ext_dir
            .join("my-ext")
            .join("dist")
            .join("index.js")
            .to_string_lossy()
            .to_string();
        let ext = json!({ "url": url });
        assert_eq!(
            safe_relative_extension_url(&ext, ext_dir),
            "my-ext/dist/index.js"
        );
    }

    #[test]
    fn safe_url_falls_back_when_url_outside_extensions_dir() {
        let tmp = unique_temp_dir("safe_outside");
        let ext_dir = tmp.path();
        // URL points to a completely different absolute path → strip_prefix fails
        // → fallback to "index.js" instead of leaking the absolute path.
        let ext = json!({ "url": "/etc/passwd" });
        assert_eq!(safe_relative_extension_url(&ext, ext_dir), "index.js");
    }

    #[test]
    fn safe_url_falls_back_when_url_field_missing() {
        let tmp = unique_temp_dir("safe_missing_url");
        let ext = json!({ "name": "no-url-ext" });
        assert_eq!(safe_relative_extension_url(&ext, tmp.path()), "index.js");
    }

    #[test]
    fn safe_url_falls_back_when_url_empty_string() {
        let tmp = unique_temp_dir("safe_empty_url");
        let ext = json!({ "url": "" });
        assert_eq!(safe_relative_extension_url(&ext, tmp.path()), "index.js");
    }

    #[test]
    fn safe_url_falls_back_when_url_is_not_a_string() {
        let tmp = unique_temp_dir("safe_non_string");
        let ext = json!({ "url": 42 });
        assert_eq!(safe_relative_extension_url(&ext, tmp.path()), "index.js");
    }

    #[test]
    fn safe_url_rejects_parent_dir_components() {
        let tmp = unique_temp_dir("safe_dotdot");
        let ext_dir = tmp.path();
        // Even if strip_prefix succeeds on a literal-prefix match, the
        // resulting relative path contains a `..` component, which the
        // safety filter rejects → fallback to "index.js".
        let url = ext_dir
            .join("ext")
            .join("..")
            .join("..")
            .join("evil.js")
            .to_string_lossy()
            .to_string();
        let ext = json!({ "url": url });
        // Either the url didn't strip-prefix cleanly (fallback) OR the
        // safety filter caught the .. component (fallback). Both cases
        // produce "index.js".
        assert_eq!(safe_relative_extension_url(&ext, ext_dir), "index.js");
    }

    // ── read_manifest ────────────────────────────────────────────────────

    #[test]
    fn read_manifest_returns_empty_vec_when_file_missing() {
        let tmp = unique_temp_dir("read_missing");
        let path = tmp.path().join("does-not-exist.json");
        let result = read_manifest(&path).expect("missing file should be Ok(empty)");
        assert!(result.is_empty());
    }

    #[test]
    fn read_manifest_parses_valid_json_array() {
        let tmp = unique_temp_dir("read_valid");
        let path = tmp.path().join("extensions.json");
        fs::write(
            &path,
            r#"[{"name":"ext-a","version":"1.0"},{"name":"ext-b","version":"2.0"}]"#,
        )
        .unwrap();
        let result = read_manifest(&path).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0]["name"], "ext-a");
        assert_eq!(result[1]["version"], "2.0");
    }

    #[test]
    fn read_manifest_errors_on_malformed_json() {
        let tmp = unique_temp_dir("read_malformed");
        let path = tmp.path().join("extensions.json");
        fs::write(&path, "this is not json at all").unwrap();
        let err = read_manifest(&path).expect_err("malformed JSON must error");
        assert!(
            err.contains("Failed to parse"),
            "error should explain parse failure, got: {err}"
        );
    }

    // ── write_manifest ───────────────────────────────────────────────────

    #[test]
    fn write_manifest_round_trips_through_read_manifest() {
        let tmp = unique_temp_dir("write_round_trip");
        let path = tmp.path().join("extensions.json");
        let input = vec![
            json!({ "name": "ext-a", "url": "ext-a/index.js", "active": true }),
            json!({ "name": "ext-b", "url": "ext-b/index.js", "active": false }),
        ];
        write_manifest(&path, &input).unwrap();
        let read_back = read_manifest(&path).unwrap();
        assert_eq!(read_back.len(), 2);
        assert_eq!(read_back[0]["name"], "ext-a");
        assert_eq!(read_back[0]["active"], true);
        assert_eq!(read_back[1]["name"], "ext-b");
        assert_eq!(read_back[1]["active"], false);
    }

    #[test]
    fn write_manifest_produces_pretty_json() {
        let tmp = unique_temp_dir("write_pretty");
        let path = tmp.path().join("extensions.json");
        write_manifest(&path, &[json!({ "name": "ext" })]).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        // Pretty-printed JSON contains newlines + 2-space indentation
        assert!(raw.contains('\n'), "expected newlines in pretty JSON");
        assert!(raw.contains("  "), "expected 2-space indentation");
    }

    // ── read_active_extension_manifests ──────────────────────────────────

    #[test]
    fn read_active_extensions_maps_to_expected_shape() {
        let tmp = unique_temp_dir("active_shape");
        let ext_dir = tmp.path();
        let path = ext_dir.join("extensions.json");
        let url_in = ext_dir.join("foo").join("index.js").to_string_lossy().to_string();
        let manifest = json!([{
            "name": "foo-ext",
            "productName": "Foo Extension",
            "active": true,
            "description": "A test extension",
            "version": "1.0.0",
            "url": url_in
        }]);
        fs::write(&path, serde_json::to_string(&manifest).unwrap()).unwrap();

        let result = read_active_extension_manifests(&path, ext_dir).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["name"], "foo-ext");
        assert_eq!(result[0]["productName"], "Foo Extension");
        assert_eq!(result[0]["active"], true);
        assert_eq!(result[0]["description"], "A test extension");
        assert_eq!(result[0]["version"], "1.0.0");
        // Absolute URL converted to safe relative path
        assert_eq!(result[0]["url"], "foo/index.js");
    }

    #[test]
    fn read_active_extensions_falls_back_when_url_missing() {
        let tmp = unique_temp_dir("active_no_url");
        let ext_dir = tmp.path();
        let path = ext_dir.join("extensions.json");
        fs::write(&path, r#"[{"name":"no-url"}]"#).unwrap();

        let result = read_active_extension_manifests(&path, ext_dir).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["url"], "index.js");
    }

    #[test]
    fn read_active_extensions_errors_on_malformed_json() {
        let tmp = unique_temp_dir("active_bad_json");
        let ext_dir = tmp.path();
        let path = ext_dir.join("extensions.json");
        fs::write(&path, "definitely not json").unwrap();
        let err = read_active_extension_manifests(&path, ext_dir)
            .expect_err("malformed JSON must error");
        assert!(err.contains("Failed to parse"));
    }

    #[test]
    fn read_active_extensions_errors_on_missing_file() {
        let tmp = unique_temp_dir("active_no_file");
        let ext_dir = tmp.path();
        let path = ext_dir.join("does-not-exist.json");
        let err = read_active_extension_manifests(&path, ext_dir)
            .expect_err("missing file must error (only read_manifest tolerates this)");
        assert!(err.contains("Failed to read"));
    }
}
