/// Windows process-creation flag that suppresses the console window for child
/// processes. Used when spawning MCP servers and helper commands on Windows.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

// Default MCP runtime settings
pub const DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS: u64 = 30;
pub const DEFAULT_MCP_BASE_RESTART_DELAY_MS: u64 = 1000; // Start with 1 second
pub const DEFAULT_MCP_MAX_RESTART_DELAY_MS: u64 = 30000; // Cap at 30 seconds
pub const DEFAULT_MCP_BACKOFF_MULTIPLIER: f64 = 2.0; // Double the delay each time

pub const DEFAULT_MCP_CONFIG: &str = r#"{
  "mcpServers": {
    "exa": {
      "type": "http",
      "url": "https://mcp.exa.ai/mcp",
      "command": "",
      "args": [],
      "env": {},
      "active": true
    },
    "ax-bi": {
      "type": "http",
      "url": "http://127.0.0.1:31421/mcp",
      "command": "",
      "args": [],
      "env": {},
      "active": false
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "~/Desktop"
      ],
      "env": {},
      "active": false
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      "env": {},
      "active": false
    }
  },
  "mcpSettings": {
    "toolCallTimeoutSeconds": 30,
    "baseRestartDelayMs": 1000,
    "maxRestartDelayMs": 30000,
    "backoffMultiplier": 2.0
  }
}"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_does_not_reference_unpublished_ax_fabric_package() {
        let parsed: serde_json::Value = serde_json::from_str(DEFAULT_MCP_CONFIG).unwrap();
        assert!(parsed["mcpServers"]["ax-studio"].is_null());
        assert!(!DEFAULT_MCP_CONFIG.contains("@ax-fabric/fabric-ingest"));
    }
}
