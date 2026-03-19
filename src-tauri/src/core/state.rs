use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Arc,
};

use crate::core::{downloads::models::DownloadManagerState, mcp::models::McpSettings};
use rmcp::{
    model::{CallToolRequestParam, CallToolResult, InitializeRequestParam, Tool},
    service::RunningService,
    RoleClient, ServiceError,
};
use tokio::sync::{oneshot, Mutex};

/// Server handle type for managing the proxy server lifecycle
pub type ServerHandle =
    tauri::async_runtime::JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>;

/// Provider configuration for remote model providers
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderCustomHeader>,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderCustomHeader {
    pub header: String,
    pub value: String,
}


pub enum RunningServiceEnum {
    NoInit(RunningService<RoleClient, ()>),
    WithInit(RunningService<RoleClient, InitializeRequestParam>),
}
pub type SharedMcpServers = Arc<Mutex<HashMap<String, Arc<RunningServiceEnum>>>>;

pub struct AppState {
    pub app_token: Option<String>,
    pub mcp_servers: SharedMcpServers,
    pub download_manager: Arc<Mutex<DownloadManagerState>>,
    pub mcp_active_servers: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    pub server_handle: Arc<Mutex<Option<ServerHandle>>>,
    pub tool_call_cancellations: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    pub mcp_settings: Arc<Mutex<McpSettings>>,
    pub mcp_shutdown_in_progress: Arc<Mutex<bool>>,
    pub mcp_monitoring_tasks: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
    pub background_cleanup_handle: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    pub mcp_server_pids: Arc<Mutex<HashMap<String, u32>>>,
    /// Remote provider configurations (e.g., Anthropic, OpenAI, etc.)
    pub provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    /// One-time write targets approved via native save dialog
    pub approved_save_paths: Arc<Mutex<HashSet<PathBuf>>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_config_default() {
        let config = ProviderConfig::default();
        assert_eq!(config.provider, "");
        assert!(config.api_key.is_none());
        assert!(config.base_url.is_none());
        assert!(config.custom_headers.is_empty());
        assert!(config.models.is_empty());
    }

    #[test]
    fn test_provider_config_serialization() {
        let config = ProviderConfig {
            provider: "openai".to_string(),
            api_key: Some("sk-test-key".to_string()),
            base_url: Some("https://api.openai.com/v1".to_string()),
            custom_headers: vec![ProviderCustomHeader {
                header: "X-Custom".to_string(),
                value: "custom-value".to_string(),
            }],
            models: vec!["gpt-4".to_string(), "gpt-3.5-turbo".to_string()],
        };
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["provider"], "openai");
        assert_eq!(json["api_key"], "sk-test-key");
        assert_eq!(json["base_url"], "https://api.openai.com/v1");
        assert_eq!(json["custom_headers"][0]["header"], "X-Custom");
        assert_eq!(json["custom_headers"][0]["value"], "custom-value");
        assert_eq!(json["models"][0], "gpt-4");
        assert_eq!(json["models"][1], "gpt-3.5-turbo");
    }

    #[test]
    fn test_provider_config_deserialization() {
        let json_str = r#"{
            "provider": "anthropic",
            "api_key": "sk-ant-test",
            "base_url": "https://api.anthropic.com/v1",
            "custom_headers": [],
            "models": ["claude-3-opus"]
        }"#;
        let config: ProviderConfig = serde_json::from_str(json_str).unwrap();
        assert_eq!(config.provider, "anthropic");
        assert_eq!(config.api_key.as_deref(), Some("sk-ant-test"));
        assert_eq!(config.models.len(), 1);
    }

    #[test]
    fn test_provider_config_roundtrip() {
        let original = ProviderConfig {
            provider: "gemini".to_string(),
            api_key: None,
            base_url: Some("https://generativelanguage.googleapis.com".to_string()),
            custom_headers: vec![],
            models: vec!["gemini-pro".to_string()],
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: ProviderConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(original.provider, deserialized.provider);
        assert_eq!(original.api_key, deserialized.api_key);
        assert_eq!(original.base_url, deserialized.base_url);
        assert_eq!(original.models, deserialized.models);
    }

    #[test]
    fn test_provider_custom_header_default() {
        let header = ProviderCustomHeader::default();
        assert_eq!(header.header, "");
        assert_eq!(header.value, "");
    }

    #[test]
    fn test_provider_custom_header_serialization() {
        let header = ProviderCustomHeader {
            header: "anthropic-version".to_string(),
            value: "2023-06-01".to_string(),
        };
        let json = serde_json::to_value(&header).unwrap();
        assert_eq!(json["header"], "anthropic-version");
        assert_eq!(json["value"], "2023-06-01");
    }

    #[test]
    fn test_provider_config_clone() {
        let config = ProviderConfig {
            provider: "openai".to_string(),
            api_key: Some("key".to_string()),
            base_url: Some("url".to_string()),
            custom_headers: vec![ProviderCustomHeader {
                header: "h".to_string(),
                value: "v".to_string(),
            }],
            models: vec!["m1".to_string()],
        };
        let cloned = config.clone();
        assert_eq!(config.provider, cloned.provider);
        assert_eq!(config.api_key, cloned.api_key);
        assert_eq!(config.custom_headers.len(), cloned.custom_headers.len());
    }
}

impl RunningServiceEnum {
    pub async fn list_all_tools(&self) -> Result<Vec<Tool>, ServiceError> {
        match self {
            Self::NoInit(s) => s.list_all_tools().await,
            Self::WithInit(s) => s.list_all_tools().await,
        }
    }
    pub async fn call_tool(
        &self,
        params: CallToolRequestParam,
    ) -> Result<CallToolResult, ServiceError> {
        match self {
            Self::NoInit(s) => s.call_tool(params).await,
            Self::WithInit(s) => s.call_tool(params).await,
        }
    }
}
