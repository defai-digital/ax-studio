// Filesystem commands retained for the current desktop bridge surface.
// It's added to ensure the legacy implementation from frontend still functions before removal.
use super::helpers::resolve_path;
use super::models::{DialogOpenOptions, FileStat};
use crate::core::state::AppState;
use rfd::AsyncFileDialog;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Runtime;
use tauri::State;

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

// Akidb (knowledge-base) commands moved to the sibling `akidb` module.
// See crate::core::filesystem::akidb for read_akidb_*, write_akidb_*,
// akidb_sync_now, and cancel_akidb_sync.

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
/// Accepts either a wrapped `request` object or flat `path`/`output_dir`/`outputDir` args.
pub fn decompress<R: Runtime>(
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
            (Some(p), Some(o)) if !p.is_empty() && !o.is_empty() => (p, o),
            _ => return Err("decompress error: Invalid argument".to_string()),
        }
    };
    let app_data_folder = crate::core::app::commands::get_app_data_folder_path(app.clone());
    let path_buf = ax_studio_utils::normalize_path(&app_data_folder.join(&path));
    if !path_buf.starts_with(&app_data_folder) {
        return Err(format!(
            "Error: archive path {} is not under app_data_folder {}",
            path_buf.to_string_lossy(),
            app_data_folder.to_string_lossy(),
        ));
    }

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

            let entry_type = entry.header().entry_type();
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

            // Safely extract symlinks only if the link target stays within
            // output_dir_buf. Without this, llama.cpp's libXYZ.0.dylib ->
            // libXYZ.0.0.8763.dylib symlinks are dropped and the binary
            // fails to load its dynamic libraries at runtime.
            // Hardlinks are still rejected since they can cross filesystem
            // boundaries and are rarely used in release archives.
            if entry_type.is_symlink() {
                let link_target = entry
                    .link_name()
                    .map_err(|e| format!("Invalid symlink target: {e}"))?
                    .ok_or_else(|| "Symlink entry missing target".to_string())?
                    .to_path_buf();

                // Resolve the link target relative to where the symlink lives
                let link_parent = full_path.parent().unwrap_or(&output_dir_buf);
                let resolved_target =
                    ax_studio_utils::normalize_path(&link_parent.join(&link_target));
                if !resolved_target.starts_with(&output_dir_buf) {
                    log::warn!(
                        "Rejecting symlink with out-of-bounds target: {} -> {}",
                        entry_path_string,
                        link_target.display()
                    );
                    continue;
                }

                // Remove any existing file at the symlink path (re-extract case)
                let _ = fs::remove_file(&full_path);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::symlink;
                    symlink(&link_target, &full_path).map_err(|e| {
                        format!(
                            "Failed to create symlink `{}` -> `{}`: {e}",
                            full_path.display(),
                            link_target.display()
                        )
                    })?;
                }
                #[cfg(windows)]
                {
                    // On Windows, create a file symlink (requires SeCreateSymbolicLinkPrivilege)
                    if let Err(e) = std::os::windows::fs::symlink_file(&link_target, &full_path) {
                        log::warn!(
                            "Failed to create symlink on Windows `{}` -> `{}`: {e}",
                            full_path.display(),
                            link_target.display()
                        );
                    }
                }
                continue;
            }

            if entry_type.is_hard_link() {
                log::warn!(
                    "Rejecting hardlink entry in tar: {}",
                    entry_path_string
                );
                continue;
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
                        // Strip setuid/setgid/sticky bits from archive-provided
                        // permissions — only keep the standard rwx triad so a
                        // malicious archive can't plant a setuid binary.
                        let safe_mode = mode & 0o777;
                        let _ = std::fs::set_permissions(
                            &outpath,
                            std::fs::Permissions::from_mode(safe_mode),
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

