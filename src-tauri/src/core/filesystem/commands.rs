// WARNING: These APIs will be deprecated soon due to removing FS API access from frontend.
// It's added to ensure the legacy implementation from frontend still functions before removal.
use super::helpers::resolve_path;
use super::models::{DialogOpenOptions, FileStat};
use super::service;
use crate::core::state::AppState;
use rfd::AsyncFileDialog;
use std::path::Path;
use tauri::State;
use tauri::{Manager, Runtime};

#[tauri::command]
pub fn rm<R: Runtime>(app_handle: tauri::AppHandle<R>, args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("rm error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    service::rm(&path)
}

#[tauri::command]
pub fn mkdir<R: Runtime>(app_handle: tauri::AppHandle<R>, args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("mkdir error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    service::mkdir(&path)
}

#[tauri::command]
pub fn mv<R: Runtime>(app_handle: tauri::AppHandle<R>, args: Vec<String>) -> Result<(), String> {
    if args.len() < 2 || args[0].is_empty() || args[1].is_empty() {
        return Err("mv error: Invalid argument - source and destination required".to_string());
    }

    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app_handle.clone());
    let source = resolve_path(app_handle.clone(), &args[0]);
    let destination = resolve_path(app_handle, &args[1]);

    service::mv(&source, &destination, &app_data_folder)
}

#[tauri::command]
pub fn join_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<String, String> {
    if args.is_empty() {
        return Err("join_path error: Invalid argument".to_string());
    }

    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app_handle.clone());
    let path = resolve_path(app_handle, &args[0]);

    service::join_path(path, &args[1..], &app_data_folder)
}

#[tauri::command]
pub fn exists_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<bool, String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("exist_sync error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    Ok(service::exists_sync(&path))
}

#[tauri::command]
pub fn file_stat<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    args: String,
) -> Result<FileStat, String> {
    if args.is_empty() {
        return Err("file_stat error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args);
    service::file_stat(&path)
}

#[tauri::command]
pub fn read_file_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<String, String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("read_file_sync error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    service::read_file_sync(&path)
}

#[tauri::command]
pub fn write_file_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<(), String> {
    if args.len() < 2 || args[0].is_empty() || args[1].is_empty() {
        return Err("write_file_sync error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    service::write_file_sync(&path, &args[1])
}

#[tauri::command]
pub fn readdir_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<Vec<String>, String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("read_dir_sync error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    service::readdir_sync(&path)
}

#[tauri::command]
pub fn write_yaml(
    app: tauri::AppHandle<impl Runtime>,
    data: serde_json::Value,
    save_path: &str,
) -> Result<(), String> {
    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app.clone());
    service::write_yaml(&data, save_path, &app_data_folder)
}

#[tauri::command]
pub fn read_yaml<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: &str,
) -> Result<serde_json::Value, String> {
    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app.clone());
    service::read_yaml(path, &app_data_folder)
}

#[tauri::command]
pub fn decompress<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: &str,
    output_dir: &str,
) -> Result<(), String> {
    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app.clone());
    service::decompress(path, output_dir, &app_data_folder)
}

// rfd native file dialog
#[tauri::command]
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
                serde_json::to_value(paths).unwrap()
            }));
        }
    }

    // Default: single file selection
    let result = dialog.pick_file().await;
    Ok(result.map(|file| serde_json::Value::String(file.path().to_string_lossy().to_string())))
}

#[tauri::command]
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
        service::approve_save_target(&mut approved_save_paths, path)?;
    }

    Ok(save_path)
}

/// Write binary data (hex-encoded) to a file path.
/// Used by the diagram export flow on platforms where blob: anchor downloads
/// do not work (macOS WKWebView, Tauri WebView2 on Windows).
#[tauri::command]
pub async fn write_binary_file(
    state: State<'_, AppState>,
    path: String,
    hex_data: String,
) -> Result<(), String> {
    let mut approved_save_paths = state.approved_save_paths.lock().await;
    service::write_binary_file(&mut approved_save_paths, &path, &hex_data)
}

#[tauri::command]
pub async fn write_text_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let mut approved_save_paths = state.approved_save_paths.lock().await;
    service::write_text_file(&mut approved_save_paths, &path, &content)
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
pub fn read_akidb_config() -> Result<Option<AkidbConfig>, String> {
    service::read_akidb_config()
}

/// Write the AX Studio knowledge-base config to the preferred AX Studio path
/// and mirror to the legacy `~/.ax-fabric/config.yaml` so the daemon picks it up.
#[tauri::command]
pub fn write_akidb_config(config: AkidbConfig) -> Result<(), String> {
    service::write_akidb_config(&config)
}

/// Read the AX Studio knowledge-base daemon status.
/// The daemon writes to `~/.ax-fabric/status.json`, so we read from there directly.
#[tauri::command]
pub fn read_akidb_status() -> Result<Option<AkidbStatus>, String> {
    service::read_akidb_status()
}

/// Result returned by the `akidb_sync_now` command.
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct AkidbSyncResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Trigger a one-shot knowledge-base sync by spawning the fabric-ingest daemon.
#[tauri::command]
pub async fn akidb_sync_now<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<AkidbSyncResult, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    path.push("mcp_config.json");

    service::akidb_sync_now(&path).await
}
