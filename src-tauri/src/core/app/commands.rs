use std::{
    ffi::OsString,
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::core::state::AppState;

use super::{
    constants::CONFIGURATION_FILE_NAME, helpers::copy_dir_recursive, models::AppConfiguration,
};

pub(crate) const DATA_FOLDER_MARKER_FILE: &str = ".ax-studio-managed-data";
const DATA_FOLDER_MARKER_CONTENT: &str = "AX Studio managed data directory\n";
const MAX_DATA_FOLDER_PATH_BYTES: usize = 4 * 1024;
const MAX_CONFIGURATION_BYTES: u64 = 1024 * 1024;

fn normalize_with_existing_ancestor(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return ax_studio_utils::normalize_path(&canonical);
    }

    let mut missing_components: Vec<OsString> = Vec::new();
    let mut current = path;
    loop {
        if let Ok(canonical) = current.canonicalize() {
            let mut resolved = canonical;
            for component in missing_components.iter().rev() {
                resolved.push(component);
            }
            return ax_studio_utils::normalize_path(&resolved);
        }
        if let Some(file_name) = current.file_name() {
            missing_components.push(file_name.to_os_string());
        }
        match current.parent() {
            Some(parent) if parent != current => current = parent,
            _ => return ax_studio_utils::normalize_path(path),
        }
    }
}

#[cfg(unix)]
fn is_mount_root(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Some(parent) = path.parent() else {
        return true;
    };
    match (fs::metadata(path), fs::metadata(parent)) {
        (Ok(metadata), Ok(parent_metadata)) => metadata.dev() != parent_metadata.dev(),
        _ => false,
    }
}

#[cfg(not(unix))]
fn is_mount_root(path: &Path) -> bool {
    path.parent().is_none()
}

pub(crate) fn validate_data_folder_path(raw_path: &str) -> Result<PathBuf, String> {
    if raw_path.trim().is_empty()
        || raw_path.len() > MAX_DATA_FOLDER_PATH_BYTES
        || raw_path.chars().any(char::is_control)
    {
        return Err(format!(
            "Data folder path must contain between 1 and {MAX_DATA_FOLDER_PATH_BYTES} non-control bytes"
        ));
    }

    let path = PathBuf::from(raw_path);
    if !path.is_absolute() {
        return Err("Data folder path must be absolute".to_string());
    }
    let path = normalize_with_existing_ancestor(&path);
    if path.parent().is_none() || is_mount_root(&path) {
        return Err("Data folder must not be a filesystem or mounted-volume root".to_string());
    }

    for protected in [
        dirs::home_dir(),
        Some(std::env::temp_dir()),
        std::env::current_dir().ok(),
    ]
    .into_iter()
    .flatten()
    {
        let protected = normalize_with_existing_ancestor(&protected);
        if path == protected {
            return Err(format!(
                "Data folder must not be the protected directory {}",
                protected.display()
            ));
        }
    }

    Ok(path)
}

pub(crate) fn write_data_folder_marker(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("Failed to create managed data directory: {error}"))?;
    fs::write(
        path.join(DATA_FOLDER_MARKER_FILE),
        DATA_FOLDER_MARKER_CONTENT,
    )
    .map_err(|error| format!("Failed to mark managed data directory: {error}"))
}

fn consume_approved_data_folder(
    approved_directories: &mut std::collections::HashSet<PathBuf>,
    path: &Path,
) -> Result<(), String> {
    if approved_directories.remove(path) {
        Ok(())
    } else {
        Err("New data folder was not approved by the native directory picker".to_string())
    }
}

pub(crate) fn is_managed_data_folder<R: Runtime>(app: &AppHandle<R>, path: &Path) -> bool {
    let default_path = validate_data_folder_path(&default_data_folder_path(app.clone())).ok();
    if default_path.as_deref() == Some(path) {
        return true;
    }
    fs::read_to_string(path.join(DATA_FOLDER_MARKER_FILE))
        .is_ok_and(|content| content == DATA_FOLDER_MARKER_CONTENT)
}

fn quarantine_configuration_file(path: &Path, reason: &str) {
    let quarantine_path = path.with_extension(format!(
        "corrupt-{}.json",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0)
    ));
    match fs::rename(path, &quarantine_path) {
        Ok(()) => log::error!(
            "Invalid app config quarantined to {quarantine_path:?}; returning defaults: {reason}"
        ),
        Err(error) => log::error!(
            "Invalid app config could not be quarantined ({error}); returning defaults: {reason}"
        ),
    }
}

fn write_configuration_atomically(
    path: &Path,
    configuration: &AppConfiguration,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Configuration path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut temporary, configuration).map_err(|error| error.to_string())?;
    temporary.flush().map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_app_configurations<R: Runtime>(app_handle: tauri::AppHandle<R>) -> AppConfiguration {
    let mut app_default_configuration = AppConfiguration::default();

    if std::env::var("CI").unwrap_or_default() == "e2e" {
        return app_default_configuration;
    }

    let configuration_file = get_configuration_file_path(app_handle.clone());

    let default_data_folder = default_data_folder_path(app_handle.clone());
    app_default_configuration.data_folder = default_data_folder.clone();

    if !configuration_file.exists() {
        log::info!("App config not found, creating default config at {configuration_file:?}");

        if let Err(err) =
            write_configuration_atomically(&configuration_file, &app_default_configuration)
        {
            log::error!("Failed to create default config: {err}");
        }

        return app_default_configuration;
    }

    if fs::metadata(&configuration_file)
        .is_ok_and(|metadata| metadata.len() > MAX_CONFIGURATION_BYTES)
    {
        quarantine_configuration_file(
            &configuration_file,
            &format!("configuration exceeds the {MAX_CONFIGURATION_BYTES}-byte limit"),
        );
        return app_default_configuration;
    }

    match fs::read_to_string(&configuration_file) {
        Ok(content) => {
            match serde_json::from_str::<AppConfiguration>(&content) {
                Ok(mut app_configurations) => {
                    match validate_data_folder_path(&app_configurations.data_folder) {
                        Ok(path) => {
                            app_configurations.data_folder = path.to_string_lossy().into_owned();
                            app_configurations
                        }
                        Err(error) => {
                            quarantine_configuration_file(&configuration_file, &error);
                            app_default_configuration
                        }
                    }
                }
                Err(err) => {
                    // Quarantine the corrupt config so the next run has a
                    // chance to recreate a fresh default, and so the user
                    // can inspect / recover data by hand. Previously we
                    // silently returned the default config and left the
                    // corrupt file in place — the user's custom data
                    // folder path reverted to default with no UI signal.
                    quarantine_configuration_file(&configuration_file, &err.to_string());
                    app_default_configuration
                }
            }
        }
        Err(err) => {
            log::error!(
                "Failed to read app config, returning default config instead. Error: {err}"
            );
            app_default_configuration
        }
    }
}

pub fn update_app_configuration<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    mut configuration: AppConfiguration,
) -> Result<(), String> {
    let path = validate_data_folder_path(&configuration.data_folder)?;
    configuration.data_folder = path.to_string_lossy().into_owned();
    let configuration_file = get_configuration_file_path(app_handle);
    log::info!("update_app_configuration, configuration_file: {configuration_file:?}");
    write_configuration_atomically(&configuration_file, &configuration)
}

#[tauri::command]
pub fn get_app_data_folder_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    if cfg!(test) {
        use std::{
            collections::HashMap,
            sync::{Mutex, OnceLock},
        };
        static TEST_DATA_DIRS: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();

        let thread_id = format!("{:?}", std::thread::current().id());
        let dirs = TEST_DATA_DIRS.get_or_init(|| Mutex::new(HashMap::new()));
        let mut dirs = dirs.lock().expect("test data dir map lock poisoned");
        let path = dirs
            .entry(thread_id.clone())
            .or_insert_with(|| {
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0);
                std::env::temp_dir().join(format!("ax-studio-test-data-{thread_id}-{timestamp}"))
            })
            .clone();
        let _ = fs::create_dir_all(&path);
        return path;
    }

    let app_configurations = get_app_configurations(app_handle);
    PathBuf::from(app_configurations.data_folder)
}

#[tauri::command]
pub fn get_configuration_file_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    let app_path = app_handle.path().app_data_dir().unwrap_or_else(|err| {
        log::error!("Failed to get app data directory: {err}. Using home directory instead.");

        let home_dir = std::env::var(if cfg!(target_os = "windows") {
            "USERPROFILE"
        } else {
            "HOME"
        })
        .unwrap_or_else(|_| {
            log::error!("HOME/USERPROFILE env var not set, falling back to /tmp");
            if cfg!(target_os = "windows") {
                "C:\\Temp".to_string()
            } else {
                "/tmp".to_string()
            }
        });

        PathBuf::from(home_dir)
    });

    let package_name = env!("CARGO_PKG_NAME");
    let app_parent = app_path.parent().unwrap_or(&app_path);
    let legacy_candidates = [
        app_parent.join(package_name),
        app_parent.join("Ax-Studio"),
        app_parent.join("Ax Studio"),
    ];

    for legacy_dir in legacy_candidates {
        let legacy_config = legacy_dir.join(CONFIGURATION_FILE_NAME);
        if legacy_config.exists() {
            return legacy_config;
        }
    }

    app_path.join(CONFIGURATION_FILE_NAME)
}

#[tauri::command]
pub fn default_data_folder_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> String {
    let mut path = app_handle.path().data_dir().unwrap_or_else(|_| {
        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
    });

    let app_name = std::env::var("APP_NAME")
        .unwrap_or_else(|_| app_handle.config().product_name.clone().unwrap_or_default());
    path.push(app_name);
    path.push("data");

    if !path.exists() {
        if let Some(parent) = path.parent().and_then(|p| p.parent()) {
            for legacy_name in ["Ax-Studio", "Ax Studio"] {
                let legacy_path = parent.join(legacy_name).join("data");
                if legacy_path.exists() {
                    return legacy_path.to_string_lossy().to_string();
                }
            }
        }
    }

    let mut path_str = path.to_string_lossy().to_string();

    if let Some(stripped) = path_str.strip_suffix(".ai.app") {
        path_str = stripped.to_string();
    }

    path_str
}

#[tauri::command]
pub fn get_user_home_path<R: Runtime>(app: AppHandle<R>) -> String {
    get_app_configurations(app.clone()).data_folder
}

#[tauri::command]
pub async fn change_app_data_folder<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    new_data_folder: String,
) -> Result<(), String> {
    let _relocation_guard = state.factory_reset_lock.lock().await;
    // Get current data folder path
    let current_data_folder =
        validate_data_folder_path(&get_app_data_folder_path(app_handle.clone()).to_string_lossy())?;
    let new_data_folder_path = validate_data_folder_path(&new_data_folder)?;

    if new_data_folder_path == current_data_folder {
        return Ok(());
    }
    if new_data_folder_path.starts_with(&current_data_folder)
        || current_data_folder.starts_with(&new_data_folder_path)
    {
        return Err("New and current data folders must not contain one another".to_string());
    }

    // Relocation is destructive enough to require proof of a recent native
    // directory-picker selection. This prevents arbitrary webview input from
    // turning an unrelated filesystem path into a future factory-reset target.
    {
        let mut approved_directories = state.approved_read_directories.lock().await;
        consume_approved_data_folder(&mut approved_directories, &new_data_folder_path)?;
    }

    let source = current_data_folder.clone();
    let destination = new_data_folder_path.clone();
    tokio::task::spawn_blocking(move || {
        if !destination.is_dir() {
            return Err("New data folder path must be an existing directory".to_string());
        }
        if fs::read_dir(&destination)
            .map_err(|error| format!("Failed to inspect new data folder: {error}"))?
            .next()
            .is_some()
        {
            return Err("New data folder must be empty".to_string());
        }
        let parent = destination
            .parent()
            .ok_or_else(|| "New data folder has no parent directory".to_string())?;
        let staging = parent.join(format!(".ax-studio-relocate-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&staging)
            .map_err(|error| format!("Failed to create relocation staging directory: {error}"))?;

        let result = (|| {
            if source.exists() {
                log::info!("Copying data from {source:?} to relocation staging {staging:?}");
                copy_dir_recursive(&source, &staging, &[".uvx", ".npx"])
                    .map_err(|error| format!("Failed to copy data to new folder: {error}"))?;
            } else {
                log::info!("Current data folder does not exist, nothing to copy");
            }
            write_data_folder_marker(&staging)?;

            // The picker-approved destination was verified empty. Re-check that
            // invariant at commit time, then atomically replace it with the
            // fully copied staging directory on the same filesystem.
            fs::remove_dir(&destination)
                .map_err(|error| format!("New data folder changed during relocation: {error}"))?;
            if let Err(error) = fs::rename(&staging, &destination) {
                let _ = fs::create_dir(&destination);
                return Err(format!("Failed to commit relocated data folder: {error}"));
            }
            Ok(())
        })();

        if staging.exists() {
            if let Err(error) = fs::remove_dir_all(&staging) {
                log::warn!(
                    "Failed to clean relocation staging directory {}: {error}",
                    staging.display()
                );
            }
        }
        result
    })
    .await
    .map_err(|error| format!("Data-folder relocation task failed: {error}"))??;

    // Update the configuration to point to the new folder
    let mut configuration = get_app_configurations(app_handle.clone());
    configuration.data_folder = new_data_folder_path.to_string_lossy().into_owned();

    // Commit the durable configuration before updating the current process's
    // transient asset scope. The UI relaunches immediately after relocation,
    // and startup rebuilds this scope from the committed data folder.
    update_app_configuration(app_handle.clone(), configuration)?;
    if let Err(error) = app_handle
        .asset_protocol_scope()
        .allow_directory(new_data_folder_path.join("extensions"), true)
    {
        log::warn!("Failed to grant extension asset scope before relaunch: {error}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_folder_validation_rejects_unbounded_or_protected_paths() {
        assert!(validate_data_folder_path("relative/data").is_err());
        assert!(validate_data_folder_path("bad\npath").is_err());
        assert!(validate_data_folder_path(&"x".repeat(MAX_DATA_FOLDER_PATH_BYTES + 1)).is_err());

        for protected in [
            dirs::home_dir(),
            Some(std::env::temp_dir()),
            std::env::current_dir().ok(),
        ]
        .into_iter()
        .flatten()
        {
            assert!(validate_data_folder_path(&protected.to_string_lossy()).is_err());
        }

        #[cfg(unix)]
        assert!(validate_data_folder_path("/").is_err());
    }

    #[test]
    fn data_folder_validation_accepts_safe_absolute_child() {
        let candidate = std::env::temp_dir()
            .join("ax-studio-validation")
            .join(uuid::Uuid::new_v4().to_string());
        assert_eq!(
            validate_data_folder_path(&candidate.to_string_lossy()).unwrap(),
            normalize_with_existing_ancestor(&candidate)
        );
    }

    #[test]
    fn configuration_write_is_atomic_and_valid_json() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("app-config.json");
        let configuration = AppConfiguration {
            data_folder: directory.path().join("data").to_string_lossy().into_owned(),
        };

        write_configuration_atomically(&path, &configuration).unwrap();
        let parsed: AppConfiguration = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(parsed.data_folder, configuration.data_folder);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn managed_marker_has_exact_expected_contents() {
        let directory = tempfile::tempdir().unwrap();
        write_data_folder_marker(directory.path()).unwrap();
        assert_eq!(
            fs::read_to_string(directory.path().join(DATA_FOLDER_MARKER_FILE)).unwrap(),
            DATA_FOLDER_MARKER_CONTENT
        );
    }

    #[test]
    fn data_folder_picker_approval_is_exact_and_one_time() {
        let selected = PathBuf::from("/tmp/selected");
        let child = selected.join("child");
        let mut approved = std::collections::HashSet::from([selected.clone()]);

        assert!(consume_approved_data_folder(&mut approved, &child).is_err());
        assert!(consume_approved_data_folder(&mut approved, &selected).is_ok());
        assert!(consume_approved_data_folder(&mut approved, &selected).is_err());
    }
}
