use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::core::app::commands::{
    default_data_folder_path, get_app_data_folder_path, update_app_configuration,
};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::{stop_mcp_servers_with_context, ShutdownContext};
use crate::core::state::AppState;
use ax_studio_utils::normalize_path;

fn is_path_in_allowed_user_dirs(
    canonical_path: &std::path::Path,
    home_dir: &std::path::Path,
    temp_dir: &std::path::Path,
) -> bool {
    let canonical_path = normalize_path(canonical_path);
    let home_dir = normalize_path(home_dir);
    let temp_dir = normalize_path(temp_dir);

    canonical_path.starts_with(&home_dir) || canonical_path.starts_with(&temp_dir)
}

fn validate_open_path(path: &PathBuf) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("Path must not be empty".to_string());
    }

    let canonical_path = fs::canonicalize(path).map_err(|e| format!("Invalid path: {e}"))?;
    let home_dir = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let temp_dir = std::env::temp_dir();

    if is_path_in_allowed_user_dirs(&canonical_path, &home_dir, &temp_dir) {
        Ok(normalize_path(&canonical_path))
    } else {
        Err(format!(
            "Refusing to open path outside allowed user directories: {}",
            canonical_path.display()
        ))
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum SinglePathRequest {
    Legacy { args: Vec<String> },
    Typed { path: String },
}

impl SinglePathRequest {
    fn into_path(self, command: &str) -> Result<PathBuf, String> {
        let path = match self {
            Self::Legacy { args } => args.into_iter().next(),
            Self::Typed { path } => Some(path),
        }
        .filter(|path| !path.is_empty())
        .ok_or_else(|| format!("{command} error: Invalid argument"))?;

        Ok(PathBuf::from(path))
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum LogRequest {
    Legacy {
        args: Vec<String>,
    },
    Typed {
        message: String,
        #[serde(default, alias = "file_name", alias = "fileName")]
        file_name: Option<String>,
    },
}

impl LogRequest {
    fn into_parts(self) -> Result<(String, Option<String>), String> {
        match self {
            Self::Legacy { args } => {
                let mut args = args.into_iter();
                let message = args
                    .next()
                    .filter(|message| !message.is_empty())
                    .ok_or_else(|| "log error: Invalid argument".to_string())?;
                let file_name = args.next().filter(|file_name| !file_name.is_empty());
                Ok((message, file_name))
            }
            Self::Typed { message, file_name } if !message.is_empty() => {
                Ok((message, file_name.filter(|file_name| !file_name.is_empty())))
            }
            Self::Typed { .. } => Err("log error: Invalid argument".to_string()),
        }
    }
}

fn normalize_for_subdirectory_check(path: PathBuf) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return normalize_path(&canonical);
    }

    let mut missing_components = Vec::new();
    let mut ancestor = path.as_path();
    while !ancestor.as_os_str().is_empty() {
        if let Ok(canonical) = ancestor.canonicalize() {
            let mut normalized = normalize_path(&canonical);
            for component in missing_components.iter().rev() {
                normalized.push(component);
            }
            return normalize_path(&normalized);
        }

        if let Some(file_name) = ancestor.file_name() {
            missing_components.push(file_name.to_os_string());
        }

        match ancestor.parent() {
            Some(parent) if parent != ancestor => ancestor = parent,
            _ => break,
        }
    }

    normalize_path(&path)
}

#[tauri::command]
pub fn dir_name(request: SinglePathRequest) -> Result<String, String> {
    let path = request.into_path("dir_name")?;
    let dir = path
        .parent()
        .ok_or_else(|| "dir_name error: Invalid argument".to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn base_name(request: SinglePathRequest) -> Result<String, String> {
    let path = request.into_path("base_name")?;
    let name = path
        .file_name()
        .ok_or_else(|| "base_name error: Invalid argument".to_string())?;
    Ok(name.to_string_lossy().to_string())
}

#[tauri::command]
pub fn is_subdirectory(from: String, to: String) -> Result<bool, String> {
    if from.is_empty() || to.is_empty() {
        return Err("is_subdirectory error: Invalid argument".to_string());
    }

    let candidate = normalize_for_subdirectory_check(PathBuf::from(from));
    let base = normalize_for_subdirectory_check(PathBuf::from(to));
    Ok(candidate != base && candidate.starts_with(base))
}

#[tauri::command]
pub fn log(request: LogRequest) -> Result<(), String> {
    let (message, file_name) = request.into_parts()?;
    if let Some(file_name) = file_name {
        ::log::info!("[browser:{file_name}] {message}");
    } else {
        ::log::info!("[browser] {message}");
    }
    Ok(())
}

#[tauri::command]
pub fn canonicalize_path(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let canonical = validate_open_path(&path)?;
    let display = canonical.to_string_lossy().to_string();
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy().to_string();
        if display.starts_with(&home_str) {
            return Ok(display.replacen(&home_str, "~", 1));
        }
    }
    Ok(display)
}

#[tauri::command]
pub async fn factory_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let windows = app_handle.webview_windows();
    for (label, window) in windows.iter() {
        window.close().unwrap_or_else(|_| {
            ::log::warn!("Failed to close window: {label:?}");
        });
    }
    let data_folder = get_app_data_folder_path(app_handle.clone());
    ::log::info!("Factory reset, removing data folder: {data_folder:?}");

    let _ = stop_mcp_servers_with_context(&app_handle, &state, ShutdownContext::FactoryReset).await;

    {
        let mut active_servers = state.mcp_active_servers.lock().await;
        active_servers.clear();
    }

    {
        let _reset_guard = state.factory_reset_lock.lock().await;

        use crate::core::mcp::lockfile::cleanup_own_locks;
        if let Err(e) = cleanup_own_locks(&app_handle) {
            ::log::warn!("Failed to cleanup lock files: {}", e);
        }
        if data_folder.exists() {
            if let Err(e) = fs::remove_dir_all(&data_folder) {
                let message = format!("Failed to remove data folder: {e}");
                ::log::error!("{message}");
                return Err(message);
            }
        }

        fs::create_dir_all(&data_folder)
            .map_err(|e| format!("Failed to recreate data folder: {e}"))?;
    }

    // Reset the configuration
    let mut default_config = AppConfiguration::default();
    default_config.data_folder = default_data_folder_path(app_handle.clone());
    update_app_configuration(app_handle.clone(), default_config)?;

    app_handle.restart();
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub fn relaunch<R: Runtime>(app: AppHandle<R>) {
    app.restart()
}

#[tauri::command]
pub fn open_file_explorer(path: String) -> Result<(), String> {
    let path = validate_open_path(&PathBuf::from(path))?;
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(path)
            .status()
            .map_err(|e| format!("Failed to open file explorer: {e}"))?;
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg("--")
            .arg(path)
            .status()
            .map_err(|e| format!("Failed to open file explorer: {e}"))?;
    } else {
        std::process::Command::new("xdg-open")
            .arg("--")
            .arg(path)
            .status()
            .map_err(|e| format!("Failed to open file explorer: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn read_logs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let log_path = get_app_data_folder_path(app).join("logs").join("app.log");
    if !log_path.exists() {
        return Err("Log file not found".to_string());
    }
    let content = tokio::task::spawn_blocking(move || fs::read_to_string(log_path))
        .await
        .map_err(|e| format!("read_logs task error: {e}"))?
        .map_err(|e| e.to_string())?;
    Ok(redact_sensitive_data(&content))
}

/// Compiled regex patterns for sensitive data redaction.
/// Uses `OnceLock` to compile once and never panic — avoids `.unwrap()` with `panic = "abort"`.
static REDACT_PATTERNS: std::sync::OnceLock<Vec<(regex::Regex, &str)>> = std::sync::OnceLock::new();

fn redact_sensitive_data(input: &str) -> String {
    let patterns = REDACT_PATTERNS.get_or_init(|| {
        vec![
            (
                regex::Regex::new(r"(api[_-]?key\s*[:=]\s*)[\w\-]{20,}")
                    .expect("valid api_key regex"),
                "$1[REDACTED]",
            ),
            (
                regex::Regex::new(r"(Bearer\s+)[\w\-\.]{20,}").expect("valid bearer regex"),
                "$1[REDACTED]",
            ),
            (
                regex::Regex::new(r"(authorization\s*[:=]\s*)[\w\-\.]{20,}")
                    .expect("valid auth regex"),
                "$1[REDACTED]",
            ),
            (
                regex::Regex::new(r"(sk-)[a-zA-Z0-9]{20,}").expect("valid sk- regex"),
                "$1[REDACTED]",
            ),
            (
                regex::Regex::new(r"(token\s*[:=]\s*)[\w\-\.]{20,}").expect("valid token regex"),
                "$1[REDACTED]",
            ),
        ]
    });
    let mut result = input.to_string();
    for (re, replacement) in patterns {
        result = re.replace_all(&result, *replacement).to_string();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_open_path_rejects_empty() {
        let result = validate_open_path(&PathBuf::from(""));
        assert!(result.is_err());
    }

    #[test]
    fn test_dir_name_and_base_name_accept_legacy_requests() {
        let dir = dir_name(SinglePathRequest::Legacy {
            args: vec!["/tmp/ax-studio/file.txt".to_string()],
        })
        .expect("dir_name should accept legacy args");
        let name = base_name(SinglePathRequest::Legacy {
            args: vec!["/tmp/ax-studio/file.txt".to_string()],
        })
        .expect("base_name should accept legacy args");

        assert_eq!(dir, "/tmp/ax-studio");
        assert_eq!(name, "file.txt");
    }

    #[test]
    fn test_is_subdirectory_normalizes_relative_segments() {
        let result = is_subdirectory(
            "/tmp/ax-studio/a/../a/file.txt".to_string(),
            "/tmp/ax-studio/a".to_string(),
        )
        .expect("is_subdirectory should normalize paths");

        assert!(result);
        assert!(!is_subdirectory(
            "/tmp/ax-studio/a".to_string(),
            "/tmp/ax-studio/a".to_string(),
        )
        .expect("equal paths are not subdirectories"));
        assert!(!is_subdirectory(
            "/tmp/ax-studio/a2/file.txt".to_string(),
            "/tmp/ax-studio/a".to_string(),
        )
        .expect("component prefixes must not match"));
    }

    #[test]
    fn test_log_accepts_typed_request() {
        let result = log(LogRequest::Typed {
            message: "hello".to_string(),
            file_name: Some("extension.ts".to_string()),
        });

        assert!(result.is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn allows_verbatim_canonical_path_under_home_dir() {
        assert!(is_path_in_allowed_user_dirs(
            std::path::Path::new(
                r"\\?\C:\Users\devop\AppData\Roaming\AX Studio\data\llamacpp\models",
            ),
            std::path::Path::new(r"C:\Users\devop"),
            std::path::Path::new(r"C:\Users\devop\AppData\Local\Temp"),
        ));
    }
}
