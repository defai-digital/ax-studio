// WARNING: These APIs will be deprecated soon due to removing FS API access from frontend.
// It's added to ensure the legacy implementation from frontend still functions before removal.

use super::models::FileStat;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

// ── Path helpers ──────────────────────────────────────────────────────────────

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

fn migrate_legacy_akidb_file(
    home: &Path,
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

// ── Save-path approval helpers ────────────────────────────────────────────────

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
    approved_save_paths: &mut HashSet<PathBuf>,
    path: &str,
) -> Result<(), String> {
    let normalized = normalize_save_target_path(path)?;
    approved_save_paths.insert(normalized);
    Ok(())
}

pub(crate) fn consume_approved_save_target(
    approved_save_paths: &mut HashSet<PathBuf>,
    path: &str,
) -> Result<PathBuf, String> {
    let normalized = normalize_save_target_path(path)?;
    if approved_save_paths.remove(&normalized) {
        Ok(normalized)
    } else {
        Err("write_binary_file error: path was not approved by save dialog".to_string())
    }
}

// ── Core filesystem operations ────────────────────────────────────────────────

pub fn rm(path: &Path) -> Result<(), String> {
    if path.is_file() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    } else if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        return Err("rm error: Path does not exist".to_string());
    }
    Ok(())
}

pub fn mkdir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

pub fn mv(source: &Path, destination: &Path, app_data_folder: &Path) -> Result<(), String> {
    if !source.starts_with(app_data_folder) {
        return Err(format!(
            "mv error: source path {} is not under app data folder",
            source.display()
        ));
    }

    if !destination.starts_with(app_data_folder) {
        return Err(format!(
            "mv error: destination path {} is not under app data folder",
            destination.display()
        ));
    }

    if !source.exists() {
        return Err("mv error: Source path does not exist".to_string());
    }

    fs::rename(source, destination).map_err(|e| e.to_string())
}

pub fn join_path(
    path: PathBuf,
    remaining_args: &[String],
    app_data_folder: &Path,
) -> Result<String, String> {
    let joined_path = remaining_args.iter().fold(path, |acc, part| acc.join(part));
    // Normalize to resolve any ".." segments from subsequent args
    let normalized = ax_studio_utils::normalize_path(&joined_path);
    if !normalized.starts_with(app_data_folder) {
        return Err(format!(
            "join_path error: result path {} is outside app data folder",
            normalized.display()
        ));
    }
    Ok(normalized.to_string_lossy().to_string())
}

pub fn exists_sync(path: &Path) -> bool {
    path.exists()
}

pub fn file_stat(path: &Path) -> Result<FileStat, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let is_directory = metadata.is_dir();
    let size = if is_directory { 0 } else { metadata.len() };
    Ok(FileStat { is_directory, size })
}

pub fn read_file_sync(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn write_file_sync(path: &Path, content: &str) -> Result<(), String> {
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

pub fn readdir_sync(path: &Path) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let paths: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path().to_string_lossy().to_string())
        .collect();
    Ok(paths)
}

// ── YAML operations ───────────────────────────────────────────────────────────

pub fn write_yaml(
    data: &serde_json::Value,
    save_path: &str,
    app_data_folder: &Path,
) -> Result<(), String> {
    let save_path = ax_studio_utils::normalize_path(&app_data_folder.join(save_path));
    if !save_path.starts_with(app_data_folder) {
        return Err(format!(
            "Error: save path {} is not under app_data_folder {}",
            save_path.to_string_lossy(),
            app_data_folder.to_string_lossy(),
        ));
    }
    let tmp_path = save_path.with_extension("yaml.tmp");
    let file = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
    let mut writer = std::io::BufWriter::new(file);
    serde_yaml::to_writer(&mut writer, &data).map_err(|e| e.to_string())?;
    drop(writer);
    fs::rename(&tmp_path, &save_path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn read_yaml(path: &str, app_data_folder: &Path) -> Result<serde_json::Value, String> {
    let path = ax_studio_utils::normalize_path(&app_data_folder.join(path));
    if !path.starts_with(app_data_folder) {
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

// ── Decompression ─────────────────────────────────────────────────────────────

pub fn decompress(path: &str, output_dir: &str, app_data_folder: &Path) -> Result<(), String> {
    let path_buf = ax_studio_utils::normalize_path(&app_data_folder.join(path));

    let output_dir_buf = ax_studio_utils::normalize_path(&app_data_folder.join(output_dir));
    if !output_dir_buf.starts_with(app_data_folder) {
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

// ── Binary / text file writes (save-dialog approved) ──────────────────────────

pub fn write_binary_file(
    approved_save_paths: &mut HashSet<PathBuf>,
    path: &str,
    hex_data: &str,
) -> Result<(), String> {
    let data = hex::decode(hex_data).map_err(|e| e.to_string())?;
    let normalized_path = consume_approved_save_target(approved_save_paths, path)?;
    std::fs::write(&normalized_path, &data).map_err(|e| e.to_string())
}

pub fn write_text_file(
    approved_save_paths: &mut HashSet<PathBuf>,
    path: &str,
    content: &str,
) -> Result<(), String> {
    let normalized_path = consume_approved_save_target(approved_save_paths, path)?;
    std::fs::write(&normalized_path, content).map_err(|e| e.to_string())
}

// ── Knowledge-base (akidb) operations ─────────────────────────────────────────

use super::commands::{AkidbConfig, AkidbStatus, AkidbSyncResult};

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

pub fn write_akidb_config(config: &AkidbConfig) -> Result<(), String> {
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

/// Resolved command and arguments for spawning the fabric-ingest CLI.
pub(crate) struct FabricCliCommand {
    pub program: String,
    pub args: Vec<String>,
}

/// Resolve the fabric-ingest CLI command from an MCP config file.
/// Falls back to the local dev CLI if available.
pub(crate) fn resolve_fabric_cli_command(
    mcp_config_path: &Path,
) -> Result<FabricCliCommand, String> {
    if mcp_config_path.exists() {
        let content = fs::read_to_string(mcp_config_path).map_err(|e| e.to_string())?;
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

    // Fallback: resolve the local fabric-ingest CLI from the sibling ax-fabric repo.
    // The package is not published to npm, so npx cannot fetch it.
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let local_cli = home.join("Documents/Defai/ax/ax-fabric/packages/fabric-ingest/dist/cli.js");
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

    Err(
        "Could not resolve fabric-ingest CLI. Ensure the ax-studio MCP server is configured or the local fabric-ingest package is built."
            .to_string(),
    )
}

/// Trigger a one-shot knowledge-base sync by spawning the fabric-ingest daemon.
pub async fn akidb_sync_now(mcp_config_path: &Path) -> Result<AkidbSyncResult, String> {
    let cli = resolve_fabric_cli_command(mcp_config_path)?;

    log::info!(
        "akidb_sync_now: spawning {} {:?} daemon --once",
        cli.program,
        cli.args
    );

    let output = tokio::process::Command::new(&cli.program)
        .args(&cli.args)
        .arg("daemon")
        .arg("--once")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to spawn daemon: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = output.status.success();

    // Always log stdout/stderr to a debug file for troubleshooting
    let debug_path = std::path::PathBuf::from("/tmp/akidb-tauri-sync.log");
    let debug_msg = format!(
        "[{}] exit={} success={}\n--- stdout ---\n{}\n--- stderr ---\n{}\n---\n",
        chrono::Utc::now().to_rfc3339(),
        output.status,
        success,
        stdout,
        stderr
    );
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&debug_path)
        .and_then(|mut f| f.write_all(debug_msg.as_bytes()));

    if success {
        log::info!("akidb_sync_now: completed successfully");
    } else {
        log::warn!("akidb_sync_now: exited with status {}", output.status);
        log::warn!("akidb_sync_now stderr: {stderr}");
    }

    Ok(AkidbSyncResult {
        success,
        stdout,
        stderr,
    })
}
