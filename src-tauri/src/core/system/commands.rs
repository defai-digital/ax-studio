use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::core::app::commands::{
    default_data_folder_path, get_app_data_folder_path, update_app_configuration,
};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::{stop_mcp_servers_with_context, ShutdownContext};
use crate::core::state::AppState;

/// Detect the user's default shell and return the appropriate env file path.
/// Returns (shell_name, env_file_path).
fn detect_shell_env_file(home_dir: &str, is_macos: bool) -> (&'static str, String) {
    let shell = std::env::var("SHELL").unwrap_or_default();
    if shell.ends_with("/bash") {
        // macOS uses login shells in Terminal, so ~/.bash_profile is sourced.
        // Linux interactive shells source ~/.bashrc.
        let file = if is_macos {
            format!("{}/.bash_profile", home_dir)
        } else {
            format!("{}/.bashrc", home_dir)
        };
        ("bash", file)
    } else {
        // Default to zsh (macOS default since Catalina)
        ("zsh", format!("{}/.zshenv", home_dir))
    }
}

// Validate environment variable key format: must match ^[a-zA-Z_][a-zA-Z0-9_]*$
// Lowercase is allowed because real-world env vars like `http_proxy`, `no_proxy`,
// and `https_proxy` are conventionally lowercase.
fn is_valid_env_key(key: &str) -> bool {
    if key.is_empty() {
        return false;
    }
    let chars: Vec<char> = key.chars().collect();
    if !chars[0].is_ascii_alphabetic() && chars[0] != '_' {
        return false;
    }
    for &ch in &chars[1..] {
        if !ch.is_ascii_alphanumeric() && ch != '_' {
            return false;
        }
    }
    true
}

fn is_safe_shell_env_value(value: &str) -> bool {
    !value.chars().any(|ch| matches!(ch, '\0' | '\n' | '\r'))
}

// Helper function to write env vars to a shell config file
fn write_env_to_shell(env_file_path: &str, env_vars: &[(String, String)]) -> Result<(), String> {
    let marker = "# Ax-Studio Local API Server - Claude Code Config";
    let new_entries: String = env_vars
        .iter()
        .map(|(k, v)| {
            if !is_safe_shell_env_value(v) {
                return Err(format!(
                    "Refusing to write shell env var {k}: value contains unsupported control characters"
                ));
            }
            // Escape single quotes to prevent shell injection
            let escaped_v = v.replace('\'', "'\\''");
            Ok(format!("export {}='{}'\n", k, escaped_v))
        })
        .collect::<Result<String, String>>()?;

    let existing_content = std::fs::read_to_string(env_file_path).unwrap_or_default();
    let cleaned: Vec<&str> = existing_content
        .split('\n')
        .filter(|line| {
            // Remove Ax-Studio config markers and existing ANTHROPIC env vars to replace them
            !line.starts_with(marker)
                && !line.starts_with("# Ax-Studio Local API Server")
                && !line.starts_with("export ANTHROPIC_")
        })
        .collect();

    let new_content = format!("{}\n{}\n{}\n", marker, new_entries, marker);

    let final_content = cleaned.join("\n") + &new_content;
    std::fs::write(env_file_path, &final_content).map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_open_path(path: &PathBuf) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("Path must not be empty".to_string());
    }

    let canonical_path = fs::canonicalize(path).map_err(|e| format!("Invalid path: {e}"))?;
    let home_dir = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let temp_dir = std::env::temp_dir();

    if canonical_path.starts_with(&home_dir) || canonical_path.starts_with(&temp_dir) {
        Ok(canonical_path)
    } else {
        Err(format!(
            "Refusing to open path outside allowed user directories: {}",
            canonical_path.display()
        ))
    }
}

#[tauri::command]
pub fn canonicalize_path(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    // Apply the same allow-list used by the file-explorer opener: only paths
    // under the user's home directory or the system temp directory can be
    // probed. Without this, the command doubled as a filesystem enumeration
    // oracle (e.g. `/etc/passwd` canonicalizes → discloses absolute paths and
    // home-dir usernames).
    let canonical = validate_open_path(&path)?;
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub fn factory_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let windows = app_handle.webview_windows();
    for (label, window) in windows.iter() {
        window.close().unwrap_or_else(|_| {
            log::warn!("Failed to close window: {label:?}");
        });
    }
    let data_folder = get_app_data_folder_path(app_handle.clone());
    log::info!("Factory reset, removing data folder: {data_folder:?}");

    tauri::async_runtime::block_on(async {
        let _ =
            stop_mcp_servers_with_context(&app_handle, &state, ShutdownContext::FactoryReset).await;

        {
            let mut active_servers = state.mcp_active_servers.lock().await;
            active_servers.clear();
        }

        use crate::core::mcp::lockfile::cleanup_own_locks;
        if let Err(e) = cleanup_own_locks(&app_handle) {
            log::warn!("Failed to cleanup lock files: {}", e);
        }
        if data_folder.exists() {
            if let Err(e) = fs::remove_dir_all(&data_folder) {
                let message = format!("Failed to remove data folder: {e}");
                log::error!("{message}");
                return Err(message);
            }
        }

        // Recreate the data folder
        fs::create_dir_all(&data_folder)
            .map_err(|e| format!("Failed to recreate data folder: {e}"))?;

        // Reset the configuration
        let mut default_config = AppConfiguration::default();
        default_config.data_folder = default_data_folder_path(app_handle.clone());
        update_app_configuration(app_handle.clone(), default_config)?;

        app_handle.restart();
        #[allow(unreachable_code)]
        Ok(())
    })
}

#[tauri::command]
pub fn relaunch<R: Runtime>(app: AppHandle<R>) {
    app.restart()
}

#[tauri::command]
pub fn open_app_directory<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let app_path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(app_path)
            .status()
            .map_err(|e| format!("Failed to open app directory: {e}"))?;
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(app_path)
            .status()
            .map_err(|e| format!("Failed to open app directory: {e}"))?;
    } else {
        std::process::Command::new("xdg-open")
            .arg(app_path)
            .status()
            .map_err(|e| format!("Failed to open app directory: {e}"))?;
    }
    Ok(())
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
    if log_path.exists() {
        let content = fs::read_to_string(log_path).map_err(|e| e.to_string())?;
        Ok(content)
    } else {
        Err("Log file not found".to_string())
    }
}

// check if a system library is available
#[tauri::command]
pub fn is_library_available(library: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        if library == "Metal.framework/Metal" {
            return std::path::Path::new("/System/Library/Frameworks/Metal.framework/Metal")
                .exists();
        }
    }

    #[cfg(target_os = "windows")]
    {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
        let system32 = std::path::Path::new(&windir).join("System32");
        return match library {
            "vulkan-1.dll" | "nvcuda.dll" | "opengl32.dll" => system32.join(library).exists(),
            _ => false,
        };
    }

    #[allow(unreachable_code)]
    {
        log::warn!("Library {library} is not in the known system-library allow-list");
        false
    }
}

/// Validate that a URL is usable as an Anthropic API base URL: must be
/// parsable and use http or https (rejects `file://`, `javascript:`,
/// `data:`, etc.).
fn validate_api_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid API URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        other => Err(format!("Unsupported API URL scheme: {other}")),
    }
}

#[tauri::command]
pub fn launch_claude_code_with_config(
    api_url: String,
    api_key: Option<String>,
    big_model: Option<String>,
    medium_model: Option<String>,
    small_model: Option<String>,
    custom_env_vars: Vec<serde_json::Value>,
) -> Result<(), String> {
    // Validate the URL before writing it to shell config — previously any
    // string (including `file:///etc/passwd`) was accepted.
    validate_api_url(&api_url)?;

    // Hardcoded env vars (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN) still
    // need to pass the shell-safety check — the control-character guard
    // that custom env vars go through was previously skipped here.
    if !is_safe_shell_env_value(&api_url) {
        return Err("ANTHROPIC_BASE_URL contains unsupported control characters".to_string());
    }

    // Clone values for logging before moving
    let api_url_log = api_url.clone();
    let big_model_log = big_model.clone();
    let medium_model_log = medium_model.clone();
    let small_model_log = small_model.clone();

    let mut env_vars: Vec<(String, String)> = Vec::with_capacity(8);
    env_vars.push(("ANTHROPIC_BASE_URL".to_string(), api_url));

    let auth_token = api_key.unwrap_or_else(|| "ax-studio".to_string());
    if !is_safe_shell_env_value(&auth_token) {
        return Err("ANTHROPIC_AUTH_TOKEN contains unsupported control characters".to_string());
    }
    env_vars.push(("ANTHROPIC_AUTH_TOKEN".to_string(), auth_token));

    if let Some(model) = big_model {
        env_vars.push(("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), model));
    }

    if let Some(model) = medium_model {
        env_vars.push(("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), model));
    }

    if let Some(model) = small_model {
        env_vars.push(("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), model));
    }

    // Add custom env vars from the custom CLI section
    for env in &custom_env_vars {
        if let (Some(key), Some(value)) = (
            env.get("key").and_then(|v| v.as_str()),
            env.get("value").and_then(|v| v.as_str()),
        ) {
            // Validate env var key format to prevent shell injection
            if !is_valid_env_key(key) {
                return Err(format!("Invalid environment variable key: {}", key));
            }
            env_vars.push((key.to_string(), value.to_string()));
        }
    }

    log::info!(
        "Launching Claude Code with API URL: {}, models: opus={:?}, sonnet={:?}, haiku={:?}, custom_envs={}",
        api_url_log,
        big_model_log,
        medium_model_log,
        small_model_log,
        custom_env_vars.len()
    );

    // Build the command environment
    // Export environment variables to the user's shell config file

    if cfg!(target_os = "macos") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, true);
        log::info!(
            "Detected shell: {}, writing env to: {}",
            shell_name,
            env_file_path
        );

        // Try direct write first
        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&env_file_path)
        {
            Ok(_) => {
                write_env_to_shell(&env_file_path, &env_vars)?;
                return Ok(());
            }
            Err(e) => {
                // Cannot write to shell config file - return error instead of escalating privileges
                return Err(format!("Cannot write to shell config file {}: {}. Please ensure write permissions or configure manually.", env_file_path, e));
            }
        }
    } else {
        // On Windows, set persistent user environment variables using setx
        for (key, value) in &env_vars {
            let output = std::process::Command::new("setx")
                .arg(key)
                .arg(value)
                .output()
                .map_err(|e| e.to_string())?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to set env var {}: {}", key, stderr));
            }
        }

        log::info!("Environment variables set permanently in Windows registry.");
        return Ok(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_env_key_valid_keys() {
        assert!(is_valid_env_key("ANTHROPIC_AUTH_TOKEN"));
        assert!(is_valid_env_key("MY_VAR"));
        assert!(is_valid_env_key("_PRIVATE_VAR"));
        assert!(is_valid_env_key("VAR1"));
        assert!(is_valid_env_key("A"));
        // Lowercase env vars like http_proxy, no_proxy are common and valid.
        assert!(is_valid_env_key("http_proxy"));
        assert!(is_valid_env_key("no_proxy"));
        assert!(is_valid_env_key("mixedCase_Var1"));
    }

    #[test]
    fn test_is_valid_env_key_invalid_keys() {
        assert!(!is_valid_env_key(""));
        // Note: "lowercase" is now valid (see test_is_valid_env_key_valid_keys).
        assert!(!is_valid_env_key("VAR-NAME"));
        assert!(!is_valid_env_key("VAR.NAME"));
        assert!(!is_valid_env_key("VAR NAME"));
        assert!(!is_valid_env_key("VAR$(rm -rf /)"));
        assert!(!is_valid_env_key("VAR\n"));
        assert!(!is_valid_env_key("1VAR"));
        assert!(!is_valid_env_key("VAR="));
    }

    #[test]
    fn test_is_safe_shell_env_value_rejects_control_characters() {
        assert!(is_safe_shell_env_value("normal-value"));
        assert!(is_safe_shell_env_value("value with spaces and 'quotes'"));
        assert!(!is_safe_shell_env_value("line1\nline2"));
        assert!(!is_safe_shell_env_value("line1\rline2"));
        assert!(!is_safe_shell_env_value("nul\0byte"));
    }
}
