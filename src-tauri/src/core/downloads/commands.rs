use super::helpers::{_download_files_internal, err_to_string, resolve_download_save_path};
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
    // insert cancel tokens
    let cancel_token = CancellationToken::new();
    let generation = {
        let mut download_manager = state.download_manager.lock().await;
        if let Some(existing_task) = download_manager.cancel_tokens.remove(task_id) {
            log::info!("Cancelling existing download task: {task_id}");
            existing_task.token.cancel();
        }
        download_manager.next_generation += 1;
        let generation = download_manager.next_generation;
        download_manager.cancel_tokens.insert(
            task_id.to_string(),
            super::models::DownloadTaskState {
                token: cancel_token.clone(),
                generation,
            },
        );
        generation
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

    let should_cleanup_cancelled_outputs = {
        let mut download_manager = state.download_manager.lock().await;
        match download_manager.cancel_tokens.get(task_id) {
            Some(task) if task.generation == generation => {
                let should_cleanup = task.token.is_cancelled();
                download_manager.cancel_tokens.remove(task_id);
                should_cleanup
            }
            _ => false,
        }
    };

    // delete files if cancelled
    if should_cleanup_cancelled_outputs {
        for item in items {
            match resolve_download_save_path(&app, &item.save_path) {
                Ok(save_path) => {
                    let _ = tokio::fs::remove_file(&save_path).await;
                }
                Err(error) => {
                    log::warn!("Skipped unsafe cleanup path after cancelled download: {error}");
                }
            }
        }
    }

    result.map_err(err_to_string)
}

#[tauri::command]
pub async fn cancel_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
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
