use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::error::{ErrorCode, LlamacppError, ServerResult};

#[cfg(windows)]
use ax_studio_utils::path::get_short_path;

fn command_has_path_separator(command: &str) -> bool {
    command.contains(std::path::MAIN_SEPARATOR) || command.contains('/') || command.contains('\\')
}

#[cfg(windows)]
fn executable_candidates(binary_name: &str) -> Vec<String> {
    let path = Path::new(binary_name);
    if path.extension().is_some() {
        return vec![binary_name.to_string()];
    }

    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    pathext
        .split(';')
        .filter(|ext| !ext.is_empty())
        .map(|ext| format!("{binary_name}{ext}"))
        .chain(std::iter::once(binary_name.to_string()))
        .collect()
}

#[cfg(not(windows))]
fn executable_candidates(binary_name: &str) -> Vec<String> {
    vec![binary_name.to_string()]
}

fn find_binary_on_path(binary_name: &str, path_env: Option<OsString>) -> Option<PathBuf> {
    let path_env = path_env?;
    for dir in std::env::split_paths(&path_env) {
        for candidate in executable_candidates(binary_name) {
            let full_path = dir.join(candidate);
            if full_path.exists() {
                return Some(full_path);
            }
        }
    }
    None
}

fn resolve_binary_path(backend_path: &str) -> Option<PathBuf> {
    let server_path_buf = PathBuf::from(backend_path);
    if server_path_buf.exists() {
        return Some(server_path_buf);
    }

    if !command_has_path_separator(backend_path) {
        return find_binary_on_path(backend_path, std::env::var_os("PATH"));
    }

    None
}

pub fn is_dangerous_process_env_key(key: &str) -> bool {
    let key = key.to_ascii_uppercase();
    matches!(
        key.as_str(),
        "PATH"
            | "PATHEXT"
            | "LD_PRELOAD"
            | "LD_LIBRARY_PATH"
            | "PYTHONHOME"
            | "PYTHONPATH"
            | "NODE_OPTIONS"
            | "RUBYOPT"
            | "PERL5OPT"
            | "BASH_ENV"
            | "ENV"
            | "GCONV_PATH"
            | "AX_ENGINE_BIN"
    ) || key.starts_with("DYLD_")
}

pub fn validate_path_within_roots(
    path: &Path,
    trusted_roots: &[PathBuf],
    label: &str,
) -> ServerResult<PathBuf> {
    let canonical = std::fs::canonicalize(path).map_err(|error| {
        LlamacppError::new(
            ErrorCode::ModelFileNotFound,
            format!("The specified {label} path could not be resolved safely."),
            Some(error.to_string()),
        )
    })?;
    let allowed = trusted_roots.iter().any(|root| {
        let normalized_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.clone());
        canonical.starts_with(normalized_root)
    });
    if !allowed {
        return Err(LlamacppError::new(
            ErrorCode::InvalidArgument,
            format!("The {label} path is outside AX Studio's managed model directories."),
            Some(canonical.display().to_string()),
        )
        .into());
    }
    Ok(canonical)
}

/// Validate that a binary path exists, has an expected executable name, and
/// resolves beneath a native-configured trusted install root.
/// On macOS, also strips quarantine/provenance extended attributes that can
/// prevent copied or downloaded binaries from executing properly.
/// Only strips quarantine for binaries inside the app's own data directory.
pub fn validate_binary_path(
    backend_path: &str,
    trusted_roots: &[PathBuf],
    allowed_names: &[&str],
) -> ServerResult<PathBuf> {
    let Some(server_path_buf) = resolve_binary_path(backend_path) else {
        let err_msg = format!("Binary not found at {:?}", backend_path);
        log::error!(
            "Server binary not found at expected path: {:?}",
            backend_path
        );
        return Err(LlamacppError::new(
            ErrorCode::BinaryNotFound,
            "The inference backend binary could not be found. Install ax-serving or provide a valid backend binary path.".into(),
            Some(err_msg),
        )
        .into());
    };

    let canonical = std::fs::canonicalize(&server_path_buf).map_err(|error| {
        LlamacppError::new(
            ErrorCode::BinaryNotFound,
            "The inference backend binary could not be resolved safely.".into(),
            Some(error.to_string()),
        )
    })?;
    if !canonical.is_file() {
        return Err(LlamacppError::new(
            ErrorCode::BinaryNotFound,
            "The inference backend path is not a file.".into(),
            Some(canonical.display().to_string()),
        )
        .into());
    }

    let binary_name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !allowed_names
        .iter()
        .any(|allowed| binary_name == allowed.to_ascii_lowercase())
    {
        return Err(LlamacppError::new(
            ErrorCode::InvalidArgument,
            "The inference backend executable name is not allowed.".into(),
            Some(binary_name),
        )
        .into());
    }

    let within_trusted_root = trusted_roots.iter().any(|root| {
        let normalized_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.clone());
        canonical.starts_with(normalized_root)
    });
    if !within_trusted_root {
        return Err(LlamacppError::new(
            ErrorCode::InvalidArgument,
            "The inference backend is outside AX Studio's trusted install directories.".into(),
            Some(canonical.display().to_string()),
        )
        .into());
    }

    #[cfg(target_os = "macos")]
    {
        let path_str = canonical.display().to_string();
        let canonical_str = canonical.to_string_lossy();
        let is_in_user_dir = canonical_str.contains("/.ax-studio/")
            || canonical_str.contains("/Library/Application Support/")
            || canonical_str.contains("/.local/share/");
        if is_in_user_dir {
            use std::process::{Command, Stdio};
            match Command::new("xattr")
                .args(["-cr", &path_str])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
            {
                Ok(s) if s.success() => {
                    log::debug!("Cleared quarantine attributes on {}", path_str);
                }
                Ok(s) => log::warn!("xattr -cr on {} exited with {}", path_str, s),
                Err(e) => log::warn!("Failed to run xattr on {}: {}", path_str, e),
            }
        } else {
            log::debug!(
                "Skipping quarantine removal for binary outside user data dir: {:?}",
                canonical
            );
        }
    }

    Ok(canonical)
}

fn path_arg(
    args: &[String],
    flag: &str,
    missing_value_message: &str,
) -> ServerResult<Option<(usize, PathBuf)>> {
    let Some(flag_index) = args.iter().position(|arg| arg == flag) else {
        return Ok(None);
    };

    let path = args.get(flag_index + 1).cloned().ok_or_else(|| {
        LlamacppError::new(
            ErrorCode::ModelLoadFailed,
            missing_value_message.into(),
            None,
        )
    })?;

    Ok(Some((flag_index, PathBuf::from(path))))
}

fn validate_existing_file(path: &Path, label: &str, user_message: &str) -> ServerResult<()> {
    if !path.exists() {
        let err_msg = format!("Invalid or inaccessible {label} path: {}", path.display());
        log::error!("{}", err_msg);
        return Err(LlamacppError::new(
            ErrorCode::ModelFileNotFound,
            user_message.into(),
            Some(err_msg),
        )
        .into());
    }

    Ok(())
}

fn update_path_arg(args: &mut [String], flag_index: usize, path: &Path) {
    #[cfg(windows)]
    {
        if let Some(short) = get_short_path(path) {
            args[flag_index + 1] = short;
        } else {
            args[flag_index + 1] = path.display().to_string();
        }
    }
    #[cfg(not(windows))]
    {
        args[flag_index + 1] = path.display().to_string();
    }
}

/// Validate model path exists and update args with platform-appropriate path format
pub fn validate_model_path(args: &mut [String]) -> ServerResult<PathBuf> {
    let (model_path_index, model_path_pb) =
        path_arg(args, "-m", "Model path was not provided after '-m' flag.")?.ok_or_else(|| {
            LlamacppError::new(
                ErrorCode::ModelLoadFailed,
                "Model path argument '-m' is missing.".into(),
                None,
            )
        })?;

    validate_existing_file(
        &model_path_pb,
        "model",
        "The specified model file does not exist or is not accessible.",
    )?;
    update_path_arg(args, model_path_index, &model_path_pb);

    Ok(model_path_pb)
}

/// Validate mmproj path exists and update args with platform-appropriate path format
pub fn validate_mmproj_path(args: &mut [String]) -> ServerResult<Option<PathBuf>> {
    let Some((mmproj_path_index, mmproj_path_pb)) = path_arg(
        args,
        "--mmproj",
        "Mmproj path was not provided after '--mmproj' flag.",
    )?
    else {
        return Ok(None);
    };

    validate_existing_file(
        &mmproj_path_pb,
        "mmproj",
        "The specified mmproj file does not exist or is not accessible.",
    )?;
    update_path_arg(args, mmproj_path_index, &mmproj_path_pb);

    Ok(Some(mmproj_path_pb))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;
    use tempfile::NamedTempFile;

    #[test]
    fn test_validate_binary_path_existing() {
        let dir = tempdir().unwrap();
        let binary = dir.path().join("llama-server");
        fs::write(&binary, "").unwrap();
        let path = binary.to_str().unwrap();

        let result = validate_binary_path(path, &[dir.path().to_path_buf()], &["llama-server"]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), std::fs::canonicalize(path).unwrap());
    }

    #[test]
    fn test_validate_binary_path_nonexistent() {
        let nonexistent_path = "/tmp/definitely_does_not_exist_123456789";
        let result = validate_binary_path(
            nonexistent_path,
            &[std::env::temp_dir()],
            &["llama-server"],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_binary_path_rejects_outside_trusted_root() {
        let trusted = tempdir().unwrap();
        let untrusted = tempdir().unwrap();
        let binary = untrusted.path().join("llama-server");
        fs::write(&binary, "").unwrap();

        assert!(validate_binary_path(
            binary.to_str().unwrap(),
            &[trusted.path().to_path_buf()],
            &["llama-server"],
        )
        .is_err());
    }

    #[test]
    fn test_dangerous_process_env_keys_are_case_insensitive() {
        assert!(is_dangerous_process_env_key("LD_PRELOAD"));
        assert!(is_dangerous_process_env_key("dyld_insert_libraries"));
        assert!(is_dangerous_process_env_key("Path"));
        assert!(is_dangerous_process_env_key("AX_ENGINE_BIN"));
        assert!(!is_dangerous_process_env_key("GGML_CUDA_ENABLE_UNIFIED_MEMORY"));
    }

    #[test]
    fn test_find_binary_on_path() {
        let dir = tempdir().unwrap();
        let binary_path = dir.path().join("ax-serving");
        fs::write(&binary_path, "").unwrap();

        let result = find_binary_on_path("ax-serving", Some(dir.path().as_os_str().to_os_string()));
        assert_eq!(result, Some(binary_path));
    }

    #[test]
    fn test_validate_model_path_valid() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();

        let mut args = vec!["-m".to_string(), path.to_string(), "--verbose".to_string()];
        let result = validate_model_path(&mut args);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), PathBuf::from(path));
        // Args should be updated with the path
        #[cfg(windows)]
        {
            // On Windows, the path might be converted to short path format
            // Just verify that the path in args[1] points to the same file
            assert!(PathBuf::from(&args[1]).exists());
        }
        #[cfg(not(windows))]
        {
            assert_eq!(args[1], temp_file.path().display().to_string());
        }
    }

    #[test]
    fn test_validate_model_path_missing_flag() {
        let mut args = vec!["--verbose".to_string(), "value".to_string()];
        let result = validate_model_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_model_path_missing_value() {
        let mut args = vec!["-m".to_string()];
        let result = validate_model_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_model_path_nonexistent_file() {
        let nonexistent_path = "/tmp/nonexistent_model_123456789.gguf";
        let mut args = vec!["-m".to_string(), nonexistent_path.to_string()];
        let result = validate_model_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_mmproj_path_valid() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();

        let mut args = vec![
            "--mmproj".to_string(),
            path.to_string(),
            "--verbose".to_string(),
        ];
        let result = validate_mmproj_path(&mut args);

        assert!(result.is_ok());
        assert!(result.unwrap().is_some());
        // Args should be updated with the path
        #[cfg(windows)]
        {
            // On Windows, the path might be converted to short path format
            // Just verify that the path in args[1] points to the same file
            assert!(PathBuf::from(&args[1]).exists());
        }
        #[cfg(not(windows))]
        {
            assert_eq!(args[1], temp_file.path().display().to_string());
        }
    }

    #[test]
    fn test_validate_mmproj_path_missing() {
        let mut args = vec!["--verbose".to_string(), "value".to_string()];
        let result = validate_mmproj_path(&mut args);
        assert!(result.is_ok());
        assert!(result.unwrap().is_none()); // mmproj is optional
    }

    #[test]
    fn test_validate_mmproj_path_missing_value() {
        let mut args = vec!["--mmproj".to_string()];
        let result = validate_mmproj_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_mmproj_path_nonexistent_file() {
        let nonexistent_path = "/tmp/nonexistent_mmproj_123456789.gguf";
        let mut args = vec!["--mmproj".to_string(), nonexistent_path.to_string()];
        let result = validate_mmproj_path(&mut args);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_model_path_multiple_m_flags() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();

        // Multiple -m flags - should use the first one
        let mut args = vec![
            "-m".to_string(),
            path.to_string(),
            "--verbose".to_string(),
            "-m".to_string(),
            "another_path".to_string(),
        ];
        let result = validate_model_path(&mut args);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), PathBuf::from(path));
    }

    #[test]
    fn test_validate_mmproj_path_multiple_flags() {
        let temp_file = NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap();

        // Multiple --mmproj flags - should use the first one
        let mut args = vec![
            "--mmproj".to_string(),
            path.to_string(),
            "--verbose".to_string(),
            "--mmproj".to_string(),
            "another_path".to_string(),
        ];
        let result = validate_mmproj_path(&mut args);

        assert!(result.is_ok());
        let result_path = result.unwrap();
        assert!(result_path.is_some());
        assert_eq!(result_path.unwrap(), PathBuf::from(path));
    }
}
