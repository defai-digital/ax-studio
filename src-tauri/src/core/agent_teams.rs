use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ax-studio-agent-teams-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_team(id: &str, updated_at: u64) -> AgentTeam {
        AgentTeam {
            id: id.to_string(),
            name: format!("Team {id}"),
            description: "A test team".to_string(),
            orchestration: serde_json::json!({"type": "sequential"}),
            orchestrator_instructions: Some("Do things in order".to_string()),
            orchestrator_model_id: Some("gpt-4".to_string()),
            agent_ids: vec!["agent-1".to_string(), "agent-2".to_string()],
            variables: Some(vec![serde_json::json!({"name": "input", "type": "string"})]),
            token_budget: Some(10000),
            cost_approval_threshold: Some(0.5),
            parallel_stagger_ms: Some(100),
            created_at: 1700000000,
            updated_at,
        }
    }

    // --- is_valid_id ---

    #[test]
    fn test_is_valid_id_valid() {
        assert!(is_valid_id("team-1"));
        assert!(is_valid_id("my_team"));
        assert!(is_valid_id("ABC123"));
    }

    #[test]
    fn test_is_valid_id_invalid() {
        assert!(!is_valid_id(""));
        assert!(!is_valid_id("a/b"));
        assert!(!is_valid_id("a b"));
        assert!(!is_valid_id("../"));
    }

    // --- AgentTeam serialization ---

    #[test]
    fn test_agent_team_serialize_deserialize() {
        let team = AgentTeam {
            id: "team-abc".to_string(),
            name: "Test Team".to_string(),
            description: "A test team".to_string(),
            orchestration: serde_json::json!({"type": "sequential"}),
            orchestrator_instructions: Some("Do things in order".to_string()),
            orchestrator_model_id: Some("gpt-4".to_string()),
            agent_ids: vec!["agent-1".to_string(), "agent-2".to_string()],
            variables: Some(vec![serde_json::json!({"name": "input", "type": "string"})]),
            token_budget: Some(10000),
            cost_approval_threshold: Some(0.5),
            parallel_stagger_ms: Some(100),
            created_at: 1700000000,
            updated_at: 1700001000,
        };

        let json = serde_json::to_string(&team).unwrap();
        let deserialized: AgentTeam = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.id, "team-abc");
        assert_eq!(deserialized.name, "Test Team");
        assert_eq!(deserialized.agent_ids.len(), 2);
        assert_eq!(deserialized.token_budget, Some(10000));
        assert_eq!(deserialized.cost_approval_threshold, Some(0.5));
        assert_eq!(deserialized.parallel_stagger_ms, Some(100));
    }

    #[test]
    fn test_agent_team_minimal() {
        let team = AgentTeam {
            id: "t1".to_string(),
            name: "Min".to_string(),
            description: String::new(),
            orchestration: serde_json::json!(null),
            orchestrator_instructions: None,
            orchestrator_model_id: None,
            agent_ids: vec![],
            variables: None,
            token_budget: None,
            cost_approval_threshold: None,
            parallel_stagger_ms: None,
            created_at: 0,
            updated_at: 0,
        };

        let json = serde_json::to_string(&team).unwrap();
        let deserialized: AgentTeam = serde_json::from_str(&json).unwrap();

        assert!(deserialized.orchestrator_instructions.is_none());
        assert!(deserialized.variables.is_none());
        assert!(deserialized.token_budget.is_none());
    }

    #[tokio::test]
    async fn test_save_get_list_and_delete_agent_team() {
        let dir = unique_test_dir();

        let older = sample_team("team-old", 10);
        let newer = sample_team("team-new", 20);

        save_agent_team_in_dir(&dir, older.clone()).unwrap();
        save_agent_team_in_dir(&dir, newer.clone()).unwrap();

        let listed = list_agent_teams_in_dir(&dir).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "team-new");
        assert_eq!(listed[1].id, "team-old");

        let fetched = get_agent_team_in_dir(&dir, "team-new").unwrap();
        assert_eq!(fetched.id, newer.id);
        assert_eq!(fetched.name, newer.name);

        delete_agent_team_in_dir(&dir, "team-new").unwrap();

        let listed_after_delete = list_agent_teams_in_dir(&dir).unwrap();
        assert_eq!(listed_after_delete.len(), 1);
        assert_eq!(listed_after_delete[0].id, "team-old");

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_agent_team_commands_reject_invalid_ids() {
        let dir = unique_test_dir();
        let invalid_team = sample_team("../bad", 1);

        let save_error = save_agent_team_in_dir(&dir, invalid_team).unwrap_err();
        assert_eq!(save_error, "Invalid team id format");

        let get_error = get_agent_team_in_dir(&dir, "../bad").unwrap_err();
        assert_eq!(get_error, "Invalid team_id format");

        let delete_error = delete_agent_team_in_dir(&dir, "../bad").unwrap_err();
        assert_eq!(delete_error, "Invalid team_id format");

        let _ = fs::remove_dir_all(&dir);
    }
}

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

fn teams_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = data_dir.join("agent-teams");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn list_agent_teams_in_dir(dir: &Path) -> Result<Vec<AgentTeam>, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut teams = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries {
            match entry {
                Ok(entry) => {
                    if entry.path().extension().map_or(false, |e| e == "json") {
                        match fs::read_to_string(entry.path()) {
                            Ok(content) => match serde_json::from_str::<AgentTeam>(&content) {
                                Ok(team) => teams.push(team),
                                Err(e) => log::warn!(
                                    "Skipping malformed team file {:?}: {}",
                                    entry.path(),
                                    e
                                ),
                            },
                            Err(e) => {
                                log::warn!("Failed to read team file {:?}: {}", entry.path(), e)
                            }
                        }
                    }
                }
                Err(e) => log::warn!("Error reading directory entry: {}", e),
            }
        }
    }
    teams.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(teams)
}

fn get_agent_team_in_dir(dir: &Path, team_id: &str) -> Result<AgentTeam, String> {
    if !is_valid_id(team_id) {
        return Err("Invalid team_id format".to_string());
    }
    let path = dir.join(format!("{}.json", team_id));
    let content = fs::read_to_string(&path).map_err(|e| format!("Team not found: {}", e))?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn save_agent_team_in_dir(dir: &Path, team: AgentTeam) -> Result<AgentTeam, String> {
    if !is_valid_id(&team.id) {
        return Err("Invalid team id format".to_string());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", team.id));
    let content = serde_json::to_string_pretty(&team).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(team)
}

fn delete_agent_team_in_dir(dir: &Path, team_id: &str) -> Result<(), String> {
    if !is_valid_id(team_id) {
        return Err("Invalid team_id format".to_string());
    }
    let path = dir.join(format!("{}.json", team_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn list_agent_teams_inner<R: Runtime>(app: AppHandle<R>) -> Result<Vec<AgentTeam>, String> {
    let dir = teams_dir(&app)?;
    list_agent_teams_in_dir(&dir)
}

async fn get_agent_team_inner<R: Runtime>(
    app: AppHandle<R>,
    team_id: String,
) -> Result<AgentTeam, String> {
    if !is_valid_id(&team_id) {
        return Err("Invalid team_id format".to_string());
    }
    let dir = teams_dir(&app)?;
    get_agent_team_in_dir(&dir, &team_id)
}

async fn save_agent_team_inner<R: Runtime>(
    app: AppHandle<R>,
    team: AgentTeam,
) -> Result<AgentTeam, String> {
    if !is_valid_id(&team.id) {
        return Err("Invalid team id format".to_string());
    }
    let dir = teams_dir(&app)?;
    save_agent_team_in_dir(&dir, team)
}

async fn delete_agent_team_inner<R: Runtime>(
    app: AppHandle<R>,
    team_id: String,
) -> Result<(), String> {
    if !is_valid_id(&team_id) {
        return Err("Invalid team_id format".to_string());
    }
    let dir = teams_dir(&app)?;
    delete_agent_team_in_dir(&dir, &team_id)
}

#[tauri::command]
pub async fn list_agent_teams(app: AppHandle) -> Result<Vec<AgentTeam>, String> {
    list_agent_teams_inner(app).await
}

#[tauri::command]
pub async fn get_agent_team(app: AppHandle, team_id: String) -> Result<AgentTeam, String> {
    get_agent_team_inner(app, team_id).await
}

#[tauri::command]
pub async fn save_agent_team(app: AppHandle, team: AgentTeam) -> Result<AgentTeam, String> {
    save_agent_team_inner(app, team).await
}

#[tauri::command]
pub async fn delete_agent_team(app: AppHandle, team_id: String) -> Result<(), String> {
    delete_agent_team_inner(app, team_id).await
}
