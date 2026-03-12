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
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/other/allowed/dir"
      ],
      "env": {},
      "active": false
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      "env": {},
      "active": false
    },
    "ax-studio": {
      "command": "node",
      "args": ["~/Documents/Defai/ax/ax-fabric/packages/fabric-ingest/dist/cli.js", "mcp", "server"],
      "env": {},
      "active": false,
      "official": true
    }
  },
  "mcpSettings": {
    "toolCallTimeoutSeconds": 30,
    "baseRestartDelayMs": 1000,
    "maxRestartDelayMs": 30000,
    "backoffMultiplier": 2.0
  }
}"#;
