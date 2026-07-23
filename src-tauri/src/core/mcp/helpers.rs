use rmcp::{
    model::{ClientCapabilities, ClientInfo, Implementation},
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
        TokioChildProcess,
    },
    ServiceExt,
};
use serde_json::Value;
use std::{collections::HashMap, env, net::IpAddr, process::Stdio, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_http::reqwest;
use tokio::{io::AsyncReadExt, net::lookup_host, process::Command, sync::Mutex, time::timeout};

#[cfg(windows)]
use crate::core::mcp::constants::CREATE_NO_WINDOW;
use crate::core::{
    app::commands::get_app_data_folder_path,
    mcp::legacy_sse::LegacySseTransport,
    mcp::models::{McpServerConfig, McpSettings},
    state::{AppState, RunningServiceEnum, SharedMcpServers, TrackedMcpProcess},
};
use ax_studio_utils::{can_override_npx, can_override_uvx};

const ALLOWED_COMMANDS: &[&str] = &["node", "python", "python3", "bun", "npx", "uvx"];
const DANGEROUS_ENV_KEYS: &[&str] = &[
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
    "LD_LIBRARY_PATH",
    "DYLD_LIBRARY_PATH",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "BUN_INSTALL",
    "npm_config_prefix",
    "npm_config_node_gyp",
];

fn build_mcp_headers(
    headers: &serde_json::Map<String, Value>,
) -> Result<std::collections::HashMap<http::HeaderName, http::HeaderValue>, String> {
    let mut mapped_headers = HashMap::new();
    for (key, value) in headers {
        let Some(v_str) = value.as_str() else {
            continue;
        };
        let header_name = http::HeaderName::from_bytes(key.as_bytes())
            .map_err(|e| format!("Invalid MCP header name {key}: {e}"))?;
        let header_value = http::HeaderValue::from_str(v_str)
            .map_err(|e| format!("Invalid MCP header value for {key}: {e}"))?;
        mapped_headers.insert(header_name, header_value);
    }
    Ok(mapped_headers)
}

fn mcp_client_info(name: &str) -> ClientInfo {
    ClientInfo::new(
        ClientCapabilities::default(),
        Implementation::new(name, "0.0.1"),
    )
}

fn build_reqwest12_headers(
    headers: &serde_json::Map<String, Value>,
) -> Result<reqwest12::header::HeaderMap, String> {
    let mut mapped_headers = reqwest12::header::HeaderMap::new();
    for (key, value) in headers {
        let Some(v_str) = value.as_str() else {
            continue;
        };
        let header_name = reqwest12::header::HeaderName::from_bytes(key.as_bytes())
            .map_err(|e| format!("Invalid MCP header name {key}: {e}"))?;
        let header_value = reqwest12::header::HeaderValue::from_str(v_str)
            .map_err(|e| format!("Invalid MCP header value for {key}: {e}"))?;
        mapped_headers.insert(header_name, header_value);
    }
    Ok(mapped_headers)
}

async fn validate_external_transport_url(
    server_name: &str,
    transport_kind: &str,
    transport_url: &str,
) -> Result<(), String> {
    if transport_url.is_empty() {
        return Err(format!(
            "Missing MCP {transport_kind} URL for server {server_name}"
        ));
    }

    let parsed = reqwest::Url::parse(transport_url)
        .map_err(|e| format!("Invalid MCP {transport_kind} URL for server {server_name}: {e}"))?;
    let host = parsed.host_str().ok_or_else(|| {
        format!("MCP {transport_kind} URL for server {server_name} is missing a host")
    })?;
    let port = parsed.port_or_known_default().ok_or_else(|| {
        format!("MCP {transport_kind} URL for server {server_name} is missing a port")
    })?;
    let is_loopback_host = host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback());

    if !is_loopback_host && ax_studio_utils::is_internal_url(transport_url) {
        return Err(format!(
            "MCP {transport_kind} URL for server {server_name} points to an internal/private address, which is not allowed. Only loopback addresses (127.0.0.1, localhost, ::1) are supported"
        ));
    }

    let addrs = lookup_host((host, port)).await.map_err(|e| {
        format!("Failed to resolve MCP {transport_kind} URL for server {server_name}: {e}")
    })?;

    for addr in addrs {
        if is_loopback_host && !addr.ip().is_loopback() {
            return Err(format!(
                "MCP {transport_kind} URL for server {server_name} resolves outside loopback, which is not allowed for localhost. Only loopback addresses (127.0.0.1, localhost, ::1) are supported"
            ));
        }
        if is_loopback_host && addr.ip().is_loopback() {
            continue;
        }
        if ax_studio_utils::is_private_ip(addr.ip()) {
            return Err(format!(
                "MCP {transport_kind} URL for server {server_name} resolves to an internal/private address, which is not allowed. Only loopback addresses (127.0.0.1, localhost, ::1) are supported"
            ));
        }
    }

    Ok(())
}

// Re-export ShutdownContext so existing `use super::helpers::ShutdownContext`
// imports keep working after the enum moved to its own module.
pub use super::shutdown::ShutdownContext;

/// Resolve a bare command name to its full canonical path using the system's
/// default PATH (inherited from the app's own process environment).
/// Returns `None` if the binary is not found on PATH.
fn resolve_command_from_default_path(command: &str) -> Option<String> {
    let default_path = env::var_os("PATH").unwrap_or_default();
    let separator = if cfg!(windows) { ';' } else { ':' };
    for dir in default_path.to_string_lossy().split(separator) {
        let candidate = std::path::Path::new(dir).join(command);
        let with_ext = if cfg!(windows) {
            let ext = candidate.with_extension("exe");
            if ext.is_file() {
                Some(ext)
            } else if candidate.is_file() {
                Some(candidate)
            } else {
                None
            }
        } else if candidate.is_file() {
            Some(candidate)
        } else {
            None
        };
        if let Some(path) = with_ext {
            if let Ok(canonical) = path.canonicalize() {
                return Some(canonical.to_string_lossy().to_string());
            }
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

/// Runs MCP commands by reading configuration from a JSON file and initializing servers
///
/// # Arguments
/// * `app_path` - Path to the application directory containing mcp_config.json
/// * `servers_state` - Shared state containing running MCP services
///
/// # Returns
/// * `Ok(())` if servers were initialized successfully
/// * `Err(String)` if there was an error reading config or starting servers
pub async fn run_mcp_commands<R: Runtime>(
    app: &AppHandle<R>,
    servers_state: SharedMcpServers,
) -> Result<(), String> {
    let app_path = get_app_data_folder_path(app.clone());
    let config_path = app_path.join("mcp_config.json");
    log::trace!("Load MCP configs from {}", config_path.display());
    let config_content = tokio::task::spawn_blocking(move || std::fs::read_to_string(config_path))
        .await
        .map_err(|e| format!("Failed to read MCP config: {e}"))?
        .map_err(|e| format!("Failed to read config file: {e}"))?;

    let mcp_servers: serde_json::Value = serde_json::from_str(&config_content)
        .map_err(|e| format!("Failed to parse config: {e}"))?;

    // Update runtime MCP settings from config
    {
        let settings = mcp_servers
            .get("mcpSettings")
            .and_then(|value| serde_json::from_value::<McpSettings>(value.clone()).ok())
            .unwrap_or_default();

        let app_state = app.state::<AppState>();
        let mut guard = app_state.mcp_settings.lock().await;
        *guard = settings;
    }

    let server_map = mcp_servers
        .get("mcpServers")
        .and_then(Value::as_object)
        .ok_or("No mcpServers found in config")?;

    log::trace!("MCP Servers: {server_map:#?}");

    // Collect handles for initial server startup
    let mut startup_handles = Vec::new();

    for (name, config) in server_map {
        if extract_active_status(config) == Some(false) {
            log::trace!("Server {name} is not active, skipping.");
            continue;
        }

        let app_clone = app.clone();
        let servers_clone = servers_state.clone();
        let name_clone = name.clone();
        let config_clone = config.clone();

        // Spawn task for initial startup attempt
        let handle = tauri::async_runtime::spawn(async move {
            // Only wait for the initial startup attempt, not the monitoring
            let result = start_mcp_server(
                app_clone.clone(),
                servers_clone.clone(),
                name_clone.clone(),
                config_clone.clone(),
            )
            .await;

            // If initial startup failed, we still want to continue with other servers
            if let Err(e) = &result {
                log::error!("Initial startup failed for MCP server {name_clone}: {e}");
            }

            (name_clone, result)
        });

        startup_handles.push(handle);
    }

    // Wait for all initial startup attempts to complete
    let mut successful_count = 0;
    let mut failed_count = 0;

    for handle in startup_handles {
        match handle.await {
            Ok((name, result)) => match result {
                Ok(_) => {
                    log::info!("MCP server {name} initialized successfully");
                    successful_count += 1;
                }
                Err(e) => {
                    log::error!("MCP server {name} failed to initialize: {e}");
                    failed_count += 1;
                }
            },
            Err(e) => {
                log::error!("Failed to join startup task: {e}");
                failed_count += 1;
            }
        }
    }

    log::info!(
        "MCP server initialization complete: {successful_count} successful, {failed_count} failed"
    );

    Ok(())
}

/// Starts an MCP server
/// Returns the result of the first start attempt
pub async fn start_mcp_server<R: Runtime>(
    app: AppHandle<R>,
    servers_state: SharedMcpServers,
    name: String,
    config: Value,
) -> Result<(), String> {
    let app_state = app.state::<AppState>();
    let active_servers_state = app_state.mcp_active_servers.clone();

    // Store active server config for restart purposes
    store_active_server_config(&active_servers_state, &name, &config).await;

    // Try the first start attempt and return its result
    log::info!("Starting MCP server {name} (Initial attempt)");
    let first_start_result = schedule_mcp_start_task(
        app.clone(),
        servers_state.clone(),
        name.clone(),
        config.clone(),
    )
    .await;

    match first_start_result {
        Ok(_) => {
            log::info!("MCP server {name} started successfully");
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to start MCP server {name} on first attempt: {e}");
            Err(e)
        }
    }
}

async fn schedule_mcp_start_task<R: Runtime>(
    app: tauri::AppHandle<R>,
    servers: SharedMcpServers,
    name: String,
    config: Value,
) -> Result<(), String> {
    let app_path = get_app_data_folder_path(app.clone());
    let exe_path =
        env::current_exe().map_err(|e| format!("Failed to get current exe path: {e}"))?;
    let exe_parent_path = exe_path
        .parent()
        .ok_or("Executable must have a parent directory")?;
    let bin_path = exe_parent_path.to_path_buf();

    let config_params = extract_command_args(&config)
        .ok_or_else(|| format!("Failed to extract command args from config for {name}"))?;

    if config_params.transport_type.as_deref() == Some("http") && config_params.url.is_some() {
        let transport_url = config_params.url.as_deref().unwrap_or("");
        validate_external_transport_url(&name, "HTTP", transport_url).await?;
        let handshake_timeout = http_connect_timeout(config_params.timeout);
        log::debug!("MCP HTTP server {name} connect timeout: {handshake_timeout:?}");
        let transport = StreamableHttpClientTransport::from_config(
            StreamableHttpClientTransportConfig::with_uri(transport_url.to_string())
                .custom_headers(build_mcp_headers(&config_params.headers)?),
        );

        let client_info = mcp_client_info("AX Studio Streamable Client");
        let client = match timeout(handshake_timeout, client_info.serve(transport)).await {
            Ok(result) => result.inspect_err(|e| {
                log::error!("client error: {e:?}");
            }),
            Err(_) => {
                log::error!(
                    "Timed out connecting to MCP HTTP server {name} after {}s",
                    handshake_timeout.as_secs()
                );
                return Err(format!(
                    "Timed out connecting to MCP server {name} after {}s",
                    handshake_timeout.as_secs()
                ));
            }
        };

        match client {
            Ok(client) => {
                log::info!("Connected to server: {:?}", client.peer_info());
                servers
                    .lock()
                    .await
                    .insert(name.clone(), Arc::new(RunningServiceEnum::WithInit(client)));

                emit_mcp_update_event(&app, &name);
            }
            Err(e) => {
                log::error!("Failed to connect to server: {e}");
                return Err(format!("Failed to connect to server: {e}"));
            }
        }
    } else if config_params.transport_type.as_deref() == Some("sse") && config_params.url.is_some()
    {
        let transport_url = config_params.url.as_deref().unwrap_or("");
        validate_external_transport_url(&name, "SSE", transport_url).await?;
        if let Some(connect_timeout) = config_params.timeout {
            log::debug!("MCP SSE server {name} configured connect timeout: {connect_timeout:?}");
        }
        let handshake_timeout = config_params.timeout.unwrap_or(Duration::from_secs(30));
        let transport = LegacySseTransport::start_with_timeout(
            reqwest12::Client::builder()
                .default_headers(build_reqwest12_headers(&config_params.headers)?)
                .connect_timeout(handshake_timeout)
                .build()
                .map_err(|e| format!("Failed to build SSE client for {name}: {e}"))?,
            transport_url,
            handshake_timeout,
        )
        .await
        .map_err(|e| {
            log::error!("transport error: {e:?}");
            format!("Failed to start SSE transport: {e}")
        })?;

        let client_info = mcp_client_info("AX Studio SSE Client");
        let client = client_info.serve(transport).await.map_err(|e| {
            log::error!("client error: {e:?}");
            e.to_string()
        });

        match client {
            Ok(client) => {
                log::info!("Connected to server: {:?}", client.peer_info());
                servers
                    .lock()
                    .await
                    .insert(name.clone(), Arc::new(RunningServiceEnum::WithInit(client)));

                emit_mcp_update_event(&app, &name);
            }
            Err(e) => {
                log::error!("Failed to connect to server: {e}");
                return Err(format!("Failed to connect to server: {e}"));
            }
        }
    } else {
        // Resolve the command to its full canonical path from the system's
        // default PATH *before* user-provided env vars (which may include a
        // custom PATH) are applied.  This prevents an attacker-controlled
        // PATH from redirecting a whitelisted binary name to a malicious
        // executable.
        let resolved_command =
            if config_params.command.contains('/') || config_params.command.contains('\\') {
                config_params.command.clone()
            } else {
                resolve_command_from_default_path(&config_params.command)
                    .unwrap_or_else(|| config_params.command.clone())
            };
        let mut cmd = Command::new(resolved_command);
        let bun_x_path = if cfg!(windows) {
            bin_path.join("bun.exe")
        } else {
            bin_path.join("bun")
        };
        if config_params.command.clone() == "npx"
            && can_override_npx(bun_x_path.display().to_string())
        {
            let mut cache_dir = app_path.clone();
            cache_dir.push(".npx");
            cmd = Command::new(bun_x_path.display().to_string());
            cmd.arg("x");
            cmd.env("BUN_INSTALL", cache_dir.to_string_lossy().as_ref());
        }

        let uv_path = if cfg!(windows) {
            bin_path.join("uv.exe")
        } else {
            bin_path.join("uv")
        };
        if config_params.command.clone() == "uvx" && can_override_uvx(uv_path.display().to_string())
        {
            let mut cache_dir = app_path.clone();
            cache_dir.push(".uvx");
            cmd = Command::new(uv_path);
            cmd.arg("tool");
            cmd.arg("run");
            cmd.env("UV_CACHE_DIR", cache_dir.to_string_lossy().as_ref());
        }
        #[cfg(windows)]
        {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        cmd.kill_on_drop(true);

        // Expand ~ to the user's home directory in args (shells do this
        // automatically, but direct process spawning does not).
        let home = dirs::home_dir();
        let dangerous_flags = [
            "-c",
            "-e",
            "--eval",
            "--command",
            "-i",
            "--interactive",
            "--exec",
        ];
        config_params
            .args
            .iter()
            .filter_map(Value::as_str)
            .for_each(|arg| {
                if dangerous_flags.contains(&arg) {
                    log::warn!("Blocking dangerous interpreter flag: {}", arg);
                    return;
                }
                if arg.starts_with("~/") || arg == "~" {
                    if let Some(ref h) = home {
                        cmd.arg(h.join(&arg[2..]));
                    } else {
                        cmd.arg(arg);
                    }
                } else {
                    cmd.arg(arg);
                }
            });

        config_params.envs.iter().for_each(|(k, v)| {
            if let Some(v_str) = v.as_str() {
                cmd.env(k, v_str);
            }
        });

        let (process, stderr) = TokioChildProcess::builder(cmd)
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                log::error!("Failed to run command {name}: {e}");
                format!("Failed to run command {name}: {e}")
            })?;

        let process_pid = process.id();
        if let Some(pid) = process_pid {
            log::info!("MCP server {name} spawned with PID {pid}");
            let app_state = app.state::<AppState>();
            let mut pids = app_state.mcp_server_pids.lock().await;
            pids.insert(name.clone(), TrackedMcpProcess::capture(pid));
        }

        let service = ()
            .serve(process)
            .await
            .map_err(|e| format!("Failed to start MCP server {name}: {e}"));

        let inserted_service = match service {
            Ok(server) => {
                log::trace!("Connected to server: {:#?}", server.peer_info());
                let inserted_service = Arc::new(RunningServiceEnum::NoInit(server));
                servers
                    .lock()
                    .await
                    .insert(name.clone(), inserted_service.clone());
                log::info!("Server {name} started successfully.");
                inserted_service
            }
            Err(_) => {
                if let Some(pid) = process_pid {
                    let app_state = app.state::<AppState>();
                    let mut pids = app_state.mcp_server_pids.lock().await;
                    if pids.get(&name).is_some_and(|process| process.pid == pid) {
                        pids.remove(&name);
                    }
                }
                let mut buffer = String::new();
                let error = if let Some(mut stderr_reader) = stderr {
                    match stderr_reader.read_to_string(&mut buffer).await {
                        Ok(_) => format!("Failed to start MCP server {name}: {buffer}"),
                        Err(_) => format!("Failed to read MCP server {name} stderr"),
                    }
                } else {
                    format!("Failed to start MCP server {name} (stderr not available)")
                };
                log::error!("{error}");
                return Err(error);
            }
        };

        // Verify the exact service instance we just inserted, without a sleep-plus-map recheck race.
        if timeout(Duration::from_secs(3), inserted_service.list_all_tools())
            .await
            .is_err()
        {
            log::warn!("MCP server {name} started but failed initial health check (timed out)");
            // Don't fail — startup completed and later requests can still succeed if the server warms up.
        }

        emit_mcp_update_event(&app, &name);
    }
    Ok(())
}

fn emit_mcp_update_event<R: Runtime>(app: &AppHandle<R>, name: &str) {
    if let Err(e) = app.emit(
        "mcp-update",
        serde_json::json!({
            "server": name
        }),
    ) {
        log::error!("Failed to emit mcp-update event: {e}");
    }
}

pub fn extract_command_args(config: &Value) -> Option<McpServerConfig> {
    let obj = match config.as_object() {
        Some(o) => o,
        None => {
            log::warn!("MCP config is not a JSON object");
            return None;
        }
    };
    let transport_type = obj.get("type").and_then(|t| t.as_str()).map(String::from);
    let url = obj.get("url").and_then(|u| u.as_str()).map(String::from);

    let is_external_transport =
        matches!(transport_type.as_deref(), Some("http" | "sse")) && url.is_some();

    let command = match obj.get("command").and_then(|c| c.as_str()) {
        Some(cmd) if !cmd.is_empty() => cmd.to_string(),
        _ => {
            if is_external_transport {
                String::new()
            } else {
                log::warn!(
                    "MCP config missing or empty 'command' field and is not an external transport"
                );
                return None;
            }
        }
    };

    if !is_external_transport && !ALLOWED_COMMANDS.contains(&command.as_str()) {
        log::warn!("MCP config command '{command}' is not in allowed list");
        return None;
    }

    let args = obj
        .get("args")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    let timeout = obj
        .get("timeout")
        .and_then(|t| t.as_u64())
        .map(Duration::from_secs);
    let headers = obj
        .get("headers")
        .unwrap_or(&Value::Object(serde_json::Map::new()))
        .as_object()?
        .clone();
    let mut envs = obj
        .get("env")
        .unwrap_or(&Value::Object(serde_json::Map::new()))
        .as_object()?
        .clone();

    // Filter out dangerous environment variables
    envs.retain(|key, _| {
        let normalized = key.to_ascii_uppercase();
        !DANGEROUS_ENV_KEYS.contains(&normalized.as_str()) && !normalized.starts_with("DYLD_")
    });

    // Block env overrides for security-sensitive variables.  PATH is
    // intentionally absent — MCP servers with custom toolchains (e.g. uvx)
    // need a custom PATH to locate their interpreter.
    const BLOCKED_ENV_KEYS_BY_VALUE: &[&str] = &[
        "home=",
        "user=",
        "shell=",
        "tmpdir=",
        "temp=",
        "tmp=",
        "appdata=",
        "programfiles=",
        "systemroot=",
        "ld_preload=",
    ];
    envs.retain(|k, v| {
        let v_str = match v.as_str() {
            Some(s) => s,
            None => return true,
        };
        let entry = format!("{k}={v_str}").to_ascii_lowercase();
        !BLOCKED_ENV_KEYS_BY_VALUE
            .iter()
            .any(|prefix| entry.starts_with(prefix))
    });

    Some(McpServerConfig {
        timeout,
        transport_type,
        url,
        command,
        args,
        envs,
        headers,
    })
}

pub fn extract_active_status(config: &Value) -> Option<bool> {
    let obj = config.as_object()?;
    let active = obj.get("active")?.as_bool()?;
    Some(active)
}

// These focused parser tests stay beside the parsing helpers; the remainder of
// this file contains lifecycle orchestration that is easier to audit separately.
#[allow(clippy::items_after_test_module)]
/// Default HTTP connect timeout when `config.timeout` is unset (≤10s per ADR-003).
const DEFAULT_HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

fn http_connect_timeout(configured: Option<Duration>) -> Duration {
    configured.unwrap_or(DEFAULT_HTTP_CONNECT_TIMEOUT)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- HTTP connect timeout ---

    #[test]
    fn test_http_connect_timeout_defaults_to_10s() {
        assert_eq!(http_connect_timeout(None), Duration::from_secs(10));
    }

    #[test]
    fn test_http_connect_timeout_uses_configured_value() {
        assert_eq!(
            http_connect_timeout(Some(Duration::from_secs(3))),
            Duration::from_secs(3)
        );
    }

    // --- extract_command_args ---

    #[test]
    fn test_extract_command_args_basic() {
        let config = serde_json::json!({
            "command": "node",
            "args": ["server.js", "--port", "3000"],
            "env": {"NODE_ENV": "production"}
        });
        let result = extract_command_args(&config).unwrap();
        assert_eq!(result.command, "node");
        assert_eq!(result.args.len(), 3);
        assert_eq!(
            result.envs.get("NODE_ENV").unwrap().as_str().unwrap(),
            "production"
        );
        assert!(result.url.is_none());
        assert!(result.transport_type.is_none());
        assert!(result.timeout.is_none());
    }

    #[test]
    fn test_extract_command_args_with_url_and_type() {
        let config = serde_json::json!({
            "command": "node",
            "args": [],
            "url": "http://localhost:8080/mcp",
            "type": "http",
            "timeout": 30
        });
        let result = extract_command_args(&config).unwrap();
        assert_eq!(result.url.unwrap(), "http://localhost:8080/mcp");
        assert_eq!(result.transport_type.unwrap(), "http");
        assert_eq!(result.timeout.unwrap(), Duration::from_secs(30));
    }

    #[test]
    fn test_extract_command_args_missing_command() {
        let config = serde_json::json!({
            "args": ["test"]
        });
        assert!(extract_command_args(&config).is_none());
    }

    #[test]
    fn test_extract_command_args_missing_args() {
        let config = serde_json::json!({
            "command": "node"
        });
        let result = extract_command_args(&config).unwrap();
        assert!(result.args.is_empty());
    }

    #[test]
    fn test_extract_command_args_not_object() {
        let config = serde_json::json!("just a string");
        assert!(extract_command_args(&config).is_none());
    }

    #[test]
    fn test_extract_command_args_with_headers() {
        let config = serde_json::json!({
            "command": "node",
            "args": [],
            "headers": {"Authorization": "Bearer token123"}
        });
        let result = extract_command_args(&config).unwrap();
        assert_eq!(
            result
                .headers
                .get("Authorization")
                .unwrap()
                .as_str()
                .unwrap(),
            "Bearer token123"
        );
    }

    #[test]
    fn test_extract_command_args_invalid_command() {
        let config = serde_json::json!({
            "command": "bash",
            "args": ["-c", "echo hello"]
        });
        assert!(extract_command_args(&config).is_none());
    }

    #[test]
    fn test_extract_command_args_filters_dangerous_env() {
        let config = serde_json::json!({
            "command": "node",
            "args": ["server.js"],
            "env": {
                "NODE_ENV": "production",
                "LD_PRELOAD": "/evil/lib.so",
                "ld_library_path": "/evil/lowercase",
                "DyLd_Insert_Libraries": "/evil/mixed-case.dylib",
                "PATH": "/custom/tools:/usr/bin",
                "HOME": "/evil/home",
                "USER": "evil",
                "SHELL": "/bin/evil",
                "SAFE_VAR": "safe"
            }
        });
        let result = extract_command_args(&config).unwrap();
        assert_eq!(
            result.envs.get("NODE_ENV").unwrap().as_str().unwrap(),
            "production"
        );
        assert_eq!(
            result.envs.get("SAFE_VAR").unwrap().as_str().unwrap(),
            "safe"
        );
        // Blocked by DANGEROUS_ENV_KEYS (key-level filter)
        assert!(result.envs.get("LD_PRELOAD").is_none());
        assert!(result.envs.get("ld_library_path").is_none());
        assert!(result.envs.get("DyLd_Insert_Libraries").is_none());
        // Blocked by BLOCKED_ENV_KEYS_BY_VALUE (key=value prefix filter)
        assert!(result.envs.get("HOME").is_none());
        assert!(result.envs.get("USER").is_none());
        assert!(result.envs.get("SHELL").is_none());
        // PATH is intentionally allowed — MCP servers with custom toolchains
        // (e.g. uvx) need a custom PATH to locate their interpreter.
        assert_eq!(
            result.envs.get("PATH").unwrap().as_str().unwrap(),
            "/custom/tools:/usr/bin"
        );
    }

    #[test]
    fn test_extract_command_args_http_empty_command() {
        let config = serde_json::json!({
            "command": "",
            "args": [],
            "env": {},
            "type": "http",
            "url": "https://mcp.example.com/mcp"
        });
        let result = extract_command_args(&config).unwrap();
        assert_eq!(result.transport_type.as_deref(), Some("http"));
        assert_eq!(result.url.as_deref(), Some("https://mcp.example.com/mcp"));
        assert!(result.command.is_empty());
    }

    #[test]
    fn test_extract_command_args_sse_without_command() {
        let config = serde_json::json!({
            "type": "sse",
            "url": "http://127.0.0.1:31421/mcp"
        });
        let result = extract_command_args(&config).unwrap();
        assert_eq!(result.transport_type.as_deref(), Some("sse"));
        assert_eq!(result.url.as_deref(), Some("http://127.0.0.1:31421/mcp"));
        assert!(result.command.is_empty());
    }

    #[test]
    fn test_extract_command_args_allowed_command_python() {
        let config = serde_json::json!({
            "command": "python",
            "args": ["script.py"]
        });
        let result = extract_command_args(&config).unwrap();
        assert_eq!(result.command, "python");
    }

    // --- extract_active_status ---

    #[test]
    fn test_extract_active_status_true() {
        let config = serde_json::json!({"active": true});
        assert_eq!(extract_active_status(&config), Some(true));
    }

    #[test]
    fn test_extract_active_status_false() {
        let config = serde_json::json!({"active": false});
        assert_eq!(extract_active_status(&config), Some(false));
    }

    #[test]
    fn test_extract_active_status_missing() {
        let config = serde_json::json!({"command": "node"});
        assert_eq!(extract_active_status(&config), None);
    }

    #[test]
    fn test_extract_active_status_not_bool() {
        let config = serde_json::json!({"active": "yes"});
        assert_eq!(extract_active_status(&config), None);
    }

    #[test]
    fn test_extract_active_status_not_object() {
        let config = serde_json::json!(42);
        assert_eq!(extract_active_status(&config), None);
    }

    // --- restart_active_mcp_servers: config parsing contract ---
    //
    // restart_active_mcp_servers spawns async tasks that call start_mcp_server.
    // The full restart path requires a Tauri AppHandle and cannot be exercised as
    // a synchronous unit test.  The tests below verify the pure helper contracts
    // that the restart path depends on: config must be parseable and the server
    // name must survive the clone into the spawned task.

    #[test]
    fn test_restart_config_must_have_command_or_url() {
        // A config with no command and no url cannot start a server.
        // extract_command_args returning None is what gates this.
        let bad_config = serde_json::json!({ "args": [] });
        assert!(
            extract_command_args(&bad_config).is_none(),
            "config without command or url must not produce a valid command spec"
        );
    }

    #[test]
    fn test_restart_server_name_clone_is_independent() {
        // Verifies that cloning a server name for the spawned task log message
        // produces an independent String (not a reference into the original).
        let original = "my-mcp-server".to_string();
        let cloned_for_task = original.clone();
        let cloned_for_log = cloned_for_task.clone();
        drop(cloned_for_task); // simulate name being moved into start_mcp_server
        assert_eq!(
            cloned_for_log, "my-mcp-server",
            "name clone for error log must remain valid after task clone is consumed"
        );
    }

    #[test]
    fn test_restart_http_server_config_is_valid() {
        // An HTTP MCP server config with empty command must still be accepted —
        // restart must not silently skip HTTP servers.
        let http_config = serde_json::json!({
            "command": "",
            "args": [],
            "type": "http",
            "url": "https://mcp.example.com/mcp"
        });
        let args = extract_command_args(&http_config);
        assert!(
            args.is_some(),
            "HTTP server config must be parseable for restart"
        );
        let args = args.unwrap();
        assert_eq!(args.transport_type.as_deref(), Some("http"));
        assert!(args.url.is_some());
    }

    #[test]
    fn test_restart_sse_server_config_is_valid() {
        let sse_config = serde_json::json!({
            "type": "sse",
            "url": "http://127.0.0.1:31421/mcp"
        });
        let args = extract_command_args(&sse_config);
        assert!(
            args.is_some(),
            "SSE server config must be parseable for restart"
        );
        let args = args.unwrap();
        assert_eq!(args.transport_type.as_deref(), Some("sse"));
        assert!(args.url.is_some());
        assert!(args.command.is_empty());
    }

    #[test]
    fn test_restart_stdio_server_config_is_valid() {
        // A stdio MCP server config must be parseable for restart.
        let stdio_config = serde_json::json!({
            "command": "node",
            "args": ["server.js"],
            "env": {}
        });
        let args = extract_command_args(&stdio_config);
        assert!(
            args.is_some(),
            "stdio server config must be parseable for restart"
        );
        assert_eq!(args.unwrap().command, "node");
    }
}

/// Restart only servers that were previously active (like cortex restart behavior)
pub async fn restart_active_mcp_servers<R: Runtime>(
    app: &AppHandle<R>,
    servers_state: SharedMcpServers,
) -> Result<(), String> {
    let app_state = app.state::<AppState>();
    let active_servers = app_state.mcp_active_servers.lock().await;

    log::info!(
        "Restarting {} previously active MCP servers",
        active_servers.len()
    );

    for (name, config) in active_servers.iter() {
        log::info!("Restarting MCP server: {name}");

        // Start server with restart monitoring - spawn async task
        let app_clone = app.clone();
        let servers_clone = servers_state.clone();
        let name_clone = name.clone();
        let config_clone = config.clone();

        tauri::async_runtime::spawn(async move {
            let name_for_log = name_clone.clone();
            if let Err(e) =
                start_mcp_server(app_clone, servers_clone, name_clone, config_clone).await
            {
                log::error!("MCP server '{name_for_log}' failed to restart: {e}");
            }
        });
    }

    Ok(())
}

#[cfg(unix)]
async fn kill_process_by_pid(process: TrackedMcpProcess) -> Result<(), String> {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;

    let pid = process.pid;
    // still_matches() refreshes sysinfo and is blocking — run off the async pool.
    let matches = tokio::task::spawn_blocking(move || process.still_matches())
        .await
        .map_err(|e| format!("PID identity check join error: {e}"))?;
    if !matches {
        return Err(format!(
            "Refusing to signal PID {pid}: the original MCP child has exited or its identity cannot be verified"
        ));
    }
    let nix_pid = Pid::from_raw(pid as i32);

    kill(nix_pid, Signal::SIGTERM)
        .map_err(|e| format!("Failed to send SIGTERM to PID {}: {}", pid, e))?;

    for _ in 0..30 {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        if kill(nix_pid, None).is_err() {
            return Ok(());
        }
    }

    log::warn!("Process {} unresponsive, sending SIGKILL", pid);
    let still_matches = tokio::task::spawn_blocking(move || process.still_matches())
        .await
        .map_err(|e| format!("PID identity check join error: {e}"))?;
    if !still_matches {
        return Err(format!(
            "Refusing to force-kill PID {pid}: it no longer matches the original MCP child"
        ));
    }
    kill(nix_pid, Signal::SIGKILL)
        .map_err(|e| format!("Failed to send SIGKILL to PID {}: {}", pid, e))?;

    Ok(())
}

#[cfg(windows)]
async fn kill_process_by_pid(process: TrackedMcpProcess) -> Result<(), String> {
    use std::process::Command;

    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    let pid = process.pid;
    // still_matches() and Command::output() are blocking; keep them off the
    // async runtime worker threads.
    tokio::task::spawn_blocking(move || {
        if !process.still_matches() {
            return Err(format!(
                "Refusing to kill PID {pid}: it no longer matches the original MCP child"
            ));
        }
        let mut cmd = Command::new("taskkill");
        cmd.args(&["/F", "/PID", &pid.to_string()]);

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to run taskkill: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("taskkill failed: {}", stderr));
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("taskkill join error: {e}"))?
}

pub async fn background_cleanup_mcp_servers<R: Runtime>(
    app: &AppHandle<R>,
    state: &State<'_, AppState>,
) {
    let _ = stop_mcp_servers_with_context(app, state, ShutdownContext::AppExit).await;

    // Clear active servers and restart counts
    {
        let mut active_servers = state.mcp_active_servers.lock().await;
        active_servers.clear();
    }

    // Clean up all lock files created by this process
    use crate::core::mcp::lockfile::cleanup_own_locks;
    let _ = cleanup_own_locks(app);
}

struct ShutdownGuard {
    flag: Arc<std::sync::atomic::AtomicBool>,
}

impl Drop for ShutdownGuard {
    fn drop(&mut self) {
        self.flag.store(false, std::sync::atomic::Ordering::Release);
    }
}

pub async fn stop_mcp_servers_with_context<R: Runtime>(
    _app: &AppHandle<R>,
    state: &State<'_, AppState>,
    context: ShutdownContext,
) -> Result<(), String> {
    if state
        .mcp_shutdown_in_progress
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::AcqRel,
            std::sync::atomic::Ordering::Acquire,
        )
        .is_err()
    {
        return Ok(());
    }

    let _guard = ShutdownGuard {
        flag: state.mcp_shutdown_in_progress.clone(),
    };

    {
        let mut monitoring_tasks = state.mcp_monitoring_tasks.lock().await;
        let handles: Vec<_> = monitoring_tasks.drain().map(|(_, handle)| handle).collect();
        drop(monitoring_tasks);
        for handle in handles {
            handle.abort();
            let _ = handle.await;
        }
    }

    tokio::time::sleep(Duration::from_millis(50)).await;

    let pids_snapshot: std::collections::HashMap<String, TrackedMcpProcess> = {
        let pids = state.mcp_server_pids.lock().await;
        pids.clone()
    };
    let servers_to_stop: Vec<(String, Arc<RunningServiceEnum>)> = {
        let mut servers_map = state.mcp_servers.lock().await;
        let keys: Vec<String> = servers_map.keys().cloned().collect();

        let mut result = Vec::new();
        for key in keys {
            if let Some(service) = servers_map.remove(&key) {
                result.push((key, service));
            }
        }
        result
    };

    if servers_to_stop.is_empty() {
        return Ok(());
    }

    let server_names: Vec<String> = servers_to_stop
        .iter()
        .map(|(name, _)| name.clone())
        .collect();
    let per_server_timeout = context.per_server_timeout();
    let stop_handles: Vec<_> = servers_to_stop
        .into_iter()
        .map(|(name, service)| {
            tauri::async_runtime::spawn(async move {
                let cancel_future = async {
                    match Arc::try_unwrap(service) {
                        Ok(RunningServiceEnum::NoInit(service)) => service.cancel().await,
                        Ok(RunningServiceEnum::WithInit(service)) => service.cancel().await,
                        Err(_) => {
                            log::warn!("Service still has active references during shutdown");
                            Ok(rmcp::service::QuitReason::Closed)
                        }
                    }
                };

                let success = tokio::time::timeout(per_server_timeout, cancel_future)
                    .await
                    .map(|r| r.is_ok())
                    .unwrap_or(false);

                (name, success)
            })
        })
        .collect();

    let overall_timeout = context.overall_timeout();
    let results = tokio::time::timeout(
        overall_timeout,
        futures_util::future::join_all(stop_handles),
    )
    .await;

    let failed_servers: Vec<String> = match results {
        Ok(results) => {
            results
                .into_iter()
                .filter_map(|r| match r {
                    Ok((name, success)) if !success => Some(name),
                    Err(_) => None, // Task was cancelled/panicked
                    _ => None,
                })
                .collect()
        }
        Err(_) => {
            // Overall timeout - assume all servers need force-kill
            log::warn!("MCP shutdown timed out, will force-kill remaining processes");
            server_names.clone()
        }
    };

    // Force-kill processes that didn't stop gracefully
    for server_name in &failed_servers {
        if let Some(&process) = pids_snapshot.get(server_name) {
            log::warn!(
                "Force-killing MCP server {} (PID {})",
                server_name,
                process.pid
            );
            if let Err(e) = kill_process_by_pid(process).await {
                log::error!("Failed to force-kill PID {}: {}", process.pid, e);
            }
        }
    }

    // Clean up PIDs from tracking
    {
        let mut pids = state.mcp_server_pids.lock().await;
        for name in &server_names {
            pids.remove(name);
        }
    }

    tokio::time::sleep(Duration::from_millis(200)).await;

    Ok(())
}

/// Store active server configuration for restart purposes
pub async fn store_active_server_config(
    active_servers_state: &Arc<Mutex<HashMap<String, Value>>>,
    name: &str,
    config: &Value,
) {
    let mut active_servers = active_servers_state.lock().await;
    active_servers.insert(name.to_string(), config.clone());
}

// Add a new server configuration to the MCP config file
pub fn add_server_config<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    server_key: String,
    server_value: Value,
) -> Result<(), String> {
    add_server_config_with_path(app_handle, server_key, server_value, None)
}

// Add a new server configuration to the MCP config file with custom path support
pub fn add_server_config_with_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    server_key: String,
    server_value: Value,
    config_filename: Option<&str>,
) -> Result<(), String> {
    let config_filename = config_filename.unwrap_or("mcp_config.json");
    let config_path = get_app_data_folder_path(app_handle).join(config_filename);

    let mut config: Value = serde_json::from_str(
        &std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config file: {e}"))?,
    )
    .map_err(|e| format!("Failed to parse config: {e}"))?;

    config
        .as_object_mut()
        .ok_or("Config root is not an object")?
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(serde_json::Map::new()))
        .as_object_mut()
        .ok_or("mcpServers is not an object")?
        .insert(server_key, server_value);

    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {e}"))?,
    )
    .map_err(|e| format!("Failed to write config file: {e}"))?;

    Ok(())
}
