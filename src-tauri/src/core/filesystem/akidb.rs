//! Knowledge-base (akidb / fabric-ingest) daemon config, status, and sync.
//!
//! This module contains all the code for managing the external fabric-ingest
//! daemon that powers the knowledge base. It lives under `filesystem/` because
//! the desktop bridge exposes these as Tauri commands alongside the other
//! filesystem operations, but it has no dependency on the rest of the
//! filesystem module — the daemon owns its config path outside the app data
//! folder, so the in-process path-approval layer doesn't apply here.

use crate::core::state::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{Manager, Runtime, State};
use tokio::io::AsyncReadExt;
use tokio::sync::oneshot;

// ── Config paths ─────────────────────────────────────────────────────────

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

// ── Config schema ────────────────────────────────────────────────────────
// Mirrors the Zod schema in fabric-ingest/config-loader.ts.

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

// ── Tauri commands ───────────────────────────────────────────────────────

/// Read the AX Studio knowledge-base config, migrating a legacy config file if needed.
#[tauri::command]
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
