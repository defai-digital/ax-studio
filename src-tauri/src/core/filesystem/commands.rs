// Filesystem commands retained for the current desktop bridge surface.
// It's added to ensure the legacy implementation from frontend still functions before removal.
use super::helpers::resolve_path;
use super::models::{DialogOpenOptions, FileStat};
use crate::core::state::AppState;
use rfd::AsyncFileDialog;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::State;
use tauri::{Manager, Runtime};
use tokio::io::AsyncReadExt;
use tokio::sync::oneshot;

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
    Legacy { args: String },
    Typed { path: String },
}

impl FileStatRequest {
    fn into_path(self) -> Result<String, String> {
        match self {
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

fn ax_studio_config_dir(home: &Path) -> PathBuf {
    home.join(".ax-studio")
}

fn legacy_config_dir(home: &Path) -> PathBuf {
    home.join(".ax-fabric")
}

fn preferred_akidb_config_path(home: &Path) -> PathBuf {
    ax_studio_config_dir(home).join("config.yaml")
}

fn legacy_akidb_config_path(home: &Path) -> PathBuf {
    legacy_config_dir(home).join("config.yaml")
}

fn preferred_akidb_status_path(home: &Path) -> PathBuf {
    ax_studio_config_dir(home).join("status.json")
}

fn legacy_akidb_status_path(home: &Path) -> PathBuf {
    legacy_config_dir(home).join("status.json")
}

const AKIDB_SYNC_TIMEOUT: Duration = Duration::from_secs(300);

fn migrate_legacy_akidb_file(
    _home: &Path,
    legacy_path: &Path,
    preferred_path: &Path,
) -> Result<(), String> {
    if preferred_path.exists() || !legacy_path.exists() {
        return Ok(());
    }

    if let Some(parent) = preferred_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::copy(legacy_path, preferred_path).map_err(|e| {
        format!(
            "Failed to migrate legacy knowledge-base file {} to {}: {e}",
            legacy_path.display(),
            preferred_path.display()
        )
    })?;
    Ok(())
}

pub(crate) fn normalize_save_target_path(path: &str) -> Result<PathBuf, String> {
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

    let canonical_parent = parent
        .canonicalize()
        .unwrap_or_else(|_| ax_studio_utils::normalize_path(Path::new(parent)));
    Ok(canonical_parent.join(file_name))
}

pub(crate) fn approve_save_target(
    approved_save_paths: &mut std::collections::HashSet<PathBuf>,
    path: &str,
) -> Result<(), String> {
    let normalized = normalize_save_target_path(path)?;
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
    let source = resolve_path(app_handle.clone(), &source_arg)?;
    let destination = resolve_path(app_handle, &destination_arg)?;

    if !source.starts_with(&app_data_folder) {
        return Err(format!(
            "mv error: source path {} is not under app data folder",
            source.display()
        ));
    }

    if !destination.starts_with(&app_data_folder) {
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
/// Join path segments onto a base path under the app data folder.
pub fn join_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: JoinPathRequest,
) -> Result<String, String> {
    let args = request.into_parts()?;
    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app_handle.clone());
    let path = resolve_path(app_handle, &args[0])?;
    let joined_path = args[1..].iter().fold(path, |acc, part| acc.join(part));
    // Normalize to resolve any ".." segments from subsequent args
    let normalized = ax_studio_utils::normalize_path(&joined_path);
    if !normalized.starts_with(&app_data_folder) {
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
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
/// Atomically write a UTF-8 text file inside the app data folder.
pub fn write_file_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: PathPairRequest,
) -> Result<(), String> {
    let (path_arg, content) = request.into_paths("write_file_sync")?;
    let path = resolve_path(app_handle, &path_arg)?;
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())
}

#[tauri::command]
/// List directory entries for a path inside the app data folder.
pub fn readdir_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: SinglePathRequest,
) -> Result<Vec<String>, String> {
    let path = resolve_path(app_handle, &request.into_path("read_dir_sync")?)?;
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let paths: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path().to_string_lossy().to_string())
        .collect();
    Ok(paths)
}

#[tauri::command]
/// Validate and atomically write YAML content under the app data folder.
pub fn write_yaml(
    app: tauri::AppHandle<impl Runtime>,
    request: WriteYamlRequest,
) -> Result<(), String> {
    let (data, save_path) = request.into_parts()?;
    // YAML writes are restricted to the app data directory and validated before replace.
    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app.clone());
    let save_path = ax_studio_utils::normalize_path(&app_data_folder.join(save_path));
    if !save_path.starts_with(&app_data_folder) {
        return Err(format!(
            "Error: save path {} is not under app_data_folder {}",
            save_path.to_string_lossy(),
            app_data_folder.to_string_lossy(),
        ));
    }
    let tmp_path = save_path.with_extension("yaml.tmp");
    let _: serde_yaml::Value = serde_yaml::from_str(&data).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &save_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
/// Read a YAML file from the app data folder and return it as JSON.
pub fn read_yaml<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SinglePathRequest,
) -> Result<serde_json::Value, String> {
    let path = request.into_path("read_yaml")?;
    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app.clone());
    let path = ax_studio_utils::normalize_path(&app_data_folder.join(path));
    if !path.starts_with(&app_data_folder) {
        return Err(format!(
            "Error: path {} is not under app_data_folder {}",
            path.to_string_lossy(),
            app_data_folder.to_string_lossy(),
        ));
    }
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);
    let data: serde_json::Value = serde_yaml::from_reader(reader).map_err(|e| e.to_string())?;
    Ok(data)
}

#[tauri::command]
/// Extract a `.tar.gz` or `.zip` archive into an app-data subdirectory.
pub fn decompress<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: DecompressRequest,
) -> Result<(), String> {
    let (path, output_dir) = request.into_parts()?;
    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app.clone());
    let path_buf = ax_studio_utils::normalize_path(&app_data_folder.join(&path));

    let output_dir_buf = ax_studio_utils::normalize_path(&app_data_folder.join(&output_dir));
    if !output_dir_buf.starts_with(&app_data_folder) {
        return Err(format!(
            "Error: output directory {} is not under app_data_folder {}",
            output_dir_buf.to_string_lossy(),
            app_data_folder.to_string_lossy(),
        ));
    }

    // Ensure output directory exists
    fs::create_dir_all(&output_dir_buf).map_err(|e| {
        format!(
            "Failed to create output directory {}: {}",
            output_dir_buf.to_string_lossy(),
            e
        )
    })?;

    // Use short path on Windows to handle paths with spaces
    #[cfg(windows)]
    let file = {
        if let Some(short_path) = ax_studio_utils::path::get_short_path(&path_buf) {
            fs::File::open(&short_path).map_err(|e| e.to_string())?
        } else {
            fs::File::open(&path_buf).map_err(|e| e.to_string())?
        }
    };

    #[cfg(not(windows))]
    let file = fs::File::open(&path_buf).map_err(|e| e.to_string())?;
    if path.ends_with(".tar.gz") {
        let tar = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(tar);
        for entry in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let entry_path_string = entry
                .path()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .to_string();
            let full_path =
                ax_studio_utils::normalize_path(&output_dir_buf.join(&entry_path_string));
            if !full_path.starts_with(&output_dir_buf) {
                return Err(format!(
                    "Tar entry path traversal blocked: {}",
                    entry_path_string
                ));
            }
            // Ensure parent directories exist — tar archives may omit
            // intermediate directory entries (e.g. llama.cpp releases).
            if let Some(parent) = full_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!(
                        "Failed to create parent directory {}: {e}",
                        parent.display()
                    )
                })?;
            }
            entry.unpack(&full_path).map_err(|e| {
                format!(
                    "failed to unpack `{}` into `{}`: {e}",
                    entry_path_string,
                    full_path.display()
                )
            })?;
        }
    } else if path.ends_with(".zip") {
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
            let entry_path = entry
                .enclosed_name()
                .ok_or_else(|| "Invalid zip entry path".to_string())?;
            let outpath = ax_studio_utils::normalize_path(&output_dir_buf.join(entry_path));
            if !outpath.starts_with(&output_dir_buf) {
                return Err(format!(
                    "Zip entry path traversal blocked: {}",
                    entry.name()
                ));
            }

            if entry.name().ends_with('/') {
                std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = outpath.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Some(mode) = entry.unix_mode() {
                        let _ = std::fs::set_permissions(
                            &outpath,
                            std::fs::Permissions::from_mode(mode),
                        );
                    }
                }
            }
        }
    } else {
        return Err("Unsupported file format. Only .tar.gz and .zip are supported.".to_string());
    }

    Ok(())
}

// rfd native file dialog
#[tauri::command]
/// Open the native file or directory picker and return the selected path values.
pub async fn open_dialog(
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
            return Ok(result.map(|folder| {
                serde_json::Value::String(folder.path().to_string_lossy().to_string())
            }));
        }

        // Handle multiple file selection
        if opts.multiple == Some(true) {
            let result = dialog.pick_files().await;
            return Ok(result.map(|files| {
                let paths: Vec<String> = files
                    .iter()
                    .map(|f| f.path().to_string_lossy().to_string())
                    .collect();
                serde_json::to_value(paths).unwrap_or_else(|e| {
                    log::error!("Failed to serialize selected dialog paths: {e}");
                    serde_json::Value::Array(vec![])
                })
            }));
        }
    }

    // Default: single file selection
    let result = dialog.pick_file().await;
    Ok(result.map(|file| serde_json::Value::String(file.path().to_string_lossy().to_string())))
}

#[tauri::command]
/// Open the native save dialog and approve the returned path for a later write.
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

/// Write binary data (hex-encoded) to a file path.
/// Used by the diagram export flow on platforms where blob: anchor downloads
/// do not work (macOS WKWebView, Tauri WebView2 on Windows).
#[tauri::command]
/// Write hex-encoded binary data to a path previously approved by `save_dialog`.
pub async fn write_binary_file(
    state: State<'_, AppState>,
    path: String,
    hex_data: String,
) -> Result<(), String> {
    let data = hex::decode(&hex_data).map_err(|e| e.to_string())?;
    let normalized_path = {
        let mut approved_save_paths = state.approved_save_paths.lock().await;
        consume_approved_save_target(&mut approved_save_paths, &path)?
    };
    std::fs::write(&normalized_path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
/// Write text data to a path previously approved by `save_dialog`.
pub async fn write_text_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let normalized_path = {
        let mut approved_save_paths = state.approved_save_paths.lock().await;
        consume_approved_save_target(&mut approved_save_paths, &path)?
    };
    std::fs::write(&normalized_path, content).map_err(|e| e.to_string())
}

// Knowledge-base daemon config management.
// Uses dirs crate to resolve home directory; bypasses app_data_folder scope restriction
// because the external daemon owns its config path outside the app data folder.

/// Top-level legacy fabric-ingest config matching the Zod schema in fabric-ingest/config-loader.ts
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct AkidbConfig {
    #[serde(default)]
    pub fabric: FabricSection,
    #[serde(default)]
    pub akidb: AkidbSection,
    #[serde(default)]
    pub ingest: IngestSection,
    #[serde(default)]
    pub embedder: EmbedderSection,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<ScheduleSection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunking: Option<ChunkingSection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<LifecycleSection>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct FabricSection {
    #[serde(default = "default_data_root")]
    pub data_root: String,
    #[serde(default = "default_max_storage_gb")]
    pub max_storage_gb: f64,
}

impl Default for FabricSection {
    fn default() -> Self {
        Self {
            data_root: default_data_root(),
            max_storage_gb: default_max_storage_gb(),
        }
    }
}

fn default_data_root() -> String {
    "~/.ax-studio/data".to_string()
}
fn default_max_storage_gb() -> f64 {
    50.0
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct AkidbSection {
    #[serde(default = "default_akidb_root")]
    pub root: String,
    #[serde(default = "default_collection")]
    pub collection: String,
    #[serde(default = "default_metric")]
    pub metric: String,
    #[serde(default = "default_dimension")]
    pub dimension: u32,
}

impl Default for AkidbSection {
    fn default() -> Self {
        Self {
            root: default_akidb_root(),
            collection: default_collection(),
            metric: default_metric(),
            dimension: default_dimension(),
        }
    }
}

fn default_akidb_root() -> String {
    "~/.ax-studio/data/akidb".to_string()
}
fn default_collection() -> String {
    "default".to_string()
}
fn default_metric() -> String {
    "cosine".to_string()
}
fn default_dimension() -> u32 {
    1536
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct IngestSection {
    #[serde(default)]
    pub sources: Vec<IngestSource>,
    #[serde(default)]
    pub chunking: IngestChunking,
}

impl Default for IngestSection {
    fn default() -> Self {
        Self {
            sources: vec![],
            chunking: IngestChunking::default(),
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct IngestSource {
    pub path: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct IngestChunking {
    #[serde(default = "default_chunk_size")]
    pub chunk_size: u32,
    #[serde(default = "default_overlap")]
    pub overlap: f64,
}

impl Default for IngestChunking {
    fn default() -> Self {
        Self {
            chunk_size: default_chunk_size(),
            overlap: default_overlap(),
        }
    }
}

fn default_chunk_size() -> u32 {
    2800
}
fn default_overlap() -> f64 {
    0.15
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct EmbedderSection {
    #[serde(default = "default_embedder_type", rename = "type")]
    pub embedder_type: String,
    #[serde(default = "default_model_id")]
    pub model_id: String,
    #[serde(default = "default_embedder_dimension")]
    pub dimension: u32,
    #[serde(default = "default_batch_size")]
    pub batch_size: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
}

impl Default for EmbedderSection {
    fn default() -> Self {
        Self {
            embedder_type: default_embedder_type(),
            model_id: default_model_id(),
            dimension: default_embedder_dimension(),
            batch_size: default_batch_size(),
            timeout_ms: Some(120000),
            base_url: Some("http://127.0.0.1:18080".to_string()),
            api_key: None,
            api_key_env: None,
        }
    }
}

fn default_embedder_type() -> String {
    "http".to_string()
}
fn default_model_id() -> String {
    "gte-qwen2-1.5b-instruct-q4_k_m".to_string()
}
fn default_embedder_dimension() -> u32 {
    1536
}
fn default_batch_size() -> u32 {
    64
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct ScheduleSection {
    #[serde(default = "default_interval_minutes")]
    pub interval_minutes: u32,
}

impl Default for ScheduleSection {
    fn default() -> Self {
        Self {
            interval_minutes: default_interval_minutes(),
        }
    }
}

fn default_interval_minutes() -> u32 {
    60
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct ChunkingSection {
    #[serde(default = "default_chunking_strategy")]
    pub default_strategy: String,
    #[serde(default = "default_max_chunk_size")]
    pub max_chunk_size: u32,
    #[serde(default = "default_chunking_overlap")]
    pub overlap: u32,
}

fn default_chunking_strategy() -> String {
    "structured".to_string()
}
fn default_max_chunk_size() -> u32 {
    2800
}
fn default_chunking_overlap() -> u32 {
    200
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct LifecycleSection {
    #[serde(default = "default_store_chunk_text")]
    pub store_chunk_text: bool,
    #[serde(default = "default_compact_threshold")]
    pub compact_threshold: u32,
    #[serde(default = "default_archive_retention_days")]
    pub archive_retention_days: u32,
}

fn default_store_chunk_text() -> bool {
    true
}
fn default_compact_threshold() -> u32 {
    50
}
fn default_archive_retention_days() -> u32 {
    7
}

/// Daemon status read from the preferred AX Studio path, with legacy fallback.
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct AkidbStatus {
    pub status: String,
    pub config_loaded: bool,
    #[serde(default)]
    pub data_folder: Option<String>,
    #[serde(default)]
    pub last_sync_at: Option<String>,
    #[serde(default)]
    pub total_files: u64,
    #[serde(default)]
    pub indexed_files: u64,
    #[serde(default)]
    pub pending_files: u64,
    #[serde(default)]
    pub error_files: u64,
    #[serde(default)]
    pub daemon_pid: Option<u32>,
}

/// Read the AX Studio knowledge-base config, migrating a legacy config file if needed.
#[tauri::command]
/// Read the knowledge-base config, migrating from the legacy path if needed.
pub fn read_akidb_config() -> Result<Option<AkidbConfig>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let config_path = preferred_akidb_config_path(&home);
    let legacy_path = legacy_akidb_config_path(&home);

    migrate_legacy_akidb_file(&home, &legacy_path, &config_path)?;

    let path_to_read = if config_path.exists() {
        config_path
    } else {
        return Ok(None);
    };

    let file = fs::File::open(&path_to_read).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);
    let config: AkidbConfig = serde_yaml::from_reader(reader).map_err(|e| {
        format!(
            "Failed to parse knowledge-base config {}: {e}",
            path_to_read.display()
        )
    })?;
    Ok(Some(config))
}

/// Write the AX Studio knowledge-base config to the preferred AX Studio path
/// and mirror to the legacy `~/.ax-fabric/config.yaml` so the daemon picks it up.
#[tauri::command]
/// Write the knowledge-base config to the preferred path and mirror the legacy file.
pub fn write_akidb_config(config: AkidbConfig) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let yaml = serde_yaml::to_string(&config)
        .map_err(|e| format!("Failed to serialize knowledge-base config: {e}"))?;

    // Write to preferred path (~/.ax-studio/config.yaml)
    let config_dir = ax_studio_config_dir(&home);
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let config_path = preferred_akidb_config_path(&home);
    fs::write(&config_path, &yaml).map_err(|e| e.to_string())?;

    // Mirror to legacy path (~/.ax-fabric/config.yaml) so the daemon reads it
    let legacy_dir = legacy_config_dir(&home);
    fs::create_dir_all(&legacy_dir).map_err(|e| e.to_string())?;
    let legacy_path = legacy_akidb_config_path(&home);
    fs::write(&legacy_path, &yaml).map_err(|e| e.to_string())?;

    Ok(())
}

/// Read the AX Studio knowledge-base daemon status.
/// The daemon writes to `~/.ax-fabric/status.json`, so we read from there directly.
#[tauri::command]
/// Read the knowledge-base daemon status JSON, if present.
pub fn read_akidb_status() -> Result<Option<AkidbStatus>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let status_path = legacy_akidb_status_path(&home);

    if !status_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&status_path).map_err(|e| e.to_string())?;
    let status: AkidbStatus = serde_json::from_str(&content).map_err(|e| {
        format!(
            "Failed to parse daemon status {}: {e}",
            status_path.display()
        )
    })?;
    Ok(Some(status))
}

/// Result returned by the `akidb_sync_now` command.
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct AkidbSyncResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Resolved command and arguments for spawning the fabric-ingest CLI.
struct FabricCliCommand {
    program: String,
    args: Vec<String>,
}

/// Resolve the fabric-ingest CLI command from the MCP config.
/// Falls back to `npx -y @ax-studio/fabric-ingest` if the config is missing.
fn resolve_fabric_cli_command<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<FabricCliCommand, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    path.push("mcp_config.json");

    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if let Ok(configs) = serde_json::from_str::<serde_json::Value>(&content) {
            // MCP config nests servers under "mcpServers"
            let servers = configs.get("mcpServers").or(Some(&configs));
            if let Some(servers) = servers {
                if let Some(server) = servers
                    .get("ax-studio")
                    .or_else(|| servers.get("ax-fabric"))
                {
                    let command = server
                        .get("command")
                        .and_then(|v| v.as_str())
                        .unwrap_or("npx")
                        .to_string();
                    let args: Vec<String> = server
                        .get("args")
                        .and_then(|a| a.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                // Strip the MCP-specific trailing args ("mcp", "server")
                                // since we want to invoke "daemon --once" instead
                                .take_while(|a| a != "mcp")
                                .collect()
                        })
                        .unwrap_or_default();
                    return Ok(FabricCliCommand {
                        program: command,
                        args,
                    });
                }
            }
        }
    }

    // Local fallback for development: look for a sibling ax-fabric checkout near the current repo.
    if let Ok(repo_root) = std::env::current_dir() {
        if let Some(parent) = repo_root.parent() {
            let local_cli = parent
                .join("ax-fabric")
                .join("packages/fabric-ingest/dist/cli.js");
            if local_cli.exists() {
                log::info!(
                    "resolve_fabric_cli_command: using local CLI at {}",
                    local_cli.display()
                );
                return Ok(FabricCliCommand {
                    program: "node".to_string(),
                    args: vec![local_cli.to_string_lossy().to_string()],
                });
            }
        }
    }

    Err(
        "Could not resolve fabric-ingest CLI. Ensure the ax-studio MCP server is configured or the local fabric-ingest package is built."
            .to_string(),
    )
}

/// Trigger a one-shot knowledge-base sync by spawning the fabric-ingest daemon.
#[tauri::command]
/// Run a one-shot knowledge-base sync through the fabric-ingest daemon.
pub async fn akidb_sync_now<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<AkidbSyncResult, String> {
    {
        let cancellation = state.akidb_sync_cancellation.lock().await;
        if cancellation.is_some() {
            return Err("A knowledge-base sync is already running".to_string());
        }
    }

    let cli = resolve_fabric_cli_command(&app)?;
    let (cancel_tx, mut cancel_rx) = oneshot::channel();

    {
        let mut cancellation = state.akidb_sync_cancellation.lock().await;
        if cancellation.is_some() {
            return Err("A knowledge-base sync is already running".to_string());
        }
        *cancellation = Some(cancel_tx);
    }

    log::info!(
        "akidb_sync_now: spawning {} {:?} daemon --once",
        cli.program,
        cli.args
    );

    let sync_result = async {
        let mut child = tokio::process::Command::new(&cli.program)
        .args(&cli.args)
        .arg("daemon")
        .arg("--once")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn daemon: {e}"))?;

        let stdout_task = child.stdout.take().map(|mut stdout| {
            tauri::async_runtime::spawn(async move {
                let mut buffer = Vec::new();
                let _ = stdout.read_to_end(&mut buffer).await;
                buffer
            })
        });
        let stderr_task = child.stderr.take().map(|mut stderr| {
            tauri::async_runtime::spawn(async move {
                let mut buffer = Vec::new();
                let _ = stderr.read_to_end(&mut buffer).await;
                buffer
            })
        });

        let status = tokio::select! {
            wait_result = child.wait() => {
                wait_result.map_err(|e| format!("Failed while waiting for daemon: {e}"))?
            }
            _ = tokio::time::sleep(AKIDB_SYNC_TIMEOUT) => {
                log::warn!("akidb_sync_now: timed out after {:?}", AKIDB_SYNC_TIMEOUT);
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Err(format!("Knowledge-base sync timed out after {} seconds", AKIDB_SYNC_TIMEOUT.as_secs()));
            }
            _ = &mut cancel_rx => {
                log::info!("akidb_sync_now: cancellation requested");
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Err("Knowledge-base sync cancelled".to_string());
            }
        };

        let stdout = match stdout_task {
            Some(task) => match task.await {
                Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                Err(e) => {
                    log::warn!("akidb_sync_now: stdout collection task failed: {e}");
                    String::new()
                }
            },
            None => String::new(),
        };
        let stderr = match stderr_task {
            Some(task) => match task.await {
                Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                Err(e) => {
                    log::warn!("akidb_sync_now: stderr collection task failed: {e}");
                    String::new()
                }
            },
            None => String::new(),
        };
        let success = status.success();

        // Always log stdout/stderr to a debug file for troubleshooting
        let debug_path = std::env::temp_dir().join("akidb-tauri-sync.log");
        let debug_msg = format!(
            "[{}] exit={} success={}\n--- stdout ---\n{}\n--- stderr ---\n{}\n---\n",
            chrono::Utc::now().to_rfc3339(),
            status,
            success,
            stdout,
            stderr
        );
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&debug_path)
            .and_then(|mut f| {
                use std::io::Write;
                f.write_all(debug_msg.as_bytes())
            });

        if success {
            log::info!("akidb_sync_now: completed successfully");
        } else {
            log::warn!("akidb_sync_now: exited with status {}", status);
            log::warn!("akidb_sync_now stderr: {stderr}");
        }

        Ok(AkidbSyncResult {
            success,
            stdout,
            stderr,
        })
    }
    .await;

    {
        let mut cancellation = state.akidb_sync_cancellation.lock().await;
        *cancellation = None;
    }

    sync_result
}

#[tauri::command]
/// Cancel the currently running knowledge-base sync, if one exists.
pub async fn cancel_akidb_sync(state: State<'_, AppState>) -> Result<bool, String> {
    let mut cancellation = state.akidb_sync_cancellation.lock().await;
    match cancellation.take() {
        Some(sender) => sender
            .send(())
            .map(|_| true)
            .map_err(|_| "Knowledge-base sync was not running".to_string()),
        None => Ok(false),
    }
}
