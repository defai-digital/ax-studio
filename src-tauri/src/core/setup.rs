use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    thread::JoinHandle,
    time::Duration,
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

// Hash table is generated at build time from the actual pre-install/ tgz files
// by build.rs — no manual updates needed when extensions are rebuilt.
include!(concat!(env!("OUT_DIR"), "/extension_hashes.rs"));

fn bundled_extension_stamp() -> String {
    BUNDLED_EXTENSION_ARCHIVE_SHA256
        .iter()
        .map(|(name, hash)| format!("{name}:{hash}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn bundled_extensions_ready(extensions_path: &Path) -> bool {
    if !extensions_path.join("extensions.json").is_file() {
        return false;
    }

    let expected_stamp = bundled_extension_stamp();
    let installed_stamp =
        fs::read_to_string(extensions_path.join(".bundle-stamp")).unwrap_or_default();

    installed_stamp == expected_stamp
}

/// JoinHandle for the background bundled-extension install thread.
/// Tracked so shutdown can wait for an in-flight install instead of
/// tearing down the process mid-write.
static EXTENSION_INSTALL_HANDLE: OnceLock<Mutex<Option<JoinHandle<()>>>> = OnceLock::new();

fn extension_install_slot() -> &'static Mutex<Option<JoinHandle<()>>> {
    EXTENSION_INSTALL_HANDLE.get_or_init(|| Mutex::new(None))
}

/// Wait up to `timeout` for a background extension install to finish.
pub fn join_extension_install(timeout: Duration) {
    let handle = {
        let mut guard = extension_install_slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.take()
    };
    let Some(handle) = handle else {
        return;
    };
    if handle.is_finished() {
        let _ = handle.join();
        return;
    }
    // Join on a helper so we can enforce a timeout without blocking forever.
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = handle.join();
        let _ = tx.send(result);
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(())) => log::info!("Bundled extension install joined cleanly on shutdown"),
        Ok(Err(_)) => log::warn!("Bundled extension install thread panicked"),
        Err(_) => log::warn!(
            "Bundled extension install still running after {}s; continuing shutdown",
            timeout.as_secs()
        ),
    }
}

pub fn schedule_extension_install_if_needed(
    extensions_path: PathBuf,
    pre_install_path: PathBuf,
    force: bool,
) {
    if !force && bundled_extensions_ready(&extensions_path) {
        return;
    }

    log::info!("Scheduling bundled extension install. Force: {force}");
    let handle = std::thread::spawn(move || {
        match install_extensions_from_paths(extensions_path, pre_install_path, force) {
            Ok(()) => {
                log::info!("Bundled extension install finished");
            }
            Err(error) => {
                log::error!("Failed to install bundled extensions in background: {error}");
            }
        }
    });
    let mut slot = extension_install_slot()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // Join any previous install before overwriting the handle so we never
    // abandon an in-flight install thread without tracking it.
    if let Some(previous) = slot.take() {
        if !previous.is_finished() {
            log::info!("Waiting for previous bundled extension install to finish");
        }
        let _ = previous.join();
    }
    *slot = Some(handle);
}

fn expected_extension_archive_hash(path: &Path) -> Option<&'static str> {
    let filename = path.file_name()?.to_str()?;
    BUNDLED_EXTENSION_ARCHIVE_SHA256
        .iter()
        .find_map(|(name, hash)| (*name == filename).then_some(*hash))
}

fn compute_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|e| format!("Failed to open extension archive for hashing: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read extension archive for hashing: {e}"))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hex::encode(hasher.finalize()))
}

fn verify_extension_archive_integrity(path: &Path) -> Result<(), String> {
    let expected_hash = expected_extension_archive_hash(path).ok_or_else(|| {
        format!(
            "No expected SHA-256 registered for bundled extension archive: {}",
            path.display()
        )
    })?;
    let actual_hash = compute_sha256(path)?;

    if actual_hash != expected_hash {
        return Err(format!(
            "Extension archive integrity check failed for {}: expected {}, got {}",
            path.display(),
            expected_hash,
            actual_hash
        ));
    }

    Ok(())
}

pub fn install_extensions<R: Runtime>(app: tauri::AppHandle<R>, force: bool) -> Result<(), String> {
    let extensions_path = get_app_extensions_path(app.clone());
    let pre_install_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?
        .join("resources")
        .join("pre-install");

    install_extensions_from_paths(extensions_path, pre_install_path, force)
}

fn install_extensions_from_paths(
    extensions_path: PathBuf,
    pre_install_path: PathBuf,
    force: bool,
) -> Result<(), String> {
    let mut clean_up = force;

    // Check IS_CLEAN environment variable to optionally skip extension install
    if std::env::var("IS_CLEAN").is_ok() {
        clean_up = true;
    }
    log::info!("Installing extensions. Clean up: {clean_up}");
    if !clean_up && extensions_path.exists() {
        let stamp_path = extensions_path.join(".bundle-stamp");
        let expected_stamp = bundled_extension_stamp();
        let installed_stamp = fs::read_to_string(&stamp_path).unwrap_or_default();

        if installed_stamp == expected_stamp {
            return Ok(());
        }

        log::info!("Bundled extension archives changed. Reinstalling bundled extensions.");
    }

    let staging_path = extensions_path.with_extension("staging");
    if staging_path.exists() {
        fs::remove_dir_all(&staging_path)
            .map_err(|e| format!("Failed to clear extension staging directory: {e}"))?;
    }

    if !pre_install_path.exists() {
        return Ok(());
    }

    fs::create_dir_all(&staging_path).map_err(|e| e.to_string())?;

    let extensions_json_path = staging_path.join("extensions.json");
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
            verify_extension_archive_integrity(&path)?;

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
            let extension_dir = staging_path.join(extension_name.clone());
            if !Path::new(&extension_name)
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
                || !extension_dir.starts_with(&staging_path)
            {
                return Err(format!(
                    "Blocked unsafe extension package name: {}",
                    extension_name
                ));
            }
            fs::create_dir_all(&extension_dir).map_err(|e| e.to_string())?;

            let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
            let gz_decoder = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(gz_decoder);
            for entry in archive.entries().map_err(|e| e.to_string())? {
                let mut entry = entry.map_err(|e| e.to_string())?;

                // Reject symlink / hardlink entries — a symlink followed by a
                // file entry through that link is a classic archive extraction
                // escape (lexical path checks still pass, but the actual write
                // lands outside `extension_dir`).
                let entry_type = entry.header().entry_type();
                if entry_type.is_symlink() || entry_type.is_hard_link() {
                    log::warn!(
                        "Rejecting symlink/hardlink entry in extension archive: {}",
                        entry
                            .path()
                            .map(|p| p.display().to_string())
                            .unwrap_or_default()
                    );
                    continue;
                }

                let file_path = entry.path().map_err(|e| e.to_string())?;
                let mut components = file_path.components();
                let _package_root = components.next();
                let mut relative_path = PathBuf::new();

                for component in components {
                    match component {
                        Component::Normal(part) => relative_path.push(part),
                        Component::CurDir => {}
                        _ => {
                            return Err(format!(
                                "Blocked extension archive path traversal: {}",
                                file_path.display()
                            ));
                        }
                    }
                }

                if !relative_path.as_os_str().is_empty() {
                    let target_path = extension_dir.join(relative_path);
                    if !target_path.starts_with(&extension_dir) {
                        return Err(format!(
                            "Blocked extension archive path traversal: {}",
                            file_path.display()
                        ));
                    }
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
            // Build the URL/origin against the FINAL extensions path, not the
            // staging path. The staging directory is renamed to `extensions/`
            // at the end of this function (line ~172), so URLs that reference
            // `extensions.staging/...` would point at a path that no longer
            // exists. The frontend would then fail to load the extension and
            // every conversational/persistence call throws "Conversational
            // extension not available".
            let final_extension_dir = extensions_path.join(extension_name.clone());
            let url = final_extension_dir
                .join(main_entry)
                .to_string_lossy()
                .to_string();

            let new_extension = serde_json::json!({
                "url": url,
                "name": extension_name.clone(),
                "origin": final_extension_dir.to_string_lossy(),
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

            extensions_list.retain(|extension| {
                extension.get("name").and_then(|name| name.as_str())
                    != Some(extension_name.as_str())
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

    if extensions_path.exists() {
        let old_path = extensions_path.with_extension("old");
        // Rename existing dir out of the way first (atomic on same filesystem)
        if let Err(e) = fs::rename(&extensions_path, &old_path) {
            log::warn!("Could not rename old extensions dir: {e}, attempting remove_dir_all");
            fs::remove_dir_all(&extensions_path)
                .map_err(|e| format!("Failed to remove existing extensions directory: {e}"))?;
        }
        // Promote staged extensions
        fs::rename(&staging_path, &extensions_path)
            .map_err(|e| format!("Failed to promote staged extensions: {e}"))?;
        // Clean up old dir after successful swap
        let _ = fs::remove_dir_all(&old_path);
    } else {
        fs::rename(&staging_path, &extensions_path)
            .map_err(|e| format!("Failed to promote staged extensions: {e}"))?;
    }

    fs::write(
        extensions_path.join(".bundle-stamp"),
        bundled_extension_stamp(),
    )
    .map_err(|e| format!("Failed to write bundled extension stamp: {e}"))?;

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
                  "env": {},
                  "active": false
            }),
        );
        if let Err(e) = result {
            log::error!("Failed to add server config: {e}");
        }
    }
    // Migration version 2 was Browser MCP (removed)
    if mcp_version < 3 {
        log::info!("Migrating MCP schema version 3: Updating Exa to streamable HTTP");
        if let Err(e) = migrate_exa_to_http(app_handle.clone()) {
            log::error!("Failed to migrate Exa to HTTP: {e}");
        }
    }
    if mcp_version < 5 {
        log::info!("Migrating MCP schema version 5: Renaming ax-fabric MCP server to ax-studio");
        if let Err(e) = rename_mcp_server_key(app_handle.clone(), "ax-fabric", "ax-studio") {
            log::error!("Failed to rename ax-fabric MCP server config: {e}");
        }
    }
    if mcp_version < 6 {
        log::info!(
            "Migrating MCP schema version 6: Removing deprecated integration-github MCP server"
        );
        if let Err(e) = remove_mcp_server_keys(app_handle.clone(), &["integration-github"]) {
            log::error!("Failed to remove integration-github: {e}");
        }
    }
    if mcp_version < 7 {
        log::info!("Migrating MCP schema version 7: Adding --experimental-sqlite flag to ax-studio MCP server");
        if let Err(e) = patch_ax_studio_sqlite_flag(app_handle.clone()) {
            log::error!("Failed to patch ax-studio sqlite flag: {e}");
        }
    }
    if mcp_version < 8 {
        log::info!("Migrating MCP schema version 8: Removing unpublished AX Studio npm preset");
        remove_unpublished_ax_studio_mcp_config(app_handle)
            .map_err(|e| format!("Failed to remove unpublished AX Studio MCP preset: {e}"))?;
    }
    store.set("mcp_version", 8);
    store
        .save()
        .map_err(|e| format!("Failed to save store during MCP migration: {e}"))?;
    Ok(())
}

const UNPUBLISHED_AX_STUDIO_MCP_PACKAGE: &str = "@ax-fabric/fabric-ingest";

// Migration tests are colocated with the migration definitions; setup/runtime
// wiring follows below and intentionally remains separate from migration logic.
#[allow(clippy::items_after_test_module)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unpublished_ax_studio_preset_detection_is_selective() {
        let unsafe_preset = serde_json::json!({
            "command": "npx",
            "args": ["-y", UNPUBLISHED_AX_STUDIO_MCP_PACKAGE, "mcp", "server"]
        });
        let local_source = serde_json::json!({
            "command": "node",
            "args": ["/opt/ax-fabric/cli.js", "mcp", "server"]
        });

        assert!(is_unpublished_ax_studio_mcp_preset(&unsafe_preset));
        assert!(!is_unpublished_ax_studio_mcp_preset(&local_source));
    }

    #[test]
    fn test_extract_extension_manifest_none_on_empty_archive() {
        use std::io::Cursor;
        use tar::Builder;

        // Create an empty tar archive
        let mut buf = Vec::new();
        {
            let mut builder = Builder::new(&mut buf);
            builder
                .finish()
                .expect("archive builder finish should not fail in test");
        }

        let cursor = Cursor::new(buf);
        let mut archive = tar::Archive::new(cursor);
        let result = extract_extension_manifest(&mut archive).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_bundled_extensions_ready_requires_manifest_and_current_stamp() {
        let extensions_path = std::env::temp_dir().join(format!(
            "ax-studio-extension-ready-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&extensions_path);
        fs::create_dir_all(&extensions_path).expect("temp dir should be created");

        assert!(!bundled_extensions_ready(&extensions_path));

        fs::write(extensions_path.join("extensions.json"), "[]")
            .expect("extensions manifest should be written");
        assert!(!bundled_extensions_ready(&extensions_path));

        fs::write(
            extensions_path.join(".bundle-stamp"),
            bundled_extension_stamp(),
        )
        .expect("bundle stamp should be written");
        assert!(bundled_extensions_ready(&extensions_path));

        let _ = fs::remove_dir_all(&extensions_path);
    }

    #[test]
    fn test_bundled_extension_hashes_match_checked_in_archives() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let archive_dir = [
            manifest_dir.join("resources").join("pre-install"),
            manifest_dir.join("..").join("pre-install"),
        ]
        .into_iter()
        .find(|path| path.is_dir())
        .expect("bundled extension archives should exist in the repo");

        for (archive_name, expected_hash) in BUNDLED_EXTENSION_ARCHIVE_SHA256 {
            let archive_path = archive_dir.join(archive_name);
            assert!(
                archive_path.is_file(),
                "missing bundled extension archive: {}",
                archive_path.display()
            );
            let actual_hash =
                compute_sha256(&archive_path).expect("bundled archive should be readable");
            assert_eq!(
                actual_hash, *expected_hash,
                "hash mismatch for bundled archive {archive_name}"
            );
        }
    }

    #[test]
    fn test_should_prevent_exit_only_for_tray_window_close() {
        assert!(should_prevent_exit_for_tray(None, true));
        assert!(!should_prevent_exit_for_tray(None, false));
        assert!(!should_prevent_exit_for_tray(Some(0), true));
        assert!(!should_prevent_exit_for_tray(Some(1), true));
    }
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

fn remove_mcp_server_keys(app_handle: tauri::AppHandle, keys: &[&str]) -> Result<(), String> {
    let config_path = get_app_data_folder_path(app_handle).join("mcp_config.json");

    if !config_path.exists() {
        return Ok(());
    }

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    let mut changed = false;
    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        for key in keys {
            if servers.remove(*key).is_some() {
                changed = true;
            }
        }
    }

    if changed {
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config)
                .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
        )
        .map_err(|e| format!("Failed to write MCP config: {e}"))?;
    }

    Ok(())
}

fn is_unpublished_ax_studio_mcp_preset(server: &serde_json::Value) -> bool {
    server.get("command").and_then(|value| value.as_str()) == Some("npx")
        && server
            .get("args")
            .and_then(|value| value.as_array())
            .is_some_and(|args| {
                args.iter()
                    .any(|arg| arg.as_str() == Some(UNPUBLISHED_AX_STUDIO_MCP_PACKAGE))
            })
}

/// Remove only the unsafe built-in npm preset. A user-supplied local/source
/// configuration under the same server name is deliberately preserved.
fn remove_unpublished_ax_studio_mcp_config(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_app_data_folder_path(app_handle).join("mcp_config.json");
    if !config_path.exists() {
        return Ok(());
    }

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;
    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    let should_remove = config
        .get("mcpServers")
        .and_then(|servers| servers.get("ax-studio"))
        .is_some_and(is_unpublished_ax_studio_mcp_preset);
    if !should_remove {
        return Ok(());
    }

    if let Some(servers) = config
        .get_mut("mcpServers")
        .and_then(|servers| servers.as_object_mut())
    {
        servers.remove("ax-studio");
    }
    fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
    )
    .map_err(|e| format!("Failed to write MCP config: {e}"))?;

    Ok(())
}

/// Ensure the ax-studio MCP server args include `--experimental-sqlite`
/// when the command is `node`.  Node.js requires this flag for `node:sqlite`
/// which fabric-ingest's SemanticStore uses.
fn patch_ax_studio_sqlite_flag(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_app_data_folder_path(app_handle).join("mcp_config.json");

    if !config_path.exists() {
        return Ok(());
    }

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    let mut changed = false;
    if let Some(server) = config
        .get_mut("mcpServers")
        .and_then(|s| s.as_object_mut())
        .and_then(|s| s.get_mut("ax-studio"))
        .and_then(|s| s.as_object_mut())
    {
        let is_node = server
            .get("command")
            .and_then(|c| c.as_str())
            .map(|c| c == "node")
            .unwrap_or(false);

        if is_node {
            if let Some(args) = server.get_mut("args").and_then(|a| a.as_array_mut()) {
                let has_flag = args
                    .iter()
                    .any(|a| a.as_str() == Some("--experimental-sqlite"));
                if !has_flag {
                    // Insert at the front so it precedes the script path
                    args.insert(
                        0,
                        serde_json::Value::String("--experimental-sqlite".to_string()),
                    );
                    changed = true;
                }
            }
        }
    }

    if changed {
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config)
                .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
        )
        .map_err(|e| format!("Failed to write MCP config: {e}"))?;
    }

    Ok(())
}

fn migrate_exa_to_http(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_app_data_folder_path(app_handle).join("mcp_config.json");

    if !config_path.exists() {
        return Ok(());
    }

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
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| format!("Failed to read archive entry: {e}"))?;
        let path_str = entry
            .path()
            .map_err(|e| format!("Failed to read archive entry path: {e}"))?
            .to_string_lossy()
            .to_string();

        let path = Path::new(&path_str);
        let is_manifest_path = path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
            && (path_str == "package/package.json" || path_str == "package.json");

        if is_manifest_path {
            let mut content = String::new();
            entry
                .read_to_string(&mut content)
                .map_err(|e| format!("Failed to read package.json from extension archive: {e}"))?;

            let package_json: serde_json::Value =
                serde_json::from_str(&content).map_err(|e| e.to_string())?;
            return Ok(Some(package_json));
        }
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
    let show_i = MenuItem::with_id(app.handle(), "open", "Open AX Studio", true, None::<&str>)?;
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
                log::debug!("Menu item {other} not handled");
            }
        })
        .build(app)
}

pub fn setup_theme_listener<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    // Setup theme listener for main window
    if let Some(window) = app.get_webview_window("main") {
        configure_macos_zoom_behavior(&window);
        setup_window_theme_listener(app.handle().clone(), window);
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_macos_zoom_behavior<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    if let Err(error) = window.with_webview(|webview| {
        let ns_window = webview.ns_window();
        if ns_window.is_null() {
            return;
        }

        unsafe {
            use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

            let ns_window = &*ns_window.cast::<NSWindow>();
            let mut behavior = ns_window.collectionBehavior();
            behavior.remove(
                NSWindowCollectionBehavior::FullScreenPrimary
                    | NSWindowCollectionBehavior::FullScreenAuxiliary
                    | NSWindowCollectionBehavior::FullScreenAllowsTiling,
            );
            behavior.insert(
                NSWindowCollectionBehavior::FullScreenNone
                    | NSWindowCollectionBehavior::FullScreenDisallowsTiling,
            );
            ns_window.setCollectionBehavior(behavior);
        }
    }) {
        log::warn!("Failed to configure macOS window zoom behavior: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_zoom_behavior<R: Runtime>(_window: &tauri::WebviewWindow<R>) {}

fn setup_window_theme_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) {
    let window_label = window.label().to_string();
    let app_handle_clone = app_handle.clone();
    #[cfg(target_os = "macos")]
    let window_for_close = window.clone();

    window.on_window_event(move |event| {
        // macOS: red close button hides the main window instead of quitting
        // (platform convention). Cmd+Q / Quit still exit via ExitRequested.
        #[cfg(target_os = "macos")]
        if let WindowEvent::CloseRequested { api, .. } = event {
            if window_label == "main" {
                api.prevent_close();
                let _ = window_for_close.hide();
                return;
            }
        }

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

fn tray_icon_enabled() -> bool {
    option_env!("ENABLE_SYSTEM_TRAY_ICON").unwrap_or("false") == "true"
}

fn should_prevent_exit_for_tray(code: Option<i32>, tray_enabled: bool) -> bool {
    code.is_none() && tray_enabled
}

/// Tauri `.setup()` callback — runs once after the app is built.
pub fn app_setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(desktop)]
    {
        let data_folder = get_app_data_folder_path(app.handle().clone());
        let llama_state = app.state::<tauri_plugin_llamacpp::state::LlamacppState>();
        llama_state.add_trusted_binary_root(data_folder.join("llamacpp").join("backends"));
        llama_state.add_trusted_binary_root(data_folder.join("ax-serving"));
        llama_state.add_trusted_model_root(data_folder.join("llamacpp").join("models"));
        #[cfg(unix)]
        {
            llama_state.add_trusted_binary_root(std::path::PathBuf::from("/usr/local/bin"));
            llama_state.add_trusted_binary_root(std::path::PathBuf::from("/opt/homebrew/bin"));
            llama_state.add_trusted_binary_root(std::path::PathBuf::from("/usr/bin"));
        }
        #[cfg(windows)]
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            llama_state.add_trusted_binary_root(std::path::PathBuf::from(program_files));
        }
    }

    // Extension modules are the only application-managed files loaded through
    // the asset protocol. User-selected files are granted individually by the
    // native dialog command.
    app.asset_protocol_scope()
        .allow_directory(get_app_extensions_path(app.handle().clone()), true)?;

    app.handle().plugin(
        tauri_plugin_log::Builder::default()
            .level(if cfg!(debug_assertions) {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            })
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
    #[cfg(desktop)]
    app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;

    let mut store_path = get_app_data_folder_path(app.handle().clone());
    store_path.push("store.json");
    // Use `?` propagation instead of `.expect(...)` so a bad `store.json`
    // (corrupted file, bad permissions, disk full) surfaces as a recoverable
    // setup error rather than a hard panic with no actionable message.
    let store = app.handle().store(store_path)?;
    let stored_version = store
        .get("version")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    let app_version = app.config().version.clone().unwrap_or_default();
    #[cfg(desktop)]
    {
        let extensions_path = get_app_extensions_path(app.handle().clone());
        let pre_install_path = app
            .path()
            .resource_dir()?
            .join("resources")
            .join("pre-install");
        schedule_extension_install_if_needed(
            extensions_path,
            pre_install_path,
            stored_version != app_version,
        );
    }
    if let Err(e) = migrate_mcp_servers(app.handle().clone(), store.clone()) {
        log::error!("Failed to migrate MCP servers: {e}");
    }
    store.set("version", serde_json::json!(app_version));
    // Best-effort save: log the failure but don't crash. All migrations
    // have already run successfully; losing only the version stamp is
    // much less bad than panicking here.
    if let Err(e) = store.save() {
        log::error!("Failed to persist version to store after setup: {e}");
    }

    #[cfg(desktop)]
    if option_env!("ENABLE_SYSTEM_TRAY_ICON").unwrap_or("false") == "true" {
        log::info!("Enabling system tray icon");
        let _ = setup_tray(app);
    }
    #[cfg(all(feature = "deep-link", windows))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link().register_all()?;
    }

    #[cfg(desktop)]
    setup_mcp(app);
    setup_theme_listener(app)?;

    // Explicitly focus the main window on startup.
    // On macOS 15 with transparent + macOSPrivateApi windows, the WebKit
    // webview sometimes fails to become the first responder for input events
    // without an explicit set_focus() call.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }

    // Windows "Open with" cold start delivers target files via process argv.
    // The frontend is not up yet, so these land in the pending buffer and
    // are drained by `take_pending_open_files` on mount.
    #[cfg(desktop)]
    {
        let argv: Vec<String> = std::env::args().collect();
        let paths = crate::core::open_files::extract_file_paths_from_argv(&argv);
        crate::core::open_files::handle_opened_paths(app.handle(), paths);
    }

    Ok(())
}

/// Tauri `.run()` event handler — handles app lifecycle events.
pub fn app_run_handler(app: &tauri::AppHandle, event: RunEvent) {
    match event {
        // macOS Dock drop / Finder "Open" delivers file URLs. The frontend
        // may not be mounted yet on cold start, so route through the
        // pending-open-files buffer/emit helper.
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let paths = crate::core::open_files::paths_from_opened_urls(urls);
            crate::core::open_files::handle_opened_paths(app, paths);
        }
        // macOS: dock click with no visible windows restores the main window
        // (pairs with CloseRequested hide above).
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows, ..
        } => {
            if !has_visible_windows {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
        RunEvent::ExitRequested { code, api, .. } => {
            log::warn!("Tauri exit requested with code: {code:?}");
            if should_prevent_exit_for_tray(code, tray_icon_enabled()) {
                api.prevent_exit();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            } else {
                // Exit is proceeding — release the global hotkey so the OS can
                // hand the combo to another app immediately.
                #[cfg(desktop)]
                {
                    use tauri_plugin_global_shortcut::GlobalShortcutExt;
                    if let Err(e) = app.global_shortcut().unregister_all() {
                        log::warn!("Failed to unregister global shortcuts on exit: {e}");
                    }
                }
            }
        }
        RunEvent::Exit => {
            let app_handle = app.clone();
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.emit("app-shutting-down", ());
                let _ = window.hide();
            }

            // Prefer channel + async spawn over nested block_in_place/block_on,
            // which can deadlock when Exit is observed from a runtime worker.
            let (done_tx, done_rx) = std::sync::mpsc::sync_channel::<()>(1);
            let cleanup_app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                use crate::core::mcp::helpers::background_cleanup_mcp_servers;
                let state = cleanup_app.state::<super::state::AppState>();

                {
                    let mut cleanup_guard = state.background_cleanup_handle.lock().await;
                    if cleanup_guard.is_some() {
                        // Another cleanup already started — wait on that handle below.
                    } else {
                        let task_app = cleanup_app.clone();
                        let cleanup_task = tauri::async_runtime::spawn(async move {
                            let state = task_app.state::<super::state::AppState>();
                            background_cleanup_mcp_servers(&task_app, &state).await;
                            #[cfg(feature = "llamacpp")]
                            {
                                let _ = tauri_plugin_llamacpp::cleanup_llama_processes(
                                    task_app.clone(),
                                )
                                .await;
                                log::info!("llama.cpp process cleanup completed");
                            }
                        });
                        *cleanup_guard = Some(cleanup_task);
                    }
                }

                let cleanup_handle = {
                    let mut cleanup_guard = state.background_cleanup_handle.lock().await;
                    cleanup_guard.take()
                };

                match tokio::time::timeout(tokio::time::Duration::from_secs(10), async {
                    if let Some(handle) = cleanup_handle {
                        let _ = handle.await;
                    }
                })
                .await
                {
                    Ok(_) => log::info!("MCP cleanup completed successfully"),
                    Err(_) => log::warn!("MCP cleanup timed out after 10 seconds"),
                }

                // Wait briefly for any in-flight extension install to finish.
                join_extension_install(Duration::from_secs(5));
                log::info!("App cleanup completed");
                let _ = done_tx.send(());
            });

            match done_rx.recv_timeout(Duration::from_secs(15)) {
                Ok(()) => {}
                Err(_) => log::warn!("App exit cleanup timed out after 15 seconds"),
            }
        }
        _ => {}
    }
}
