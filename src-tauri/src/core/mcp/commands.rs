use rmcp::model::{CallToolRequestParam, CallToolResult};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::sync::oneshot;
use tokio::time::timeout;

use super::{
    constants::DEFAULT_MCP_CONFIG,
    helpers::{restart_active_mcp_servers, start_mcp_server},
};
use crate::core::{
    app::commands::get_app_data_folder_path,
    mcp::models::McpSettings,
    state::{AppState, McpState},
};
use crate::core::{
    mcp::models::ToolWithServer,
    state::{RunningServiceEnum, SharedMcpServers},
};
use std::{fs, sync::Arc, time::Duration};

async fn tool_call_timeout(state: &State<'_, McpState>) -> Duration {
    state.settings.lock().await.tool_call_timeout_duration()
}

#[tauri::command]
pub async fn activate_mcp_server<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, McpState>,
    name: String,
    config: Value,
) -> Result<(), String> {
    let servers: SharedMcpServers = state.servers.clone();

    // Use the modified start_mcp_server that returns first attempt result
    start_mcp_server(app, servers, name, config).await
}

#[tauri::command]
pub async fn deactivate_mcp_server<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, McpState>,
    name: String,
) -> Result<(), String> {
    log::info!("Deactivating MCP server: {name}");

    // First, mark server as manually deactivated
    // Remove from active servers list
    {
        let mut active_servers = state.active_servers.lock().await;
        active_servers.remove(&name);
        log::info!("Removed MCP server {name} from active servers list");
    }

    // Clone the Arc reference first (without removing from map) so the server
    // stays tracked if cancellation fails.
    let servers = state.servers.clone();
    let service = {
        let servers_map = servers.lock().await;
        servers_map
            .get(&name)
            .cloned()
            .ok_or_else(|| format!("Server {name} not found"))?
    };

    // Attempt cancellation while server is still in the map
    match Arc::try_unwrap(service) {
        Ok(RunningServiceEnum::NoInit(service)) => {
            log::info!("Stopping server {name}...");
            service.cancel().await.map_err(|e| e.to_string())?;
        }
        Ok(RunningServiceEnum::WithInit(service)) => {
            log::info!("Stopping server {name} with initialization...");
            service.cancel().await.map_err(|e| e.to_string())?;
        }
        Err(_arc) => {
            log::warn!("Server {name} still has active references, marking for removal");
        }
    }

    // Only remove from map after cancellation attempt succeeds
    {
        let mut servers_map = servers.lock().await;
        servers_map.remove(&name);
    }

    {
        let mut pids = state.server_pids.lock().await;
        pids.remove(&name);
    }
    log::info!("Server {name} stopped successfully and marked as deactivated.");

    // Emit mcp-update event so frontend can refresh tools list
    if let Err(e) = app.emit(
        "mcp-update",
        serde_json::json!({
            "server": name
        }),
    ) {
        log::error!("Failed to emit mcp-update event: {e}");
    }

    Ok(())
}

#[tauri::command]
pub async fn restart_mcp_servers<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, McpState>,
) -> Result<(), String> {
    use super::helpers::{stop_mcp_servers_with_context, ShutdownContext};

    let servers = state.servers.clone();

    stop_mcp_servers_with_context(&app, &state, ShutdownContext::ManualRestart).await?;

    // Restart only previously active servers (like cortex)
    restart_active_mcp_servers(&app, servers).await?;

    app.emit("mcp-update", "MCP servers updated")
        .map_err(|e| format!("Failed to emit event: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn get_connected_servers(
    _app: AppHandle<impl Runtime>,
    state: State<'_, McpState>,
) -> Result<Vec<String>, String> {
    let servers = state.servers.clone();
    let servers_map = servers.lock().await;
    Ok(servers_map.keys().cloned().collect())
}

/// Retrieves all available tools from all MCP servers with server information
///
/// # Arguments
/// * `state` - Application state containing MCP server connections
///
/// # Returns
/// * `Result<Vec<Tool>, String>` - A vector of all tools if successful, or an error message if failed
///
/// This function:
/// 1. Locks the MCP servers mutex to access server connections
/// 2. Iterates through all connected servers
/// 3. Gets the list of tools from each server
/// 4. Associates each tool with its parent server name
/// 5. Combines all tools into a single vector
/// 6. Returns the combined list of all available tools with server information
#[tauri::command]
pub async fn get_tools(state: State<'_, McpState>) -> Result<Vec<ToolWithServer>, String> {
    let timeout_duration = tool_call_timeout(&state).await;
    let mut all_tools: Vec<ToolWithServer> = Vec::new();

    // Collect server refs under lock, then drop lock before querying
    let server_refs: Vec<(String, Arc<crate::core::state::RunningServiceEnum>)> = {
        let servers = state.servers.lock().await;
        servers
            .iter()
            .map(|(name, svc)| (name.clone(), svc.clone()))
            .collect()
    };

    for (server_name, service) in &server_refs {
        // List tools with timeout — lock is NOT held
        let tools_future = service.list_all_tools();
        let tools = match timeout(timeout_duration, tools_future).await {
            Ok(Ok(tools)) => tools,
            Ok(Err(e)) => {
                log::warn!("MCP server {} failed to list tools: {}", server_name, e);
                continue;
            }
            Err(_) => {
                log::warn!(
                    "Listing tools timed out after {} seconds",
                    timeout_duration.as_secs()
                );
                continue;
            }
        };

        for tool in tools {
            all_tools.push(ToolWithServer {
                name: tool.name.to_string(),
                description: tool.description.as_ref().map(|d| d.to_string()),
                input_schema: serde_json::Value::Object((*tool.input_schema).clone()),
                server: server_name.clone(),
            });
        }
    }

    Ok(all_tools)
}

/// Calls a tool on an MCP server by name with optional arguments
///
/// # Arguments
/// * `state` - Application state containing MCP server connections
/// * `tool_name` - Name of the tool to call
/// * `server_name` - Optional name of the server to call the tool from (for disambiguation)
/// * `arguments` - Optional map of argument names to values
/// * `cancellation_token` - Optional token to allow cancellation from JS side
///
/// # Returns
/// * `Result<CallToolResult, String>` - Result of the tool call if successful, or error message if failed
///
/// This function:
/// 1. Locks the MCP servers mutex to access server connections
/// 2. If server_name is provided, looks for the tool in that specific server
/// 3. Otherwise, searches through all servers for one containing the named tool
/// 4. When found, calls the tool on that server with the provided arguments
/// 5. Supports cancellation via cancellation_token
/// 6. Returns error if no server has the requested tool or if specified server not found
#[tauri::command]
pub async fn call_tool(
    state: State<'_, McpState>,
    app_state: State<'_, AppState>,
    tool_name: String,
    server_name: Option<String>,
    arguments: Option<Map<String, Value>>,
    cancellation_token: Option<String>,
) -> Result<CallToolResult, String> {
    let timeout_duration = tool_call_timeout(&state).await;
    // Set up cancellation if token is provided
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

    if let Some(token) = &cancellation_token {
        let mut cancellations = app_state.tool_call_cancellations.lock().await;
        cancellations.insert(token.clone(), cancel_tx);
    }

    // Phase 1: Collect Arc refs under lock, then search without lock
    let (server_refs, server_not_found) = {
        let servers = state.servers.lock().await;

        let refs: Vec<(String, Arc<crate::core::state::RunningServiceEnum>)> =
            if let Some(ref server) = server_name {
                servers
                    .iter()
                    .filter(|(name, _)| *name == server)
                    .map(|(name, svc)| (name.clone(), svc.clone()))
                    .collect()
            } else {
                servers
                    .iter()
                    .map(|(name, svc)| (name.clone(), svc.clone()))
                    .collect()
            };

        let not_found = refs.is_empty() && server_name.is_some();
        (refs, not_found)
    };
    // Lock is dropped here

    if server_not_found {
        if let Some(ref server) = server_name {
            // Clean up cancellation token before early return
            if let Some(token) = &cancellation_token {
                let mut cancellations = app_state.tool_call_cancellations.lock().await;
                cancellations.remove(token);
            }
            return Err(format!("Server '{server}' not found"));
        }
    }

    // Search for tool without holding lock
    let mut target_service = None;
    for (srv_name, service) in server_refs.iter() {
        let tools = match timeout(timeout_duration, service.list_all_tools()).await {
            Ok(Ok(tools)) => tools,
            _ => continue,
        };

        if tools.iter().any(|t| t.name == tool_name) {
            log::debug!("Found tool {tool_name} in server {srv_name}");
            target_service = Some(service.clone());
            break;
        }
    }

    let service = match target_service {
        Some(s) => s,
        None => {
            // Clean up cancellation token before early return
            if let Some(token) = &cancellation_token {
                let mut cancellations = app_state.tool_call_cancellations.lock().await;
                cancellations.remove(token);
            }
            return Err(format!("Tool {tool_name} not found"));
        }
    };

    // Phase 2: Call the tool without holding the servers lock
    let tool_call = service.call_tool(CallToolRequestParam {
        name: tool_name.clone().into(),
        arguments,
    });

    let result = if cancellation_token.is_some() {
        tokio::select! {
            result = timeout(timeout_duration, tool_call) => {
                match result {
                    Ok(call_result) => call_result.map_err(|e| e.to_string()),
                    Err(_) => Err(format!(
                        "Tool call '{tool_name}' timed out after {} seconds",
                        timeout_duration.as_secs()
                    )),
                }
            }
            _ = cancel_rx => {
                Err(format!("Tool call '{tool_name}' was cancelled"))
            }
        }
    } else {
        match timeout(timeout_duration, tool_call).await {
            Ok(call_result) => call_result.map_err(|e| e.to_string()),
            Err(_) => Err(format!(
                "Tool call '{tool_name}' timed out after {} seconds",
                timeout_duration.as_secs()
            )),
        }
    };

    // Clean up cancellation token
    if let Some(token) = &cancellation_token {
        let mut cancellations = app_state.tool_call_cancellations.lock().await;
        cancellations.remove(token);
    }

    result
}

/// Cancels a running tool call by its cancellation token
///
/// # Arguments
/// * `state` - Application state containing cancellation tokens
/// * `cancellation_token` - Token identifying the tool call to cancel
///
/// # Returns
/// * `Result<(), String>` - Success if token found and cancelled, error otherwise
#[tauri::command]
pub async fn cancel_tool_call(
    app_state: State<'_, AppState>,
    cancellation_token: String,
) -> Result<(), String> {
    let mut cancellations = app_state.tool_call_cancellations.lock().await;

    if let Some(cancel_tx) = cancellations.remove(&cancellation_token) {
        // Send cancellation signal - ignore if receiver is already dropped
        let _ = cancel_tx.send(());
        log::info!("Tool call with token {cancellation_token} cancelled");
        Ok(())
    } else {
        Err(format!("Cancellation token {cancellation_token} not found"))
    }
}

fn parse_mcp_settings(value: Option<&Value>) -> McpSettings {
    value
        .and_then(|v| serde_json::from_value::<McpSettings>(v.clone()).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn get_mcp_configs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let mut path = get_app_data_folder_path(app.clone());
    path.push("mcp_config.json");

    // Create default empty config if file doesn't exist
    if !path.exists() {
        log::info!("mcp_config.json not found, creating default empty config");
        fs::write(&path, DEFAULT_MCP_CONFIG)
            .map_err(|e| format!("Failed to create default MCP config: {e}"))?;
    }

    let config_string = fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let mut config_value: Value = if config_string.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&config_string).unwrap_or_else(|error| {
            log::error!("Failed to parse existing MCP config, regenerating defaults: {error}");
            json!({})
        })
    };

    if !config_value.is_object() {
        config_value = json!({});
    }

    let mut mutated = false;
    let config_object = config_value
        .as_object_mut()
        .ok_or("MCP config must be a JSON object")?;

    let settings = parse_mcp_settings(config_object.get("mcpSettings"));
    if !config_object.contains_key("mcpSettings") {
        config_object.insert(
            "mcpSettings".to_string(),
            serde_json::to_value(&settings)
                .map_err(|e| format!("Failed to serialize MCP settings: {e}"))?,
        );
        mutated = true;
    }

    if !config_object.contains_key("mcpServers") {
        config_object.insert("mcpServers".to_string(), json!({}));
        mutated = true;
    }

    let mcp_servers = config_object
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .ok_or("mcpServers is not an object")?;

    // Remove deprecated MCP servers if present (features removed)
    for key in &[
        "Ax-Studio Browser MCP",
        "browsermcp",
        "fetch",
        "serper",
        "integration-github",
    ] {
        if mcp_servers.remove(*key).is_some() {
            mutated = true;
        }
    }

    // Persist any mutations back to disk
    if mutated {
        fs::write(
            &path,
            serde_json::to_string_pretty(&config_value)
                .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
        )
        .map_err(|e| format!("Failed to write MCP config: {e}"))?;
    }

    // Update in-memory state with latest settings
    {
        let mcp_state = app.state::<McpState>();
        let mut settings_guard = mcp_state.settings.lock().await;
        *settings_guard = settings.clone();
    }

    serde_json::to_string_pretty(&config_value)
        .map_err(|e| format!("Failed to serialize MCP config: {e}"))
}

#[tauri::command]
pub async fn save_mcp_configs<R: Runtime>(
    app: AppHandle<R>,
    configs: String,
) -> Result<(), String> {
    let mut path = get_app_data_folder_path(app.clone());
    path.push("mcp_config.json");
    log::info!("save mcp configs, path: {path:?}");

    let mut config_value: Value =
        serde_json::from_str(&configs).map_err(|e| format!("Invalid MCP config payload: {e}"))?;

    if !config_value.is_object() {
        return Err("MCP config must be a JSON object".to_string());
    }

    let config_object = config_value
        .as_object_mut()
        .ok_or("MCP config must be a JSON object")?;
    let settings = parse_mcp_settings(config_object.get("mcpSettings"));

    if !config_object.contains_key("mcpSettings") {
        config_object.insert(
            "mcpSettings".to_string(),
            serde_json::to_value(&settings)
                .map_err(|e| format!("Failed to serialize MCP settings: {e}"))?,
        );
    }

    if !config_object.contains_key("mcpServers") {
        config_object.insert("mcpServers".to_string(), json!({}));
    }

    fs::write(
        &path,
        serde_json::to_string_pretty(&config_value)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
    )
    .map_err(|e| e.to_string())?;

    {
        let mcp_state = app.state::<McpState>();
        let mut settings_guard = mcp_state.settings.lock().await;
        *settings_guard = settings;
    }

    Ok(())
}
