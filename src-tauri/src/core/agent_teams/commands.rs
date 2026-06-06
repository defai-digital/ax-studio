use tauri::AppHandle;

use super::models::AgentTeam;
use super::service;

#[tauri::command]
pub async fn list_agent_teams(app: AppHandle) -> Result<Vec<AgentTeam>, String> {
    service::list_agent_teams(&app)
}

#[tauri::command]
pub async fn get_agent_team(app: AppHandle, team_id: String) -> Result<AgentTeam, String> {
    service::get_agent_team(&app, &team_id)
}

#[tauri::command]
pub async fn save_agent_team(app: AppHandle, team: AgentTeam) -> Result<AgentTeam, String> {
    service::save_agent_team(&app, team)
}

#[tauri::command]
pub async fn delete_agent_team(app: AppHandle, team_id: String) -> Result<(), String> {
    service::delete_agent_team(&app, &team_id)
}
