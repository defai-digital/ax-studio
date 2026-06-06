use tauri::AppHandle;

use super::models::{AgentRunLog, AgentRunLogSummary};
use super::service;

#[tauri::command]
pub async fn save_agent_run_log(
    app: AppHandle,
    thread_id: String,
    log: AgentRunLog,
) -> Result<(), String> {
    service::save_agent_run_log(&app, &thread_id, &log)
}

#[tauri::command]
pub async fn list_agent_run_logs(
    app: AppHandle,
    thread_id: String,
) -> Result<Vec<AgentRunLogSummary>, String> {
    service::list_agent_run_logs(&app, &thread_id)
}

#[tauri::command]
pub async fn get_agent_run_log(
    app: AppHandle,
    thread_id: String,
    run_id: String,
) -> Result<AgentRunLog, String> {
    service::get_agent_run_log(&app, &thread_id, &run_id)
}
