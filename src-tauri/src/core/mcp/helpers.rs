use rmcp::{
    model::{ClientCapabilities, ClientInfo, Implementation},
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, SseClientTransport,
        StreamableHttpClientTransport, TokioChildProcess,
    },
    ServiceExt,
};
use serde_json::Value;
use std::{collections::HashMap, env, process::Stdio, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_http::reqwest;
use tokio::{
    io::AsyncReadExt,
    process::Command,
    sync::Mutex,
    time::{sleep, timeout},
};

#[cfg(windows)]
use crate::core::mcp::constants::CREATE_NO_WINDOW;
use crate::core::{
    app::commands::get_app_data_folder_path,
    mcp::models::{McpServerConfig, McpSettings},
    state::{AppState, RunningServiceEnum, SharedMcpServers},
};
use ax_studio_utils::{can_override_npx, can_override_uvx};

/// Allowed executables for MCP server commands
const ALLOWED_COMMANDS: &[&str] = &["node", "python", "python3", "bun", "npx", "uvx"];
const DEFAULT_MCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// Environment variables that should be rejected for security reasons
const DANGEROUS_ENV_KEYS: &[&str] = &[
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
    "LD_LIBRARY_PATH",
    "PATH",
];

#[derive(Debug, Clone, Copy)]
pub enum ShutdownContext {
    AppExit,       // User closing app - be fast
    ManualRestart, // User restarting servers - be thorough
    FactoryReset,  // Deleting data - be very thorough
}

impl ShutdownContext {
    pub fn per_server_timeout(&self) -> Duration {
        match self {
            Self::AppExit => Duration::from_millis(500),
            Self::ManualRestart => Duration::from_secs(2),
            Self::FactoryReset => Duration::from_secs(5),
        }
    }

    pub fn overall_timeout(&self) -> Duration {
        match self {
            Self::AppExit => Duration::from_millis(1500),
            Self::ManualRestart => Duration::from_secs(5),
            Self::FactoryReset => Duration::from_secs(10),
        }
    }
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
    let app_path_str = app_path.to_string_lossy().to_string();
    log::trace!(
        "Load MCP configs from {}",
        app_path_str.clone() + "/mcp_config.json"
    );
    let config_content = std::fs::read_to_string(app_path_str + "/mcp_config.json")
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

/// Monitor MCP server health without removing it from the HashMap
pub async fn monitor_mcp_server_handle(
    servers_state: SharedMcpServers,
    name: String,
    shutdown_flag: Arc<Mutex<bool>>,
) -> Option<rmcp::service::QuitReason> {
    log::info!("Monitoring MCP server {name} health");

    // Monitor server health with periodic checks
    loop {
        // Small delay between health checks
        sleep(Duration::from_secs(5)).await;

        {
            let shutdown = shutdown_flag.lock().await;
            if *shutdown {
                return Some(rmcp::service::QuitReason::Closed);
            }
        }

        let (health_check_result, service_snapshot) = {
            let service = {
                let servers = servers_state.lock().await;
                match servers.get(&name) {
                    Some(s) => s.clone(),
                    None => {
                        log::info!("MCP server {name} no longer in running services");
                        return Some(rmcp::service::QuitReason::Closed);
                    }
                }
            };
            // Lock is dropped here — health check runs without holding the lock
            let result = match timeout(Duration::from_secs(2), service.list_all_tools()).await {
                Ok(Ok(_)) => true,
                Ok(Err(e)) => {
                    log::warn!("MCP server {name} health check failed: {e}");
                    false
                }
                Err(_) => {
                    log::warn!("MCP server {name} health check timed out");
                    false
                }
            };
            (result, service)
        };

        if !health_check_result {
            // Server failed health check — only remove if it's the same instance we checked.
            // A concurrent restart may have replaced it with a fresh server.
            log::error!("MCP server {name} failed health check, removing from active servers");
            let service = {
                let mut servers = servers_state.lock().await;
                if let Some(current) = servers.get(&name) {
                    if Arc::ptr_eq(current, &service_snapshot) {
                        servers.remove(&name)
                    } else {
                        log::info!(
                            "MCP server {name} was replaced since health check, skipping removal"
                        );
                        None
                    }
                } else {
                    None
                }
            };
            // Lock dropped — cancel without holding it
            if let Some(service) = service {
                if let Ok(inner) = Arc::try_unwrap(service) {
                    match inner {
                        RunningServiceEnum::NoInit(svc) => {
                            log::info!("Stopping server {name}...");
                            let _ = svc.cancel().await;
                        }
                        RunningServiceEnum::WithInit(svc) => {
                            log::info!("Stopping server {name} with initialization...");
                            let _ = svc.cancel().await;
                        }
                    }
                } else {
                    log::warn!("Service {name} still has active references, skipping cancel");
                }
            }
            return Some(rmcp::service::QuitReason::Closed);
        }
    }
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
        let transport = StreamableHttpClientTransport::with_client(
            reqwest::Client::builder()
                .default_headers({
                    // Map envs to request headers
                    let mut headers: tauri::http::HeaderMap = reqwest::header::HeaderMap::new();
                    for (key, value) in config_params.headers.iter() {
                        if let Some(v_str) = value.as_str() {
                            // Try to map env keys to HTTP header names (case-insensitive)
                            // Most HTTP headers are Title-Case, so we try to convert
                            let header_name =
                                reqwest::header::HeaderName::from_bytes(key.as_bytes());
                            if let Ok(header_name) = header_name {
                                if let Ok(header_value) =
                                    reqwest::header::HeaderValue::from_str(v_str)
                                {
                                    headers.insert(header_name, header_value);
                                }
                            }
                        }
                    }
                    headers
                })
                .connect_timeout(config_params.timeout.unwrap_or(DEFAULT_MCP_CONNECT_TIMEOUT))
                .build()
                .map_err(|e| format!("Failed to build HTTP client for {name}: {e}"))?,
            StreamableHttpClientTransportConfig {
                uri: config_params.url.unwrap().into(),
                ..Default::default()
            },
        );

        let client_info = ClientInfo {
            protocol_version: Default::default(),
            capabilities: ClientCapabilities::default(),
            client_info: Implementation {
                name: "Ax-Studio Streamable Client".to_string(),
                version: "0.0.1".to_string(),
                title: None,
                website_url: None,
                icons: None,
            },
        };
        let client = client_info.serve(transport).await.inspect_err(|e| {
            log::error!("client error: {e:?}");
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
    } else if config_params.transport_type.as_deref() == Some("sse") && config_params.url.is_some()
    {
        let transport = SseClientTransport::start_with_client(
            reqwest::Client::builder()
                .default_headers({
                    // Map envs to request headers
                    let mut headers = reqwest::header::HeaderMap::new();
                    for (key, value) in config_params.headers.iter() {
                        if let Some(v_str) = value.as_str() {
                            // Try to map env keys to HTTP header names (case-insensitive)
                            // Most HTTP headers are Title-Case, so we try to convert
                            let header_name =
                                reqwest::header::HeaderName::from_bytes(key.as_bytes());
                            if let Ok(header_name) = header_name {
                                if let Ok(header_value) =
                                    reqwest::header::HeaderValue::from_str(v_str)
                                {
                                    headers.insert(header_name, header_value);
                                }
                            }
                        }
                    }
                    headers
                })
                .connect_timeout(config_params.timeout.unwrap_or(DEFAULT_MCP_CONNECT_TIMEOUT))
                .build()
                .map_err(|e| format!("Failed to build SSE client for {name}: {e}"))?,
            rmcp::transport::sse_client::SseClientConfig {
                sse_endpoint: config_params.url.unwrap().into(),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| {
            log::error!("transport error: {e:?}");
            format!("Failed to start SSE transport: {e}")
        })?;

        let client_info = ClientInfo {
            protocol_version: Default::default(),
            capabilities: ClientCapabilities::default(),
            client_info: Implementation {
                name: "Ax-Studio SSE Client".to_string(),
                version: "0.0.1".to_string(),
                title: None,
                website_url: None,
                icons: None,
            },
        };
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
        let mut cmd = Command::new(config_params.command.clone());
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
        config_params
            .args
            .iter()
            .filter_map(Value::as_str)
            .for_each(|arg| {
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
        // Inject credentials from secure store for managed integrations
        if let Some(obj) = config.as_object() {
            if obj.get("managed").and_then(|v| v.as_bool()) == Some(true) {
                if let Some(integration_id) = obj.get("integration").and_then(|v| v.as_str()) {
                    match crate::core::integrations::commands::read_credentials(
                        &app,
                        integration_id,
                    ) {
                        Ok(creds) => {
                            if integration_id == "google-workspace" {
                                match crate::core::integrations::oauth::stage_google_workspace_runtime_config(&creds) {
                                    Ok(runtime_env) => {
                                        for (env_key, value) in runtime_env {
                                            cmd.env(env_key, value);
                                        }
                                    }
                                    Err(e) => {
                                        log::warn!(
                                            "Failed to stage Google Workspace runtime credentials for integration '{integration_id}': {e}"
                                        );
                                    }
                                }
                            } else {
                                let env_keys =
                                    crate::core::integrations::constants::integration_env_keys();
                                if let Some(expected_keys) = env_keys.get(integration_id) {
                                    for env_key in expected_keys {
                                        if let Some(value) = creds.get(*env_key) {
                                            cmd.env(env_key, value);
                                        }
                                    }
                                }
                            }
                            log::info!(
                                "Injected secure-store credentials for managed integration '{integration_id}' into MCP server '{name}'"
                            );
                        }
                        Err(e) => {
                            log::warn!(
                                "Failed to read secure-store credentials for integration '{integration_id}': {e}"
                            );
                        }
                    }
                }
            }
        }

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
            pids.insert(name.clone(), pid);
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
        if let Err(_) = timeout(Duration::from_secs(3), inserted_service.list_all_tools()).await {
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
    let obj = config.as_object()?;
    let transport_type = obj.get("type").and_then(|t| t.as_str()).map(String::from);
    let url = obj.get("url").and_then(|u| u.as_str()).map(String::from);

    let is_http = transport_type.as_deref() == Some("http") && url.is_some();

    let command = match obj.get("command").and_then(|c| c.as_str()) {
        Some(cmd) if !cmd.is_empty() => cmd.to_string(),
        _ => {
            if is_http {
                String::new()
            } else {
                return None;
            }
        }
    };

    if !is_http && !ALLOWED_COMMANDS.contains(&command.as_str()) {
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
    envs.retain(|k, _| !DANGEROUS_ENV_KEYS.contains(&k.as_str()));

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

#[cfg(test)]
mod tests {
    use super::*;

    // --- ShutdownContext ---

    #[test]
    fn test_shutdown_context_app_exit_timeouts() {
        let ctx = ShutdownContext::AppExit;
        assert_eq!(ctx.per_server_timeout(), Duration::from_millis(500));
        assert_eq!(ctx.overall_timeout(), Duration::from_millis(1500));
    }

    #[test]
    fn test_shutdown_context_manual_restart_timeouts() {
        let ctx = ShutdownContext::ManualRestart;
        assert_eq!(ctx.per_server_timeout(), Duration::from_secs(2));
        assert_eq!(ctx.overall_timeout(), Duration::from_secs(5));
    }

    #[test]
    fn test_shutdown_context_factory_reset_timeouts() {
        let ctx = ShutdownContext::FactoryReset;
        assert_eq!(ctx.per_server_timeout(), Duration::from_secs(5));
        assert_eq!(ctx.overall_timeout(), Duration::from_secs(10));
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
                "PATH": "/evil/path",
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
        assert!(result.envs.get("LD_PRELOAD").is_none());
        assert!(result.envs.get("PATH").is_none());
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
            let _ = start_mcp_server(app_clone, servers_clone, name_clone, config_clone).await;
        });
    }

    Ok(())
}

pub async fn kill_orphaned_mcp_process_with_app<R: Runtime>(
    app: &AppHandle<R>,
    port: u16,
) -> Result<bool, String> {
    use crate::core::mcp::lockfile::{
        check_and_cleanup_stale_lock, is_process_alive, read_lock_file,
    };

    // Check lock file first (fast path)
    if let Some(lock) = read_lock_file(app, port) {
        log::debug!("Found lock file for port {}: PID={}", port, lock.pid);

        if !is_process_alive(lock.pid) {
            log::info!("Lock file stale, process {} is dead", lock.pid);
            check_and_cleanup_stale_lock(app, port).await?;
            return Ok(true);
        }

        // Process from lock file is alive - verify it's still the MCP process
        if let Some(process_info) = ax_studio_utils::network::get_process_info_by_pid(lock.pid) {
            if ax_studio_utils::network::is_orphaned_mcp_process(&process_info) {
                log::info!(
                    "Lock file PID {} verified as MCP process, attempting kill",
                    lock.pid
                );
                kill_process_by_pid(lock.pid).await?;

                use crate::core::mcp::lockfile::delete_lock_file;
                delete_lock_file(app, port)?;

                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                if ax_studio_utils::network::is_port_available(port) {
                    log::info!("Cleaned up orphaned process via lock file");
                    return Ok(true);
                }
            } else {
                log::warn!(
                    "Lock file PID {} is alive but NOT an MCP process (name: {}, cmd: {:?}). Lock file is stale.",
                    lock.pid,
                    process_info.name,
                    process_info.cmd
                );
                // PID reused by another process, clean up stale lock file
                check_and_cleanup_stale_lock(app, port).await?;
            }
        } else {
            log::debug!(
                "Could not get process info for PID {}, cleaning up lock file",
                lock.pid
            );
            check_and_cleanup_stale_lock(app, port).await?;
        }
    }

    // Fallback: Use lsof/netstat to find process on port
    let process_info = match ax_studio_utils::network::find_process_using_port(port) {
        Some(info) => info,
        None => return Ok(false),
    };

    log::info!(
        "Found process on port {}: PID={}, name={}, cmd={:?}",
        port,
        process_info.pid,
        process_info.name,
        process_info.cmd
    );

    if !ax_studio_utils::network::is_orphaned_mcp_process(&process_info) {
        log::warn!(
            "Port {} occupied by non-Ax-Studio process '{}' (PID {})",
            port,
            process_info.name,
            process_info.pid
        );
        return Err(format!(
            "Port {} is in use by another application '{}' (PID {}). Please close that application or use a different port.",
            port, process_info.name, process_info.pid
        ));
    }

    log::info!("Killing orphaned MCP process: PID {}", process_info.pid);
    kill_process_by_pid(process_info.pid).await?;

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    if ax_studio_utils::network::is_port_available(port) {
        log::info!("Cleaned up orphaned process on port {}", port);
        Ok(true)
    } else {
        Err(format!("Port {} still in use after killing process", port))
    }
}

#[cfg(unix)]
async fn kill_process_by_pid(pid: u32) -> Result<(), String> {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;

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
    kill(nix_pid, Signal::SIGKILL)
        .map_err(|e| format!("Failed to send SIGKILL to PID {}: {}", pid, e))?;

    Ok(())
}

#[cfg(windows)]
async fn kill_process_by_pid(pid: u32) -> Result<(), String> {
    use std::process::Command;

    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

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
    flag: Arc<Mutex<bool>>,
}

impl Drop for ShutdownGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.flag.try_lock() {
            *guard = false;
        } else {
            let flag = self.flag.clone();
            tauri::async_runtime::spawn(async move {
                let mut guard = flag.lock().await;
                *guard = false;
            });
        }
    }
}

pub async fn stop_mcp_servers_with_context<R: Runtime>(
    app: &AppHandle<R>,
    state: &State<'_, AppState>,
    context: ShutdownContext,
) -> Result<(), String> {
    {
        let mut shutdown_in_progress = state.mcp_shutdown_in_progress.lock().await;
        if *shutdown_in_progress {
            return Ok(());
        }
        *shutdown_in_progress = true;
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

    let pids_snapshot: std::collections::HashMap<String, u32> = {
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
        if let Some(&pid) = pids_snapshot.get(server_name) {
            log::warn!("Force-killing MCP server {} (PID {})", server_name, pid);
            if let Err(e) = kill_process_by_pid(pid).await {
                log::error!("Failed to force-kill PID {}: {}", pid, e);
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
