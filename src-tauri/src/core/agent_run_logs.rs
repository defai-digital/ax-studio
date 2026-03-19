use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- is_valid_id ---

    #[test]
    fn test_is_valid_id_alphanumeric() {
        assert!(is_valid_id("abc123"));
        assert!(is_valid_id("ABC"));
        assert!(is_valid_id("a"));
    }

    #[test]
    fn test_is_valid_id_with_hyphens_and_underscores() {
        assert!(is_valid_id("my-run-log"));
        assert!(is_valid_id("my_run_log"));
        assert!(is_valid_id("a-b_c-123"));
    }

    #[test]
    fn test_is_valid_id_empty() {
        assert!(!is_valid_id(""));
    }

    #[test]
    fn test_is_valid_id_invalid_chars() {
        assert!(!is_valid_id("path/traversal"));
        assert!(!is_valid_id("has spaces"));
        assert!(!is_valid_id("has.dot"));
        assert!(!is_valid_id("../evil"));
        assert!(!is_valid_id("semi;colon"));
    }

    // --- AgentRunLog serialization ---

    #[test]
    fn test_agent_run_log_serialize_deserialize() {
        let log = AgentRunLog {
            id: "run-001".to_string(),
            team_id: "team-1".to_string(),
            thread_id: "thread-1".to_string(),
            status: "completed".to_string(),
            steps: vec![serde_json::json!({"step": 1})],
            total_tokens: 1500,
            orchestrator_tokens: 500,
            started_at: 1700000000,
            completed_at: Some(1700001000),
            error: None,
        };

        let json = serde_json::to_string(&log).unwrap();
        let deserialized: AgentRunLog = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.id, "run-001");
        assert_eq!(deserialized.team_id, "team-1");
        assert_eq!(deserialized.status, "completed");
        assert_eq!(deserialized.total_tokens, 1500);
        assert_eq!(deserialized.completed_at, Some(1700001000));
        assert!(deserialized.error.is_none());
    }

    #[test]
    fn test_agent_run_log_with_error() {
        let log = AgentRunLog {
            id: "run-002".to_string(),
            team_id: "team-1".to_string(),
            thread_id: "thread-1".to_string(),
            status: "failed".to_string(),
            steps: vec![],
            total_tokens: 100,
            orchestrator_tokens: 100,
            started_at: 1700000000,
            completed_at: None,
            error: Some("timeout".to_string()),
        };

        let json = serde_json::to_string(&log).unwrap();
        let deserialized: AgentRunLog = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.error.unwrap(), "timeout");
        assert!(deserialized.completed_at.is_none());
    }

    // --- AgentRunLogSummary ---

    #[test]
    fn test_agent_run_log_summary_serialize() {
        let summary = AgentRunLogSummary {
            id: "run-001".to_string(),
            status: "completed".to_string(),
            total_tokens: 1500,
            started_at: 1700000000,
        };

        let json = serde_json::to_value(&summary).unwrap();
        assert_eq!(json["id"], "run-001");
        assert_eq!(json["status"], "completed");
        assert_eq!(json["total_tokens"], 1500);
        assert_eq!(json["started_at"], 1700000000u64);
    }
}

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

fn run_logs_dir(app: &AppHandle, thread_id: &str) -> Result<PathBuf, String> {
    if !is_valid_id(thread_id) {
        return Err("Invalid thread_id format".to_string());
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = data_dir.join("agent-run-logs").join(thread_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn save_agent_run_log(
    app: AppHandle,
    thread_id: String,
    log: AgentRunLog,
) -> Result<(), String> {
    if !is_valid_id(&log.id) {
        return Err("Invalid run log id format".to_string());
    }
    let path = run_logs_dir(&app, &thread_id)?.join(format!("{}.json", log.id));
    let content = serde_json::to_string_pretty(&log).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_agent_run_logs(
    app: AppHandle,
    thread_id: String,
) -> Result<Vec<AgentRunLogSummary>, String> {
    let dir = run_logs_dir(&app, &thread_id)?;
    let mut summaries = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries {
            match entry {
                Ok(entry) => {
                    if entry.path().extension().map_or(false, |e| e == "json") {
                        match fs::read_to_string(entry.path()) {
                            Ok(content) => match serde_json::from_str::<AgentRunLog>(&content) {
                                Ok(log) => summaries.push(AgentRunLogSummary {
                                    id: log.id,
                                    status: log.status,
                                    total_tokens: log.total_tokens,
                                    started_at: log.started_at,
                                }),
                                Err(e) => log::warn!(
                                    "Skipping malformed run log {:?}: {}",
                                    entry.path(),
                                    e
                                ),
                            },
                            Err(e) => {
                                log::warn!("Failed to read run log {:?}: {}", entry.path(), e)
                            }
                        }
                    }
                }
                Err(e) => log::warn!("Error reading directory entry: {}", e),
            }
        }
    }
    summaries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(summaries)
}

#[tauri::command]
pub async fn get_agent_run_log(
    app: AppHandle,
    thread_id: String,
    run_id: String,
) -> Result<AgentRunLog, String> {
    if !is_valid_id(&run_id) {
        return Err("Invalid run_id format".to_string());
    }
    let path = run_logs_dir(&app, &thread_id)?.join(format!("{}.json", run_id));
    let content = fs::read_to_string(&path).map_err(|e| format!("Run log not found: {}", e))?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}
