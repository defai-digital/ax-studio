use std::{collections::HashMap, sync::Arc};

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

/// URLs for the four Ax-Fabric backend services.
/// Defaults point to localhost with per-service ports.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AxFabricServiceConfig {
    /// API Service — OpenAI-compatible model inference proxy (FastAPI)
    pub api_service_url: String,
    /// Retrieval Service — document ingestion, embedding, semantic search (FastAPI)
    pub retrieval_service_url: String,
    /// Agents Service — AI agent orchestration (FastAPI)
    pub agents_service_url: String,
    /// AkiDB — vector database REST API
    pub akidb_url: String,
}

impl Default for AxFabricServiceConfig {
    fn default() -> Self {
        Self {
            api_service_url: "http://127.0.0.1:8000".to_string(),
            retrieval_service_url: "http://127.0.0.1:8001".to_string(),
            agents_service_url: "http://127.0.0.1:8002".to_string(),
            akidb_url: "http://127.0.0.1:8003".to_string(),
        }
    }
}

pub enum RunningServiceEnum {
    NoInit(RunningService<RoleClient, ()>),
    WithInit(RunningService<RoleClient, InitializeRequestParam>),
}
pub type SharedMcpServers = Arc<Mutex<HashMap<String, RunningServiceEnum>>>;

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
    /// Ax-Fabric backend service URLs (Retrieval, Agents, AkiDB, API Service)
    pub ax_fabric_service_config: Arc<Mutex<AxFabricServiceConfig>>,
    /// Jupyter session ids per thread (thread_id → sandbox session_id)
    pub sandbox_sessions: Arc<Mutex<HashMap<String, String>>>,
    /// Base URL for the agent-infra/sandbox container
    pub sandbox_url: Arc<Mutex<String>>,
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
