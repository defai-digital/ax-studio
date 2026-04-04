use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTeam {
    pub id: String,
    pub name: String,
    pub description: String,
    pub orchestration: serde_json::Value,
    pub orchestrator_instructions: Option<String>,
    pub orchestrator_model_id: Option<String>,
    pub agent_ids: Vec<String>,
    pub variables: Option<Vec<serde_json::Value>>,
    pub token_budget: Option<u64>,
    pub cost_approval_threshold: Option<f64>,
    pub parallel_stagger_ms: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
}
