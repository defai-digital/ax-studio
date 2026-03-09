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

fn teams_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = data_dir.join("agent-teams");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn list_agent_teams(app: AppHandle) -> Result<Vec<AgentTeam>, String> {
    let dir = teams_dir(&app)?;
    let mut teams = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
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

#[tauri::command]
pub async fn get_agent_team(app: AppHandle, team_id: String) -> Result<AgentTeam, String> {
    if !is_valid_id(&team_id) {
        return Err("Invalid team_id format".to_string());
    }
    let path = teams_dir(&app)?.join(format!("{}.json", team_id));
    let content = fs::read_to_string(&path).map_err(|e| format!("Team not found: {}", e))?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_agent_team(app: AppHandle, team: AgentTeam) -> Result<AgentTeam, String> {
    if !is_valid_id(&team.id) {
        return Err("Invalid team id format".to_string());
    }
    let path = teams_dir(&app)?.join(format!("{}.json", team.id));
    let content = serde_json::to_string_pretty(&team).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(team)
}

#[tauri::command]
pub async fn delete_agent_team(app: AppHandle, team_id: String) -> Result<(), String> {
    if !is_valid_id(&team_id) {
        return Err("Invalid team_id format".to_string());
    }
    let path = teams_dir(&app)?.join(format!("{}.json", team_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
