use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Child;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub pid: i32,
    pub port: i32,
    pub model_id: String,
    pub model_path: String,
    pub is_embedding: bool,
    #[serde(skip_serializing)]
    pub api_key: String,
    #[serde(default)]
    pub mmproj_path: Option<String>,
}

pub struct LLamaBackendSession {
    pub child: Child,
    pub info: SessionInfo,
}

/// LlamaCpp plugin state
pub struct LlamacppState {
    pub llama_server_process: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
}

impl Default for LlamacppState {
    fn default() -> Self {
        Self {
            llama_server_process: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl LlamacppState {
    pub fn new() -> Self {
        Self::default()
    }
}
