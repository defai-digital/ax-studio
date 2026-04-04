use std::{fs, sync::Arc};
use tauri::Wry;
use tauri_plugin_store::Store;

use crate::core::app::commands::get_app_data_folder_path;
use crate::core::mcp::helpers::add_server_config;

const AX_STUDIO_MCP_PACKAGE: &str = "@ax-studio/fabric-ingest";

// Migrate MCP servers configuration
pub fn migrate_mcp_servers(
    app_handle: tauri::AppHandle,
    store: Arc<Store<Wry>>,
) -> Result<(), String> {
    let mcp_version = store
        .get("mcp_version")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    if mcp_version < 1 {
        log::info!("Migrating MCP schema version 1");
        let result = add_server_config(
            app_handle.clone(),
            "exa".to_string(),
            serde_json::json!({
                  "command": "npx",
                  "args": ["-y", "exa-mcp-server"],
                  "env": { "EXA_API_KEY": "YOUR_EXA_API_KEY_HERE" },
                  "active": false
            }),
        );
        if let Err(e) = result {
            log::error!("Failed to add server config: {e}");
        }
    }
    // Migration version 2 was Browser MCP (removed)
    if mcp_version < 3 {
        log::info!("Migrating MCP schema version 3: Updating Exa to streamable HTTP");
        if let Err(e) = migrate_exa_to_http(app_handle.clone()) {
            log::error!("Failed to migrate Exa to HTTP: {e}");
        }
    }
    if mcp_version < 4 {
        log::info!("Migrating MCP schema version 4: Adding AX Studio MCP server");
        let mcp_config = resolve_ax_fabric_mcp_config();
        let result = add_server_config(app_handle.clone(), "ax-studio".to_string(), mcp_config);
        if let Err(e) = result {
            log::error!("Failed to add AX Studio MCP server config: {e}");
        }
    }
    if mcp_version < 5 {
        log::info!("Migrating MCP schema version 5: Renaming ax-fabric MCP server to ax-studio");
        if let Err(e) = rename_mcp_server_key(app_handle.clone(), "ax-fabric", "ax-studio") {
            log::error!("Failed to rename ax-fabric MCP server config: {e}");
        }
    }
    if mcp_version < 6 {
        log::info!(
            "Migrating MCP schema version 6: Removing deprecated integration-github MCP server"
        );
        if let Err(e) = remove_mcp_server_keys(app_handle.clone(), &["integration-github"]) {
            log::error!("Failed to remove integration-github: {e}");
        }
    }
    if mcp_version < 7 {
        log::info!("Migrating MCP schema version 7: Adding --experimental-sqlite flag to ax-studio MCP server");
        if let Err(e) = patch_ax_studio_sqlite_flag(app_handle) {
            log::error!("Failed to patch ax-studio sqlite flag: {e}");
        }
    }
    store.set("mcp_version", 7);
    store
        .save()
        .map_err(|e| format!("Failed to save store: {e}"))?;
    Ok(())
}

/// Build the default MCP server config for ax-fabric.
/// Uses npx as the default command which will work once the package is
/// published to npm. Users can override the command and path via
/// Settings → MCP Servers in the UI.
fn resolve_ax_fabric_mcp_config() -> serde_json::Value {
    serde_json::json!({
        "command": "npx",
        "args": ["-y", AX_STUDIO_MCP_PACKAGE, "mcp", "server"],
        "env": {},
        "active": false,
        "official": true
    })
}

fn rename_mcp_server_key(
    app_handle: tauri::AppHandle,
    old_key: &str,
    new_key: &str,
) -> Result<(), String> {
    let config_path = get_app_data_folder_path(app_handle).join("mcp_config.json");

    if !config_path.exists() {
        return Ok(());
    }

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        if !servers.contains_key(new_key) {
            if let Some(old_value) = servers.remove(old_key) {
                servers.insert(new_key.to_string(), old_value);
            }
        }
    }

    fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
    )
    .map_err(|e| format!("Failed to write MCP config: {e}"))?;

    Ok(())
}

fn remove_mcp_server_keys(app_handle: tauri::AppHandle, keys: &[&str]) -> Result<(), String> {
    let config_path = get_app_data_folder_path(app_handle).join("mcp_config.json");

    if !config_path.exists() {
        return Ok(());
    }

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    let mut changed = false;
    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        for key in keys {
            if servers.remove(*key).is_some() {
                changed = true;
            }
        }
    }

    if changed {
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config)
                .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
        )
        .map_err(|e| format!("Failed to write MCP config: {e}"))?;
    }

    Ok(())
}

/// Ensure the ax-studio MCP server args include `--experimental-sqlite`
/// when the command is `node`.  Node.js requires this flag for `node:sqlite`
/// which fabric-ingest's SemanticStore uses.
fn patch_ax_studio_sqlite_flag(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_app_data_folder_path(app_handle).join("mcp_config.json");

    if !config_path.exists() {
        return Ok(());
    }

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    let mut changed = false;
    if let Some(server) = config
        .get_mut("mcpServers")
        .and_then(|s| s.as_object_mut())
        .and_then(|s| s.get_mut("ax-studio"))
        .and_then(|s| s.as_object_mut())
    {
        let is_node = server
            .get("command")
            .and_then(|c| c.as_str())
            .map(|c| c == "node")
            .unwrap_or(false);

        if is_node {
            if let Some(args) = server.get_mut("args").and_then(|a| a.as_array_mut()) {
                let has_flag = args
                    .iter()
                    .any(|a| a.as_str() == Some("--experimental-sqlite"));
                if !has_flag {
                    // Insert at the front so it precedes the script path
                    args.insert(
                        0,
                        serde_json::Value::String("--experimental-sqlite".to_string()),
                    );
                    changed = true;
                }
            }
        }
    }

    if changed {
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config)
                .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
        )
        .map_err(|e| format!("Failed to write MCP config: {e}"))?;
    }

    Ok(())
}

fn migrate_exa_to_http(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_app_data_folder_path(app_handle).join("mcp_config.json");

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        servers.insert(
            "exa".to_string(),
            serde_json::json!({
                "type": "http",
                "url": "https://mcp.exa.ai/mcp".to_string(),
                "command": "",
                "args": [],
                "env": {},
                "active": true
            }),
        );
    }

    fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
    )
    .map_err(|e| format!("Failed to write MCP config: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_ax_fabric_mcp_config_structure() {
        let config = resolve_ax_fabric_mcp_config();
        assert_eq!(config["command"], "npx");
        let args = config["args"].as_array().unwrap();
        assert_eq!(args.len(), 4);
        assert_eq!(args[0], "-y");
        assert_eq!(args[1], AX_STUDIO_MCP_PACKAGE);
        assert_eq!(args[2], "mcp");
        assert_eq!(args[3], "server");
    }

    #[test]
    fn test_resolve_ax_fabric_mcp_config_fields() {
        let config = resolve_ax_fabric_mcp_config();
        assert_eq!(config["command"], "npx");
        assert_eq!(config["active"], false);
        assert_eq!(config["official"], true);
        assert!(config["env"].is_object());
        let args = config["args"].as_array().unwrap();
        assert!(args.contains(&serde_json::json!("-y")));
        assert!(args.contains(&serde_json::json!(AX_STUDIO_MCP_PACKAGE)));
    }

    #[test]
    fn test_ax_studio_mcp_package_constant() {
        assert_eq!(AX_STUDIO_MCP_PACKAGE, "@ax-studio/fabric-ingest");
    }
}
