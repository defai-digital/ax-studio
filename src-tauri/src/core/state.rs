use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Arc,
};

use crate::core::{downloads::models::DownloadManagerState, mcp::models::McpSettings};
use rmcp::{
    model::{CallToolRequestParams, CallToolResult, InitializeRequestParams, Tool},
    service::RunningService,
    RoleClient, ServiceError,
};
use tokio::sync::watch;
use tokio::sync::{oneshot, Mutex};

/// Server handle type for managing the proxy server lifecycle
pub struct ServerHandle {
    pub task:
        tauri::async_runtime::JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>,
    pub shutdown_tx: watch::Sender<bool>,
}

pub type ProviderModelIndex = HashMap<String, Vec<String>>;

/// Provider configuration for remote model providers
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    #[serde(skip_serializing)]
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderCustomHeader>,
    pub models: Vec<String>,
}

fn is_reserved_provider_header(name: &str) -> bool {
    matches!(
        name,
        "accept-encoding"
            | "authorization"
            | "connection"
            | "content-length"
            | "cookie"
            | "forwarded"
            | "host"
            | "origin"
            | "proxy-authorization"
            | "proxy-connection"
            | "referer"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "x-api-key"
            | "x-forwarded-for"
            | "x-forwarded-host"
            | "x-forwarded-proto"
    ) || name.starts_with("proxy-")
        || name.starts_with("sec-")
}

impl ProviderConfig {
    pub fn validate(&self) -> Result<(), String> {
        const MAX_PROVIDER_NAME_BYTES: usize = 128;
        const MAX_PROVIDER_URL_BYTES: usize = 4 * 1024;
        const MAX_PROVIDER_SECRET_BYTES: usize = 16 * 1024;
        const MAX_PROVIDER_HEADERS: usize = 64;
        const MAX_HEADER_NAME_BYTES: usize = 256;
        const MAX_HEADER_VALUE_BYTES: usize = 16 * 1024;
        const MAX_PROVIDER_MODELS: usize = 4_096;
        const MAX_MODEL_NAME_BYTES: usize = 512;

        if self.provider.trim().is_empty()
            || self.provider.len() > MAX_PROVIDER_NAME_BYTES
            || self.provider.chars().any(char::is_control)
        {
            return Err(format!(
                "Provider name must contain between 1 and {MAX_PROVIDER_NAME_BYTES} non-control bytes"
            ));
        }
        if self
            .api_key
            .as_ref()
            .is_some_and(|key| key.len() > MAX_PROVIDER_SECRET_BYTES || key.contains('\0'))
        {
            return Err(format!(
                "Provider API key exceeds the {MAX_PROVIDER_SECRET_BYTES}-byte limit or contains NUL"
            ));
        }
        if let Some(ref url) = self.base_url {
            if url.len() > MAX_PROVIDER_URL_BYTES || url.chars().any(char::is_control) {
                return Err(format!(
                    "Provider URL exceeds the {MAX_PROVIDER_URL_BYTES}-byte limit or contains control characters"
                ));
            }
            if !url.trim().is_empty() && url::Url::parse(url).is_err() {
                return Err(format!(
                    "Invalid base_url for provider '{}': {}",
                    self.provider, url
                ));
            }
        }
        if self.custom_headers.len() > MAX_PROVIDER_HEADERS {
            return Err(format!(
                "Provider has more than {MAX_PROVIDER_HEADERS} custom headers"
            ));
        }
        let mut header_names = HashSet::new();
        for header in &self.custom_headers {
            if header.header.is_empty()
                || header.header.len() > MAX_HEADER_NAME_BYTES
                || header.value.len() > MAX_HEADER_VALUE_BYTES
                || http::header::HeaderName::from_bytes(header.header.as_bytes()).is_err()
                || http::header::HeaderValue::from_str(&header.value).is_err()
            {
                return Err("Provider contains an invalid custom header".to_string());
            }
            let normalized = header.header.to_ascii_lowercase();
            if is_reserved_provider_header(&normalized) {
                return Err(format!(
                    "Provider custom header '{}' is reserved",
                    header.header
                ));
            }
            if !header_names.insert(normalized) {
                return Err("Provider contains duplicate custom header names".to_string());
            }
        }
        if self.models.len() > MAX_PROVIDER_MODELS {
            return Err(format!(
                "Provider has more than {MAX_PROVIDER_MODELS} models"
            ));
        }
        let mut model_names = HashSet::new();
        for model in &self.models {
            if model.trim().is_empty()
                || model.len() > MAX_MODEL_NAME_BYTES
                || model.chars().any(char::is_control)
            {
                return Err(format!(
                    "Model names must contain between 1 and {MAX_MODEL_NAME_BYTES} non-control bytes"
                ));
            }
            if !model_names.insert(model) {
                return Err("Provider contains duplicate model names".to_string());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderCustomHeader {
    pub header: String,
    pub value: String,
}

#[derive(Debug, Clone, Default)]
pub struct ProviderState {
    pub configs: HashMap<String, ProviderConfig>,
    pub model_index: ProviderModelIndex,
}

impl ProviderState {
    pub fn sync_model_index(&mut self) {
        self.model_index = build_provider_model_index(&self.configs);
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
        params: CallToolRequestParams,
    ) -> Result<CallToolResult, ServiceError> {
        match self {
            Self::NoInit(s) => s.call_tool(params).await,
            Self::WithInit(s) => s.call_tool(params).await,
        }
    }
}

pub enum RunningServiceEnum {
    NoInit(RunningService<RoleClient, ()>),
    WithInit(RunningService<RoleClient, InitializeRequestParams>),
}
pub type SharedMcpServers = Arc<Mutex<HashMap<String, Arc<RunningServiceEnum>>>>;

pub struct AppState {
    pub mcp_servers: SharedMcpServers,
    pub download_manager: Arc<Mutex<DownloadManagerState>>,
    pub mcp_active_servers: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    pub server_handle: Arc<Mutex<Option<ServerHandle>>>,
    pub tool_call_cancellations: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    pub akidb_sync_cancellation: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    pub mcp_settings: Arc<Mutex<McpSettings>>,
    pub mcp_shutdown_in_progress: Arc<Mutex<bool>>,
    pub mcp_monitoring_tasks: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
    pub background_cleanup_handle: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    pub mcp_server_pids: Arc<Mutex<HashMap<String, u32>>>,
    /// Remote provider configurations and model index are kept under one lock.
    pub provider_state: Arc<Mutex<ProviderState>>,
    /// One-time write targets approved via native save dialog
    pub approved_save_paths: Arc<Mutex<HashSet<PathBuf>>>,
    /// Files and directories explicitly selected through the native open dialog.
    pub approved_read_files: Arc<Mutex<HashSet<PathBuf>>>,
    pub approved_read_directories: Arc<Mutex<HashSet<PathBuf>>>,
    pub factory_reset_lock: Arc<Mutex<()>>,
    pub active_streams: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    /// Cold-start buffer for OS file-open requests (Dock drop / "Open with")
    /// that arrive before the frontend mounts.
    pub pending_open_files: Arc<crate::core::open_files::PendingOpenFiles>,
}

pub fn build_provider_model_index(
    provider_configs: &HashMap<String, ProviderConfig>,
) -> ProviderModelIndex {
    let mut index = HashMap::new();

    for config in provider_configs.values() {
        for model in &config.models {
            index
                .entry(model.clone())
                .or_insert_with(Vec::new)
                .push(config.provider.clone());
        }
    }

    index
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
        assert!(
            json.get("api_key").is_none(),
            "api_key should not be serialized"
        );
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

    #[test]
    fn provider_config_rejects_reserved_headers_duplicates_and_invalid_models() {
        let base = ProviderConfig {
            provider: "openai".to_string(),
            api_key: None,
            base_url: Some("https://api.example.com/v1".to_string()),
            custom_headers: vec![],
            models: vec!["model-a".to_string()],
        };

        let mut reserved = base.clone();
        reserved.custom_headers.push(ProviderCustomHeader {
            header: "Authorization".to_string(),
            value: "override".to_string(),
        });
        assert!(reserved.validate().is_err());

        let mut duplicate = base.clone();
        duplicate.custom_headers = vec![
            ProviderCustomHeader {
                header: "X-Test".to_string(),
                value: "one".to_string(),
            },
            ProviderCustomHeader {
                header: "x-test".to_string(),
                value: "two".to_string(),
            },
        ];
        assert!(duplicate.validate().is_err());

        let mut duplicate_model = base;
        duplicate_model.models.push("model-a".to_string());
        assert!(duplicate_model.validate().is_err());
    }
}
