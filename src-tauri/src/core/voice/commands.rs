//! Tauri commands for voice input (local whisper.cpp STT).
//!
//! Model downloads deliberately reuse the existing downloads infrastructure:
//! `voice_download_model` translates the request into a `download_files`
//! call, so resume/verification/progress events all behave exactly like LLM
//! model downloads (progress events on `download-{taskId}` with the shared
//! `DownloadEvent` payload shape).

use std::collections::HashMap;

use tauri::State;

use crate::core::app::commands::get_app_data_folder_path;
use crate::core::downloads::models::DownloadItem;
use crate::core::state::AppState;

use super::models::{VoiceError, VoiceStatus, WhisperModel};
use super::state::VoiceState;

/// Begin capturing microphone audio. Fails fast with
/// `model-not-downloaded` when the selected GGML model is missing, and with
/// `mic-permission-denied` / `mic-unavailable` when the device cannot be
/// opened. The OS permission prompt (macOS TCC) is triggered on first use.
#[tauri::command]
pub async fn voice_start_recording(
    app: tauri::AppHandle,
    state: State<'_, VoiceState>,
    model: String,
) -> Result<(), VoiceError> {
    let model = WhisperModel::parse(&model)?;
    let model_path = model.file_path(&get_app_data_folder_path(app.clone()));
    if !model_path.is_file() {
        return Err(VoiceError::ModelNotDownloaded(model.id().to_string()));
    }
    state.worker(&app)?.start_recording(model_path).await
}

/// Stop recording, transcribe on-device, and return the transcript. The
/// audio buffer is discarded before this resolves.
#[tauri::command]
pub async fn voice_stop_recording(state: State<'_, VoiceState>) -> Result<String, VoiceError> {
    match state.worker_if_spawned() {
        Some(worker) => worker.stop_recording().await,
        None => Err(VoiceError::NotRecording),
    }
}

/// Abort an in-flight recording without transcribing; audio is discarded.
#[tauri::command]
pub async fn voice_cancel_recording(state: State<'_, VoiceState>) -> Result<(), VoiceError> {
    if let Some(worker) = state.worker_if_spawned() {
        worker.cancel_recording().await?;
    }
    Ok(())
}

/// Snapshot of the recorder state, mic level, and whether `model` (default
/// `base.en`) is present in the app data folder.
#[tauri::command]
pub async fn voice_get_status(
    app: tauri::AppHandle,
    state: State<'_, VoiceState>,
    model: Option<String>,
) -> Result<VoiceStatus, VoiceError> {
    let model = match model.as_deref() {
        Some(id) => WhisperModel::parse(id)?,
        None => WhisperModel::DEFAULT,
    };
    let downloaded = model.file_path(&get_app_data_folder_path(app)).is_file();
    Ok(state.status(downloaded))
}

/// Download a whisper GGML model into the app data folder. Progress arrives
/// on the `download-voice-model-{base-en|small-en}` event with the shared
/// `DownloadEvent` payload; cancel via `cancel_download_task` with the same
/// task id.
#[tauri::command]
pub async fn voice_download_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model: String,
) -> Result<(), VoiceError> {
    let model = WhisperModel::parse(&model)?;
    // The downloads policy requires the destination's parent to exist before
    // it can canonicalize the save path.
    let dir = model.dir_path(&get_app_data_folder_path(app.clone()));
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| VoiceError::Internal(format!("failed to create {}: {e}", dir.display())))?;

    let item = DownloadItem {
        url: model.url(),
        save_path: model.relative_save_path(),
        proxy: None,
        sha256: None,
        size: None,
        model_id: Some(model.id().to_string()),
    };
    crate::core::downloads::commands::download_files(
        app,
        state,
        vec![item],
        &model.download_task_id(),
        HashMap::new(),
    )
    .await
    .map_err(VoiceError::Download)
}

/// Remove a previously downloaded model file. Deleting a model that was
/// never downloaded is a no-op.
#[tauri::command]
pub async fn voice_delete_model(app: tauri::AppHandle, model: String) -> Result<(), VoiceError> {
    let model = WhisperModel::parse(&model)?;
    let path = model.file_path(&get_app_data_folder_path(app));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => {
            log::info!("Deleted voice model {}", path.display());
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(VoiceError::Internal(format!(
            "failed to delete {}: {e}",
            path.display()
        ))),
    }
}
