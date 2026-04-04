use super::helpers::{_download_files_internal, err_to_string};
use super::models::DownloadItem;
use crate::core::app::commands::get_app_data_folder_path;
use crate::core::state::DownloadState;
use ax_studio_utils::normalize_path;
use std::collections::HashMap;
use tauri::{Runtime, State};
use tokio_util::sync::CancellationToken;

#[tauri::command]
pub async fn download_files<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, DownloadState>,
    items: Vec<DownloadItem>,
    task_id: &str,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    // insert cancel tokens
    let cancel_token = CancellationToken::new();
    {
        let mut download_manager = state.manager.lock().await;
        if let Some(existing_token) = download_manager.cancel_tokens.remove(task_id) {
            log::info!("Cancelling existing download task: {task_id}");
            existing_token.cancel();
        }
        download_manager
            .cancel_tokens
            .insert(task_id.to_string(), cancel_token.clone());
    }
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

    // cleanup
    {
        let mut download_manager = state.manager.lock().await;
        download_manager.cancel_tokens.remove(task_id);
    }

    // delete files if cancelled
    if cancel_token.is_cancelled() {
        let app_data_folder = get_app_data_folder_path(app.clone());
        for item in items {
            let save_path = normalize_path(&app_data_folder.join(&item.save_path));
            if save_path.starts_with(&app_data_folder) {
                let _ = std::fs::remove_file(&save_path); // best-effort cleanup
            } else {
                log::warn!(
                    "Skipped unsafe cleanup path outside app data folder: {}",
                    save_path.display()
                );
            }
        }
    }

    result.map_err(err_to_string)
}

#[tauri::command]
pub async fn cancel_download_task(
    state: State<'_, DownloadState>,
    task_id: &str,
) -> Result<(), String> {
    // NOTE: might want to add User-Agent header
    let mut download_manager = state.manager.lock().await;
    if let Some(token) = download_manager.cancel_tokens.remove(task_id) {
        token.cancel();
        log::info!("Cancelled download task: {task_id}");
        Ok(())
    } else {
        Err(format!("No download task: {task_id}"))
    }
}
