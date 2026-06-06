use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunLog {
    pub id: String,
    pub team_id: String,
    pub thread_id: String,
    pub status: String,
    pub steps: Vec<serde_json::Value>,
    pub total_tokens: u64,
    pub orchestrator_tokens: u64,
    pub started_at: u64,
    pub completed_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunLogSummary {
    pub id: String,
    pub status: String,
    pub total_tokens: u64,
    pub started_at: u64,
}
