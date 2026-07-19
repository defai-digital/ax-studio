// Filesystem commands retained for the current desktop bridge surface.
// It's added to ensure the legacy implementation from frontend still functions before removal.
use super::helpers::resolve_path;
#[cfg(desktop)]
use super::models::DialogOpenOptions;
use super::models::FileStat;
use crate::core::state::AppState;
use base64::Engine;
#[cfg(desktop)]
use rfd::AsyncFileDialog;
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
#[cfg(desktop)]
use tauri::{AppHandle, Manager};
use tauri::{Runtime, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum SinglePathRequest {
    Legacy { args: Vec<String> },
    Typed { path: String },
}

impl SinglePathRequest {
    fn into_path(self, command: &str) -> Result<String, String> {
        match self {
            Self::Legacy { args } => args
                .into_iter()
                .next()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("{command} error: Invalid argument")),
            Self::Typed { path } if !path.is_empty() => Ok(path),
            Self::Typed { .. } => Err(format!("{command} error: Invalid argument")),
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum PathPairRequest {
    Legacy { args: Vec<String> },
    Typed { source: String, destination: String },
}

impl PathPairRequest {
    fn into_paths(self, command: &str) -> Result<(String, String), String> {
        match self {
            Self::Legacy { args } => {
                if args.len() < 2 || args[0].is_empty() || args[1].is_empty() {
                    Err(format!(
                        "{command} error: Invalid argument - source and destination required"
                    ))
                } else {
                    Ok((args[0].clone(), args[1].clone()))
                }
            }
            Self::Typed {
                source,
                destination,
            } if !source.is_empty() && !destination.is_empty() => Ok((source, destination)),
            Self::Typed { .. } => Err(format!(
                "{command} error: Invalid argument - source and destination required"
            )),
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum FileContentRequest {
    Legacy { args: Vec<String> },
    TypedData { path: String, data: String },
    TypedContent { path: String, content: String },
}

impl FileContentRequest {
    fn into_parts(self, command: &str) -> Result<(String, String), String> {
        match self {
            Self::Legacy { args } => {
                if args.len() < 2 || args[0].is_empty() {
                    Err(format!(
                        "{command} error: Invalid argument - path and content required"
                    ))
                } else {
                    Ok((args[0].clone(), args[1].clone()))
                }
            }
            Self::TypedData { path, data } if !path.is_empty() => Ok((path, data)),
            Self::TypedContent { path, content } if !path.is_empty() => Ok((path, content)),
            _ => Err(format!(
                "{command} error: Invalid argument - path and content required"
            )),
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum GgufFilesRequest {
    Legacy { args: Vec<String> },
    Typed { paths: Vec<String> },
}

impl GgufFilesRequest {
    fn into_paths(self) -> Result<Vec<String>, String> {
        let paths = match self {
            Self::Legacy { args } => args,
            Self::Typed { paths } => paths,
        };
        if paths.is_empty() || paths.iter().any(|path| path.is_empty()) {
            return Err("get_gguf_files error: Invalid argument".to_string());
        }
        Ok(paths)
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum JoinPathRequest {
    Legacy {
        args: Vec<String>,
    },
    Typed {
        base_path: String,
        #[serde(default)]
        parts: Vec<String>,
    },
}

impl JoinPathRequest {
    fn into_parts(self) -> Result<Vec<String>, String> {
        match self {
            Self::Legacy { args } if !args.is_empty() => Ok(args),
            Self::Typed { base_path, parts } if !base_path.is_empty() => {
                let mut values = Vec::with_capacity(parts.len() + 1);
                values.push(base_path);
                values.extend(parts);
                Ok(values)
            }
            _ => Err("join_path error: Invalid argument".to_string()),
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum FileStatRequest {
    LegacyArgs { args: Vec<String> },
    Legacy { args: String },
    Typed { path: String },
}

impl FileStatRequest {
    fn into_path(self) -> Result<String, String> {
        match self {
            Self::LegacyArgs { args } => args
                .into_iter()
                .next()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "file_stat error: Invalid argument".to_string()),
            Self::Legacy { args } if !args.is_empty() => Ok(args),
            Self::Typed { path } if !path.is_empty() => Ok(path),
            _ => Err("file_stat error: Invalid argument".to_string()),
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum WriteYamlRequest {
    Legacy { data: String, save_path: String },
    Typed { data: String, path: String },
}

impl WriteYamlRequest {
    fn into_parts(self) -> Result<(String, String), String> {
        match self {
            Self::Legacy { data, save_path } if !save_path.is_empty() => Ok((data, save_path)),
            Self::Typed { data, path } if !path.is_empty() => Ok((data, path)),
            _ => Err("write_yaml error: Invalid argument".to_string()),
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum DecompressRequest {
    Legacy {
        path: String,
        output_dir: String,
    },
    Typed {
        path: String,
        #[serde(alias = "outputDir")]
        output_dir: String,
    },
}

impl DecompressRequest {
    fn into_parts(self) -> Result<(String, String), String> {
        match self {
            Self::Legacy { path, output_dir } | Self::Typed { path, output_dir }
                if !path.is_empty() && !output_dir.is_empty() =>
            {
                Ok((path, output_dir))
            }
            _ => Err("decompress error: Invalid argument".to_string()),
        }
    }
}

fn normalize_copy_source_path(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.len() > 4 * 1024 || path.chars().any(char::is_control) {
        return Err("copy_file error: invalid source path".to_string());
    }
    if path.starts_with("http://") || path.starts_with("https://") {
        return Err("copy_file error: source path must be a local file".to_string());
    }

    let normalized = if path.starts_with("file:/") || path.starts_with("file:\\") {
        ax_studio_utils::normalize_file_path(path)
    } else {
        path.to_string()
    };
    let source = PathBuf::from(normalized);
    if !source.is_absolute() {
        return Err("copy_file error: source path must be absolute".to_string());
    }

    let canonical = source
        .canonicalize()
        .map_err(|e| format!("copy_file error: cannot resolve source path: {e}"))?;
    if !canonical.is_file() {
        return Err("copy_file error: source path must be a file".to_string());
    }

    Ok(ax_studio_utils::normalize_path(&canonical))
}

fn normalize_with_existing_ancestor(path: PathBuf) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return ax_studio_utils::normalize_path(&canonical);
    }

    let mut missing_components: Vec<OsString> = Vec::new();
    let mut current = path.as_path();

    while let Some(parent) = current.parent() {
        if let Some(file_name) = current.file_name() {
            missing_components.push(file_name.to_os_string());
        }

        if parent.exists() {
            if let Ok(canonical_parent) = parent.canonicalize() {
                let mut resolved = canonical_parent;
                for component in missing_components.iter().rev() {
                    resolved.push(component);
                }
                return ax_studio_utils::normalize_path(&resolved);
            }
        }

        current = parent;
    }

    ax_studio_utils::normalize_path(&path)
}

fn normalize_app_data_write_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    path: &str,
    command: &str,
) -> Result<PathBuf, String> {
    if path.is_empty() || path.len() > 4 * 1024 || path.chars().any(char::is_control) {
        return Err(format!("{command} error: invalid destination path"));
    }
    if path.starts_with("http://") || path.starts_with("https://") {
        return Err(format!(
            "{command} error: destination path must be local app data"
        ));
    }

    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app_handle);
    let canonical_app_data = ax_studio_utils::normalize_path(
        &app_data_folder
            .canonicalize()
            .unwrap_or_else(|_| app_data_folder.clone()),
    );

    let destination = if path.starts_with("file:/") || path.starts_with("file:\\") {
        let normalized = ax_studio_utils::normalize_file_path(path);
        let relative_normalized = normalized
            .trim_start_matches(std::path::MAIN_SEPARATOR)
            .trim_start_matches('/')
            .trim_start_matches('\\');
        canonical_app_data.join(relative_normalized)
    } else {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            path
        } else {
            canonical_app_data.join(path)
        }
    };

    let resolved = normalize_with_existing_ancestor(destination);
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

// Akidb (knowledge-base) commands moved to the sibling `akidb` module.
// See crate::core::filesystem::akidb for read_akidb_*, write_akidb_*,
// akidb_sync_now, and cancel_akidb_sync.

pub(crate) fn normalize_save_target_path(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.len() > 4 * 1024 || path.chars().any(char::is_control) {
        return Err("save path is invalid".to_string());
    }
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("save path must be absolute".to_string());
    }

    let file_name = path
        .file_name()
        .ok_or_else(|| "save path must include a file name".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "save path must include a parent directory".to_string())?;

    let canonical_parent = parent.canonicalize().map_err(|e| {
        format!(
            "Cannot resolve save path parent '{}': {e}",
            parent.display()
        )
    })?;
    Ok(canonical_parent.join(file_name))
}

const MAX_APPROVED_SAVE_PATHS: usize = 256;
const MAX_APPROVED_READ_PATHS: usize = 256;
const MAX_BASE64_READ_BYTES: u64 = 128 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_STRUCTURED_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_APPEND_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_BINARY_WRITE_BYTES: usize = 128 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 50_000;
const MAX_GGUF_PATHS: usize = 10_000;
const MAX_ARCHIVE_INPUT_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 50_000;
const MAX_ARCHIVE_PATH_BYTES: usize = 4 * 1024;

fn ensure_payload_limit(command: &str, bytes: usize, maximum: u64) -> Result<(), String> {
    if u64::try_from(bytes).unwrap_or(u64::MAX) > maximum {
        Err(format!(
            "{command}: payload exceeds the {maximum}-byte limit"
        ))
    } else {
        Ok(())
    }
}

fn write_atomically(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Write path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(data)
        .map_err(|error| error.to_string())?;
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

pub(crate) fn approve_save_target(
    approved_save_paths: &mut std::collections::HashSet<PathBuf>,
    path: &str,
) -> Result<(), String> {
    let normalized = normalize_save_target_path(path)?;
    if approved_save_paths.len() >= MAX_APPROVED_SAVE_PATHS
        && !approved_save_paths.contains(&normalized)
    {
        return Err(format!(
            "Too many approved save paths (maximum {MAX_APPROVED_SAVE_PATHS})"
        ));
    }
    approved_save_paths.insert(normalized);
    Ok(())
}

pub(crate) fn consume_approved_save_target(
    approved_save_paths: &mut std::collections::HashSet<PathBuf>,
    path: &str,
) -> Result<PathBuf, String> {
    let normalized = normalize_save_target_path(path)?;
    if approved_save_paths.remove(&normalized) {
        Ok(normalized)
    } else {
        Err("write_binary_file error: path was not approved by save dialog".to_string())
    }
}

fn canonical_selected_path(
    path: &std::path::Path,
    expect_directory: bool,
) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map(|path| ax_studio_utils::normalize_path(&path))
        .map_err(|error| format!("Cannot resolve selected path: {error}"))?;
    if expect_directory && !canonical.is_dir() {
        return Err("Selected read path is not a directory".to_string());
    }
    if !expect_directory && !canonical.is_file() {
        return Err("Selected read path is not a file".to_string());
    }
    Ok(canonical)
}

fn insert_bounded_approved_paths(
    approved: &mut std::collections::HashSet<PathBuf>,
    paths: impl IntoIterator<Item = PathBuf>,
) -> Result<(), String> {
    let paths = paths.into_iter().collect::<Vec<_>>();
    let additional = paths
        .iter()
        .filter(|path| !approved.contains(*path))
        .count();
    if approved.len().saturating_add(additional) > MAX_APPROVED_READ_PATHS {
        return Err(format!(
            "Too many approved read paths (maximum {MAX_APPROVED_READ_PATHS})"
        ));
    }
    approved.extend(paths);
    Ok(())
}

fn is_read_path_approved(
    path: &std::path::Path,
    app_data_folder: &std::path::Path,
    approved_files: &std::collections::HashSet<PathBuf>,
    approved_directories: &std::collections::HashSet<PathBuf>,
) -> bool {
    path.starts_with(app_data_folder)
        || approved_files.contains(path)
        || approved_directories
            .iter()
            .any(|directory| path.starts_with(directory))
}

#[tauri::command]
/// Remove a file or directory inside the app data folder.
pub fn rm<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: SinglePathRequest,
) -> Result<(), String> {
    let path = resolve_path(app_handle, &request.into_path("rm")?)?;
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    } else if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else {
        return Err("rm error: Path does not exist".to_string());
    }

    Ok(())
}

#[tauri::command]
/// Create a directory path inside the app data folder.
pub fn mkdir<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: SinglePathRequest,
) -> Result<(), String> {
    let path = resolve_path(app_handle, &request.into_path("mkdir")?)?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
/// Move or rename a file or directory within the app data folder.
pub fn mv<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: PathPairRequest,
) -> Result<(), String> {
    let (source_arg, destination_arg) = request.into_paths("mv")?;

    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app_handle.clone());
    let canonical_app_data = ax_studio_utils::normalize_path(
        &app_data_folder
            .canonicalize()
            .unwrap_or_else(|_| app_data_folder.clone()),
    );
    let source = resolve_path(app_handle.clone(), &source_arg)?;
    let destination = resolve_path(app_handle, &destination_arg)?;

    if !source.starts_with(&canonical_app_data) {
        return Err(format!(
            "mv error: source path {} is not under app data folder",
            source.display()
        ));
    }

    if !destination.starts_with(&canonical_app_data) {
        return Err(format!(
            "mv error: destination path {} is not under app data folder",
            destination.display()
        ));
    }

    if !source.exists() {
        return Err("mv error: Source path does not exist".to_string());
    }

    fs::rename(&source, &destination).map_err(|e| e.to_string())
}

#[tauri::command]
/// Copy a local file into a destination inside the app data folder.
pub async fn copy_file<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    request: PathPairRequest,
) -> Result<(), String> {
    let (source_arg, destination_arg) = request.into_paths("copy_file")?;
    let source = normalize_copy_source_path(&source_arg)?;
    let destination =
        normalize_app_data_write_path(app_handle.clone(), &destination_arg, "copy_file")?;

    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app_handle);
    let app_data_folder = app_data_folder
        .canonicalize()
        .map(|path| ax_studio_utils::normalize_path(&path))
        .unwrap_or_else(|_| ax_studio_utils::normalize_path(&app_data_folder));
    {
        let approved_files = state.approved_read_files.lock().await;
        let approved_directories = state.approved_read_directories.lock().await;
        if !is_read_path_approved(
            &source,
            &app_data_folder,
            &approved_files,
            &approved_directories,
        ) {
            return Err(
                "copy_file error: source was not approved by the native open dialog".to_string(),
            );
        }
    }

    tokio::task::spawn_blocking(move || {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(&source, &destination)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("copy_file task failed: {error}"))?
}

#[tauri::command]
/// Join path segments onto a base path under the app data folder.
pub fn join_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: JoinPathRequest,
) -> Result<String, String> {
    let args = request.into_parts()?;
    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app_handle.clone());
    let canonical_app_data = ax_studio_utils::normalize_path(
        &app_data_folder
            .canonicalize()
            .unwrap_or_else(|_| app_data_folder.clone()),
    );
    let path = resolve_path(app_handle, &args[0])?;
    let joined_path = args[1..].iter().fold(path, |acc, part| acc.join(part));
    let normalized = ax_studio_utils::normalize_path(&joined_path);
    if !normalized.starts_with(&canonical_app_data) {
        return Err(format!(
            "join_path error: result path {} is outside app data folder",
            normalized.display()
        ));
    }
    Ok(normalized.to_string_lossy().to_string())
}

#[tauri::command]
/// Check whether a path exists inside the app data folder.
pub fn exists_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: SinglePathRequest,
) -> Result<bool, String> {
    let path = resolve_path(app_handle, &request.into_path("exist_sync")?)?;
    Ok(path.exists())
}

#[tauri::command]
/// Return file metadata for a path inside the app data folder.
pub fn file_stat<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: FileStatRequest,
) -> Result<FileStat, String> {
    let path = resolve_path(app_handle, &request.into_path()?)?;
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let is_directory = metadata.is_dir();
    let size = if is_directory { 0 } else { metadata.len() };
    let file_stat = FileStat { is_directory, size };
    Ok(file_stat)
}

#[tauri::command]
/// Read a UTF-8 text file from the app data folder.
pub fn read_file_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: SinglePathRequest,
) -> Result<String, String> {
    let path = resolve_path(app_handle, &request.into_path("read_file_sync")?)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("read_file_sync: path is not a file".to_string());
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "read_file_sync: file exceeds the {MAX_TEXT_FILE_BYTES}-byte limit"
        ));
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
/// Read an app-data or native-picker-approved file as base64.
pub async fn read_file_base64<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    request: SinglePathRequest,
) -> Result<String, String> {
    let raw_path = match request {
        SinglePathRequest::Legacy { args } => args
            .into_iter()
            .next()
            .ok_or_else(|| "read_file_base64: no path provided".to_string())?,
        SinglePathRequest::Typed { path } => path,
    };
    let path = resolve_approved_read_file(app_handle, &state, raw_path, "read_file_base64").await?;

    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_BASE64_READ_BYTES {
        return Err(format!(
            "read_file_base64: file exceeds the {MAX_BASE64_READ_BYTES}-byte limit"
        ));
    }
    tokio::task::spawn_blocking(move || {
        let bytes = fs::read(&path).map_err(|error| format!("Failed to read file: {error}"))?;
        Ok(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &bytes,
        ))
    })
    .await
    .map_err(|error| format!("read_file_base64 task join error: {error}"))?
}

async fn resolve_approved_read_file<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: &State<'_, AppState>,
    raw_path: String,
    command: &str,
) -> Result<PathBuf, String> {
    if raw_path.is_empty() || raw_path.len() > 4 * 1024 || raw_path.chars().any(char::is_control) {
        return Err(format!("{command}: invalid path"));
    }
    let clean_path = if raw_path.starts_with("file:/") || raw_path.starts_with("file:\\") {
        ax_studio_utils::normalize_file_path(&raw_path)
    } else {
        raw_path
    };
    let path = PathBuf::from(clean_path)
        .canonicalize()
        .map(|path| ax_studio_utils::normalize_path(&path))
        .map_err(|error| format!("Cannot resolve read path: {error}"))?;
    if !path.is_file() {
        return Err(format!("{command}: path is not a file"));
    }

    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app_handle);
    let app_data_folder = app_data_folder
        .canonicalize()
        .map(|path| ax_studio_utils::normalize_path(&path))
        .unwrap_or_else(|_| ax_studio_utils::normalize_path(&app_data_folder));
    let approved_files = state.approved_read_files.lock().await;
    let approved_directories = state.approved_read_directories.lock().await;
    if !is_read_path_approved(
        &path,
        &app_data_folder,
        &approved_files,
        &approved_directories,
    ) {
        return Err(format!(
            "{command}: path was not approved by the native open dialog"
        ));
    }
    drop(approved_directories);
    drop(approved_files);
    Ok(path)
}

#[tauri::command]
/// Stream an approved file through SHA-256 without buffering it in renderer memory.
pub async fn validate_sha256<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    path: String,
    expected: String,
) -> Result<bool, String> {
    let normalized_expected = expected
        .strip_prefix("sha256:")
        .unwrap_or(&expected)
        .to_ascii_lowercase();
    if normalized_expected.len() != 64
        || !normalized_expected
            .chars()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err("validate_sha256: expected hash must be 64 hexadecimal characters".to_string());
    }

    let approved_path =
        resolve_approved_read_file(app_handle, &state, path, "validate_sha256").await?;
    let actual = ax_studio_utils::crypto::compute_file_sha256_with_cancellation(
        &approved_path,
        &CancellationToken::new(),
    )
    .await?;
    Ok(actual.eq_ignore_ascii_case(&normalized_expected))
}

#[tauri::command]
/// Atomically write a UTF-8 text file inside the app data folder.
pub fn write_file_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: PathPairRequest,
) -> Result<(), String> {
    let (path_arg, content) = request.into_paths("write_file_sync")?;
    ensure_payload_limit("write_file_sync", content.len(), MAX_TEXT_FILE_BYTES)?;
    let path = resolve_path(app_handle, &path_arg)?;
    write_atomically(&path, content.as_bytes())
}

#[tauri::command]
/// Write string-backed binary data inside the app data folder.
pub fn write_blob<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: FileContentRequest,
) -> Result<(), String> {
    let (path_arg, data) = request.into_parts("write_blob")?;
    ensure_payload_limit("write_blob", data.len(), MAX_TEXT_FILE_BYTES)?;
    let path = normalize_app_data_write_path(app_handle, &path_arg, "write_blob")?;
    write_atomically(&path, data.as_bytes())
}

#[tauri::command]
/// Remove a file inside the app data folder.
pub fn unlink_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: SinglePathRequest,
) -> Result<(), String> {
    let path = resolve_path(app_handle, &request.into_path("unlink_sync")?)?;
    if path.is_dir() {
        return Err("unlink_sync error: Path is a directory".to_string());
    }
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
/// Append UTF-8 text to a file inside the app data folder, creating it if needed.
pub fn append_file_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: FileContentRequest,
) -> Result<(), String> {
    let (path_arg, content) = request.into_parts("append_file_sync")?;
    ensure_payload_limit("append_file_sync", content.len(), MAX_TEXT_FILE_BYTES)?;
    let path = normalize_app_data_write_path(app_handle, &path_arg, "append_file_sync")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing_size = fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let resulting_size = existing_size
        .checked_add(u64::try_from(content.len()).unwrap_or(u64::MAX))
        .ok_or_else(|| "append_file_sync: resulting file size overflow".to_string())?;
    if resulting_size > MAX_APPEND_FILE_BYTES {
        return Err(format!(
            "append_file_sync: resulting file exceeds the {MAX_APPEND_FILE_BYTES}-byte limit"
        ));
    }
    let mut options = fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(nix::libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|e| e.to_string())
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GgufFilesResult {
    pub gguf: Vec<String>,
    pub non_gguf: Vec<String>,
}

#[tauri::command]
/// Classify app-data file paths by GGUF extension.
pub fn get_gguf_files<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: GgufFilesRequest,
) -> Result<GgufFilesResult, String> {
    let mut gguf = Vec::new();
    let mut non_gguf = Vec::new();

    let paths = request.into_paths()?;
    if paths.len() > MAX_GGUF_PATHS {
        return Err(format!(
            "get_gguf_files: more than {MAX_GGUF_PATHS} paths were supplied"
        ));
    }
    for path_arg in paths {
        let path = resolve_path(app_handle.clone(), &path_arg)?;
        let output_path = path.to_string_lossy().to_string();
        let is_gguf = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("gguf"))
            .unwrap_or(false);

        if path.is_file() && is_gguf {
            gguf.push(output_path);
        } else {
            non_gguf.push(output_path);
        }
    }

    Ok(GgufFilesResult { gguf, non_gguf })
}

#[tauri::command]
/// List directory entries for a path inside the app data folder.
pub fn readdir_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: SinglePathRequest,
) -> Result<Vec<String>, String> {
    let path = resolve_path(app_handle, &request.into_path("read_dir_sync")?)?;
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut paths = Vec::new();
    for entry in entries {
        if paths.len() >= MAX_DIRECTORY_ENTRIES {
            return Err(format!(
                "readdir_sync: directory contains more than {MAX_DIRECTORY_ENTRIES} entries"
            ));
        }
        let entry = entry.map_err(|error| error.to_string())?;
        paths.push(entry.path().to_string_lossy().to_string());
    }
    Ok(paths)
}

#[tauri::command]
/// Validate and atomically write YAML content under the app data folder.
pub fn write_yaml(
    app: tauri::AppHandle<impl Runtime>,
    request: WriteYamlRequest,
) -> Result<(), String> {
    let (data, save_path) = request.into_parts()?;
    ensure_payload_limit("write_yaml", data.len(), MAX_STRUCTURED_FILE_BYTES)?;
    let save_path = normalize_app_data_write_path(app, &save_path, "write_yaml")?;
    let _: serde_yaml::Value = serde_yaml::from_str(&data).map_err(|e| e.to_string())?;
    write_atomically(&save_path, data.as_bytes())
}

#[tauri::command]
/// Read a YAML file from the app data folder and return it as JSON.
pub fn read_yaml<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SinglePathRequest,
) -> Result<serde_json::Value, String> {
    let path = request.into_path("read_yaml")?;
    let path = normalize_app_data_write_path(app, &path, "read_yaml")?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_STRUCTURED_FILE_BYTES {
        return Err(format!(
            "read_yaml: file must be at most {MAX_STRUCTURED_FILE_BYTES} bytes"
        ));
    }
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);
    let data: serde_json::Value = serde_yaml::from_reader(reader).map_err(|e| e.to_string())?;
    Ok(data)
}

#[derive(Clone, Copy)]
enum ArchiveKind {
    TarGz,
    Zip,
}

struct ArchiveBudget {
    entries: usize,
    expanded_bytes: u64,
}

impl ArchiveBudget {
    fn new() -> Self {
        Self {
            entries: 0,
            expanded_bytes: 0,
        }
    }

    fn record(&mut self, entry_bytes: u64) -> Result<(), String> {
        if self.entries >= MAX_ARCHIVE_ENTRIES {
            return Err(format!(
                "Archive contains more than {MAX_ARCHIVE_ENTRIES} entries"
            ));
        }
        if entry_bytes > MAX_ARCHIVE_ENTRY_BYTES {
            return Err(format!(
                "Archive entry exceeds the {MAX_ARCHIVE_ENTRY_BYTES}-byte limit"
            ));
        }
        self.expanded_bytes = self
            .expanded_bytes
            .checked_add(entry_bytes)
            .filter(|total| *total <= MAX_ARCHIVE_EXPANDED_BYTES)
            .ok_or_else(|| {
                format!("Archive expands beyond the {MAX_ARCHIVE_EXPANDED_BYTES}-byte limit")
            })?;
        self.entries += 1;
        Ok(())
    }
}

fn archive_kind(path: &Path) -> Result<ArchiveKind, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if name.ends_with(".tar.gz") {
        Ok(ArchiveKind::TarGz)
    } else if name.ends_with(".zip") {
        Ok(ArchiveKind::Zip)
    } else {
        Err("Unsupported file format. Only .tar.gz and .zip are supported.".to_string())
    }
}

fn resolve_archive_boundary_path(
    canonical_app_data: &Path,
    raw_path: &str,
    description: &str,
) -> Result<PathBuf, String> {
    if raw_path.is_empty()
        || raw_path.len() > MAX_ARCHIVE_PATH_BYTES
        || raw_path.chars().any(char::is_control)
        || raw_path.starts_with("http://")
        || raw_path.starts_with("https://")
    {
        return Err(format!("Invalid {description}"));
    }

    let normalized = if raw_path.starts_with("file:/") || raw_path.starts_with("file:\\") {
        ax_studio_utils::normalize_file_path(raw_path)
    } else {
        raw_path.to_string()
    };
    let path = PathBuf::from(normalized);
    let candidate = if path.is_absolute() {
        path
    } else {
        canonical_app_data.join(path)
    };
    let resolved = normalize_with_existing_ancestor(candidate);
    if !resolved.starts_with(canonical_app_data) {
        return Err(format!(
            "Error: {description} {} is not under app_data_folder {}",
            resolved.display(),
            canonical_app_data.display()
        ));
    }
    Ok(resolved)
}

fn safe_archive_destination(
    output_root: &Path,
    entry_path: &Path,
    archive_name: &str,
) -> Result<PathBuf, String> {
    let display = entry_path.to_string_lossy();
    if display.is_empty()
        || display.len() > MAX_ARCHIVE_PATH_BYTES
        || display.chars().any(char::is_control)
    {
        return Err(format!("Invalid {archive_name} entry path"));
    }

    let mut relative = PathBuf::new();
    for component in entry_path.components() {
        match component {
            Component::Normal(component) => relative.push(component),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "{archive_name} entry path traversal blocked: {display}"
                ));
            }
        }
    }
    if relative.as_os_str().is_empty() {
        return Err(format!("Invalid {archive_name} entry path"));
    }

    let destination = ax_studio_utils::normalize_path(&output_root.join(relative));
    if !destination.starts_with(output_root) {
        return Err(format!(
            "{archive_name} entry path traversal blocked: {display}"
        ));
    }
    Ok(destination)
}

fn ensure_safe_directory(output_root: &Path, directory: &Path) -> Result<(), String> {
    let relative = directory.strip_prefix(output_root).map_err(|_| {
        format!(
            "Archive directory {} is outside extraction root",
            directory.display()
        )
    })?;
    let mut current = output_root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            continue;
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "Archive extraction blocked by symlink directory: {}",
                    current.display()
                ));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(format!(
                    "Archive directory collides with a non-directory: {}",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(|error| {
                    format!(
                        "Failed to create archive directory {}: {error}",
                        current.display()
                    )
                })?;
            }
            Err(error) => {
                return Err(format!(
                    "Failed to inspect archive directory {}: {error}",
                    current.display()
                ));
            }
        }
    }
    Ok(())
}

fn create_safe_archive_file(
    output_root: &Path,
    destination: &Path,
    archive_path: &Path,
) -> Result<fs::File, String> {
    if destination == archive_path {
        return Err("Archive entry cannot overwrite the source archive".to_string());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Archive file has no parent directory".to_string())?;
    ensure_safe_directory(output_root, parent)?;

    match fs::symlink_metadata(destination) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(format!(
                "Archive file collides with a symlink: {}",
                destination.display()
            ));
        }
        Ok(metadata) if !metadata.is_file() => {
            return Err(format!(
                "Archive file collides with a non-file: {}",
                destination.display()
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to inspect archive file: {error}")),
    }

    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(nix::libc::O_NOFOLLOW);
    }
    options.open(destination).map_err(|error| {
        format!(
            "Failed to create archive file {}: {error}",
            destination.display()
        )
    })
}

#[cfg(unix)]
fn set_archive_permissions(path: &Path, mode: Option<u32>) {
    use std::os::unix::fs::PermissionsExt;
    if let Some(mode) = mode {
        // Never restore setuid, setgid, or sticky bits from an untrusted archive.
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode & 0o777));
    }
}

#[cfg(not(unix))]
fn set_archive_permissions(_path: &Path, _mode: Option<u32>) {}

fn replace_existing_archive_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => fs::remove_file(path)
            .map_err(|error| format!("Failed to replace archive symlink: {error}")),
        Ok(_) => Err(format!(
            "Archive symlink collides with an existing path: {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to inspect archive symlink: {error}")),
    }
}

fn extract_tar_gz(file: fs::File, archive_path: &Path, output_root: &Path) -> Result<(), String> {
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let mut budget = ArchiveBudget::new();

    for entry in archive.entries().map_err(|error| error.to_string())? {
        let mut entry = entry.map_err(|error| error.to_string())?;
        let size = entry.header().size().map_err(|error| error.to_string())?;
        budget.record(size)?;
        let entry_path = entry
            .path()
            .map_err(|error| error.to_string())?
            .into_owned();
        let destination = safe_archive_destination(output_root, &entry_path, "Tar")?;
        let entry_type = entry.header().entry_type();

        if entry_type.is_dir() {
            ensure_safe_directory(output_root, &destination)?;
            continue;
        }

        if entry_type.is_file() {
            let mut output = create_safe_archive_file(output_root, &destination, archive_path)?;
            let copied = std::io::copy(&mut entry, &mut output).map_err(|error| {
                format!(
                    "Failed to extract tar entry {}: {error}",
                    entry_path.display()
                )
            })?;
            if copied != size {
                return Err(format!(
                    "Tar entry {} size mismatch: expected {size}, wrote {copied}",
                    entry_path.display()
                ));
            }
            output.flush().map_err(|error| error.to_string())?;
            drop(output);
            set_archive_permissions(&destination, entry.header().mode().ok());
            continue;
        }

        if entry_type.is_symlink() {
            let link_target = entry
                .link_name()
                .map_err(|error| format!("Invalid symlink target: {error}"))?
                .ok_or_else(|| "Symlink entry missing target".to_string())?
                .into_owned();
            if link_target.is_absolute() {
                return Err(format!(
                    "Tar symlink target escapes extraction root: {}",
                    link_target.display()
                ));
            }
            let link_parent = destination.parent().unwrap_or(output_root);
            ensure_safe_directory(output_root, link_parent)?;
            let lexical_target = ax_studio_utils::normalize_path(&link_parent.join(&link_target));
            let resolved_target = normalize_with_existing_ancestor(link_parent.join(&link_target));
            if !lexical_target.starts_with(output_root) || !resolved_target.starts_with(output_root)
            {
                return Err(format!(
                    "Tar symlink target escapes extraction root: {} -> {}",
                    entry_path.display(),
                    link_target.display()
                ));
            }
            replace_existing_archive_symlink(&destination)?;
            #[cfg(unix)]
            std::os::unix::fs::symlink(&link_target, &destination).map_err(|error| {
                format!(
                    "Failed to create symlink {} -> {}: {error}",
                    destination.display(),
                    link_target.display()
                )
            })?;
            #[cfg(windows)]
            std::os::windows::fs::symlink_file(&link_target, &destination).map_err(|error| {
                format!(
                    "Failed to create symlink {} -> {}: {error}",
                    destination.display(),
                    link_target.display()
                )
            })?;
            continue;
        }

        return Err(format!(
            "Unsupported tar entry type for {}",
            entry_path.display()
        ));
    }
    Ok(())
}

fn extract_zip(file: fs::File, archive_path: &Path, output_root: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "Archive contains more than {MAX_ARCHIVE_ENTRIES} entries"
        ));
    }
    let mut budget = ArchiveBudget::new();

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        budget.record(entry.size())?;
        let entry_path = entry
            .enclosed_name()
            .ok_or_else(|| "Invalid zip entry path".to_string())?;
        let destination = safe_archive_destination(output_root, &entry_path, "Zip")?;
        let mode = entry.unix_mode();
        let file_type = mode.unwrap_or_default() & 0o170000;
        if file_type == 0o120000 {
            return Err(format!(
                "Zip symlink entries are not supported: {}",
                entry.name()
            ));
        }

        if entry.is_dir() {
            ensure_safe_directory(output_root, &destination)?;
            continue;
        }
        if file_type != 0 && file_type != 0o100000 {
            return Err(format!("Unsupported zip entry type: {}", entry.name()));
        }

        let expected_size = entry.size();
        let mut output = create_safe_archive_file(output_root, &destination, archive_path)?;
        let copied = std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Failed to extract zip entry: {error}"))?;
        if copied != expected_size {
            return Err(format!(
                "Zip entry {} size mismatch: expected {expected_size}, wrote {copied}",
                entry.name()
            ));
        }
        output.flush().map_err(|error| error.to_string())?;
        drop(output);
        set_archive_permissions(&destination, mode);
    }
    Ok(())
}

fn extract_archive(
    archive_path: &Path,
    output_root: &Path,
    kind: ArchiveKind,
) -> Result<(), String> {
    // Use a short path on Windows for archives stored below paths with spaces.
    #[cfg(windows)]
    let file = if let Some(short_path) = ax_studio_utils::path::get_short_path(archive_path) {
        fs::File::open(short_path).map_err(|error| error.to_string())?
    } else {
        fs::File::open(archive_path).map_err(|error| error.to_string())?
    };
    #[cfg(not(windows))]
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;

    match kind {
        ArchiveKind::TarGz => extract_tar_gz(file, archive_path, output_root),
        ArchiveKind::Zip => extract_zip(file, archive_path, output_root),
    }
}

#[tauri::command]
/// Extract a bounded `.tar.gz` or `.zip` archive into an app-data subdirectory.
/// Accepts either a wrapped `request` object or flat `path`/`output_dir`/`outputDir` args.
pub async fn decompress<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: Option<String>,
    output_dir: Option<String>,
    #[allow(non_snake_case)] outputDir: Option<String>,
    request: Option<DecompressRequest>,
) -> Result<(), String> {
    let resolved_output = output_dir.or(outputDir);
    let (path, output_dir) = if let Some(req) = request {
        req.into_parts()?
    } else {
        match (path, resolved_output) {
            (Some(path), Some(output)) if !path.is_empty() && !output.is_empty() => (path, output),
            _ => return Err("decompress error: Invalid argument".to_string()),
        }
    };

    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app);
    fs::create_dir_all(&app_data_folder)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;
    let canonical_app_data = app_data_folder
        .canonicalize()
        .map(|path| ax_studio_utils::normalize_path(&path))
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    let archive_path = resolve_archive_boundary_path(&canonical_app_data, &path, "archive path")?;
    let archive_path = archive_path
        .canonicalize()
        .map(|path| ax_studio_utils::normalize_path(&path))
        .map_err(|error| format!("Failed to resolve archive path: {error}"))?;
    if !archive_path.starts_with(&canonical_app_data) || !archive_path.is_file() {
        return Err("Archive must be a file inside app_data_folder".to_string());
    }
    let metadata = fs::metadata(&archive_path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_ARCHIVE_INPUT_BYTES {
        return Err(format!(
            "Archive exceeds the {MAX_ARCHIVE_INPUT_BYTES}-byte input limit"
        ));
    }
    let kind = archive_kind(&archive_path)?;

    let output_root =
        resolve_archive_boundary_path(&canonical_app_data, &output_dir, "output directory")?;
    let output_was_new = !output_root.exists();
    if output_root.exists() && !output_root.is_dir() {
        return Err("Archive output path is not a directory".to_string());
    }
    fs::create_dir_all(&output_root)
        .map_err(|error| format!("Failed to create output directory: {error}"))?;
    let output_root = output_root
        .canonicalize()
        .map(|path| ax_studio_utils::normalize_path(&path))
        .map_err(|error| format!("Failed to resolve output directory: {error}"))?;
    if !output_root.starts_with(&canonical_app_data) {
        return Err("Archive output directory escaped app_data_folder".to_string());
    }

    tokio::task::spawn_blocking(move || {
        let result = extract_archive(&archive_path, &output_root, kind);
        if result.is_err() && output_was_new {
            if let Err(error) = fs::remove_dir_all(&output_root) {
                log::warn!(
                    "Failed to clean partial archive output {}: {error}",
                    output_root.display()
                );
            }
        }
        result
    })
    .await
    .map_err(|error| format!("Archive extraction task failed: {error}"))?
}

#[cfg(test)]
mod archive_budget_tests {
    use super::*;

    #[test]
    fn rejects_oversized_entry_and_expanded_total() {
        let mut budget = ArchiveBudget::new();
        assert!(budget.record(MAX_ARCHIVE_ENTRY_BYTES + 1).is_err());

        budget.expanded_bytes = MAX_ARCHIVE_EXPANDED_BYTES;
        assert!(budget.record(1).is_err());
    }

    #[test]
    fn rejects_excess_entry_count() {
        let mut budget = ArchiveBudget::new();
        budget.entries = MAX_ARCHIVE_ENTRIES;
        assert!(budget.record(0).is_err());
    }
}

// rfd native file dialog
#[cfg(desktop)]
fn allow_selected_file<R: Runtime>(
    app: &AppHandle<R>,
    path: &std::path::Path,
) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|error| format!("Failed to grant access to selected file: {error}"))
}

#[cfg(desktop)]
fn allow_selected_directory<R: Runtime>(
    app: &AppHandle<R>,
    path: &std::path::Path,
) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(path, true)
        .map_err(|error| format!("Failed to grant access to selected directory: {error}"))
}

#[tauri::command]
/// Open the native file or directory picker and return the selected path values.
#[cfg(desktop)]
pub async fn open_dialog<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    options: Option<DialogOpenOptions>,
) -> Result<Option<serde_json::Value>, String> {
    let mut dialog = AsyncFileDialog::new();

    if let Some(opts) = options {
        // Set default path
        if let Some(path) = opts.default_path {
            dialog = dialog.set_directory(&path);
        }

        // Set filters
        if let Some(filters) = opts.filters {
            for filter in filters {
                let extensions: Vec<&str> = filter.extensions.iter().map(|s| s.as_str()).collect();
                dialog = dialog.add_filter(&filter.name, &extensions);
            }
        }

        // Handle directory vs file selection
        if opts.directory == Some(true) {
            let result = dialog.pick_folder().await;
            return match result {
                Some(folder) => {
                    allow_selected_directory(&app, folder.path())?;
                    let canonical = canonical_selected_path(folder.path(), true)?;
                    let mut approved = state.approved_read_directories.lock().await;
                    insert_bounded_approved_paths(&mut approved, [canonical])?;
                    Ok(Some(serde_json::Value::String(
                        folder.path().to_string_lossy().to_string(),
                    )))
                }
                None => Ok(None),
            };
        }

        // Handle multiple file selection
        if opts.multiple == Some(true) {
            let result = dialog.pick_files().await;
            return match result {
                Some(files) => {
                    let canonical_paths = files
                        .iter()
                        .map(|file| canonical_selected_path(file.path(), false))
                        .collect::<Result<Vec<_>, _>>()?;
                    {
                        let mut approved = state.approved_read_files.lock().await;
                        insert_bounded_approved_paths(&mut approved, canonical_paths)?;
                    }
                    let paths = files
                        .iter()
                        .map(|file| {
                            allow_selected_file(&app, file.path())?;
                            Ok(file.path().to_string_lossy().to_string())
                        })
                        .collect::<Result<Vec<_>, String>>()?;
                    Ok(Some(serde_json::Value::Array(
                        paths.into_iter().map(serde_json::Value::String).collect(),
                    )))
                }
                None => Ok(None),
            };
        }
    }

    // Default: single file selection
    let result = dialog.pick_file().await;
    match result {
        Some(file) => {
            allow_selected_file(&app, file.path())?;
            let canonical = canonical_selected_path(file.path(), false)?;
            let mut approved = state.approved_read_files.lock().await;
            insert_bounded_approved_paths(&mut approved, [canonical])?;
            Ok(Some(serde_json::Value::String(
                file.path().to_string_lossy().to_string(),
            )))
        }
        None => Ok(None),
    }
}

#[tauri::command]
/// Open the native save dialog and approve the returned path for a later write.
#[cfg(desktop)]
pub async fn save_dialog(
    state: State<'_, AppState>,
    options: Option<DialogOpenOptions>,
) -> Result<Option<String>, String> {
    let mut dialog = AsyncFileDialog::new();

    if let Some(opts) = options {
        // If default_path has a file extension treat it as "directory + suggested filename".
        // e.g. "diagram.svg" → set_file_name("diagram.svg")
        //      "/home/user/docs" → set_directory("/home/user/docs")
        if let Some(path) = opts.default_path {
            let p = std::path::Path::new(&path);
            if p.extension().is_some() {
                if let Some(parent) = p.parent() {
                    if parent != std::path::Path::new("") {
                        dialog = dialog.set_directory(parent);
                    }
                }
                if let Some(name) = p.file_name() {
                    dialog = dialog.set_file_name(&*name.to_string_lossy());
                }
            } else {
                dialog = dialog.set_directory(&path);
            }
        }

        // Set filters
        if let Some(filters) = opts.filters {
            for filter in filters {
                let extensions: Vec<&str> = filter.extensions.iter().map(|s| s.as_str()).collect();
                dialog = dialog.add_filter(&filter.name, &extensions);
            }
        }
    }

    let result = dialog.save_file().await;
    let save_path = result.map(|file| file.path().to_string_lossy().to_string());

    if let Some(path) = &save_path {
        let mut approved_save_paths = state.approved_save_paths.lock().await;
        approve_save_target(&mut approved_save_paths, path)?;
    }

    Ok(save_path)
}

/// Write binary data (base64-encoded) to a file path.
/// Used by the diagram export flow on platforms where blob: anchor downloads
/// do not work (macOS WKWebView, Tauri WebView2 on Windows).
#[tauri::command]
/// Write base64-encoded binary data to a path previously approved by `save_dialog`.
pub async fn write_binary_file(
    state: State<'_, AppState>,
    path: String,
    base64_data: String,
) -> Result<(), String> {
    let maximum_encoded_bytes = MAX_BINARY_WRITE_BYTES
        .checked_mul(4)
        .and_then(|bytes| bytes.checked_div(3))
        .and_then(|bytes| bytes.checked_add(4))
        .unwrap_or(usize::MAX);
    if base64_data.len() > maximum_encoded_bytes {
        return Err(format!(
            "write_binary_file: decoded data exceeds the {MAX_BINARY_WRITE_BYTES}-byte limit"
        ));
    }
    let data = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| e.to_string())?;
    if data.len() > MAX_BINARY_WRITE_BYTES {
        return Err(format!(
            "write_binary_file: decoded data exceeds the {MAX_BINARY_WRITE_BYTES}-byte limit"
        ));
    }
    let normalized_path = {
        let mut approved_save_paths = state.approved_save_paths.lock().await;
        consume_approved_save_target(&mut approved_save_paths, &path)?
    };
    tokio::task::spawn_blocking(move || write_atomically(&normalized_path, &data))
        .await
        .map_err(|e| format!("write_binary_file task join error: {e}"))?
}

#[tauri::command]
/// Write text data to a path previously approved by `save_dialog`.
pub async fn write_text_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    ensure_payload_limit("write_text_file", content.len(), MAX_TEXT_FILE_BYTES)?;
    let normalized_path = {
        let mut approved_save_paths = state.approved_save_paths.lock().await;
        consume_approved_save_target(&mut approved_save_paths, &path)?
    };
    tokio::task::spawn_blocking(move || write_atomically(&normalized_path, content.as_bytes()))
        .await
        .map_err(|e| format!("write_text_file task join error: {e}"))?
}
