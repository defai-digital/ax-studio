use super::helpers::{
    _download_files_internal, download_destination_keys, err_to_string,
    resolve_download_destinations, validate_download_request,
};
use super::models::DownloadItem;
use crate::core::state::AppState;
use std::collections::HashMap;
use tauri::{Runtime, State};
use tokio_util::sync::CancellationToken;

#[tauri::command]
pub async fn download_files<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    items: Vec<DownloadItem>,
    task_id: &str,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    // Validate the entire untrusted IPC payload before allocating task state or
    // touching the network. The browser extension performs friendly validation,
    // but the Rust command is the actual privilege boundary.
    validate_download_request(&items, task_id, &headers)?;
    let destination_keys = resolve_download_destinations(&app, &items)?
        .iter()
        .flat_map(|path| download_destination_keys(path))
        .collect();

    let cancel_token = CancellationToken::new();
    let generation = {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.register_task(task_id, cancel_token.clone(), destination_keys)?
    };
    // Resume is handled in helpers via .tmp/.url sidecar files.
    let result = _download_files_internal(
        app.clone(),
        &items,
        &headers,
        task_id,
        true,
        cancel_token.clone(),
    )
    .await;

    {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.finish_task(task_id, generation);
    }

    // Partial-file cleanup is owned by download_single_file. Never remove the
    // final destination here: it may be a previously verified model that this
    // cancelled generation never replaced.

    result.map_err(err_to_string)
}

#[tauri::command]
pub async fn cancel_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
    super::helpers::validate_download_task_id(task_id)?;
    let token = {
        let download_manager = state.download_manager.lock().await;
        download_manager
            .cancel_tokens
            .get(task_id)
            .map(|t| t.token.clone())
            .ok_or_else(|| format!("No download task: {task_id}"))?
    };
    token.cancel();
    log::info!("Cancelled download task: {task_id}");
    Ok(())
}
