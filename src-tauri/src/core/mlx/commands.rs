//! Phase 1 + Phase 2 MLX Tauri commands.
//!
//! * `mlx_runtime_probe` — host + Metal toolchain status from the SDK
//! * `mlx_load_model` — load an MLX model into the in-process worker
//! * `mlx_unload_model` — drop a loaded model
//! * `mlx_list_loaded` — list currently-loaded model ids

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use ax_engine_core::{
    convert::{convert_hf_model_dir, write_manifest},
    NativeModelArtifacts, AX_NATIVE_MODEL_MANIFEST_FILE,
};
use ax_engine_sdk::{current_host_report, current_metal_toolchain_report};
use serde::Serialize;
use tauri::{AppHandle, Runtime, State};

use crate::core::app::commands::get_app_data_folder_path;
use crate::core::hf_cache;
use crate::core::mlx::state::MlxState;
use crate::core::mlx::worker::{ChatMessage, GenerateParams, StreamEvent};

#[derive(Debug, Serialize)]
pub struct MlxRuntimeProbe {
    pub host: HostInfo,
    pub metal: MetalInfo,
}

#[derive(Debug, Serialize)]
pub struct HostInfo {
    pub os: String,
    pub arch: String,
    pub detected_soc: Option<String>,
    pub supported_mlx_runtime: bool,
    pub unsupported_host_override_active: bool,
    pub detection_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MetalInfo {
    pub fully_available: bool,
    pub metal: bool,
    pub metallib: bool,
    pub metal_ar: bool,
}

#[tauri::command]
pub fn mlx_runtime_probe() -> Result<MlxRuntimeProbe, String> {
    let host = current_host_report();
    let metal = current_metal_toolchain_report();
    Ok(MlxRuntimeProbe {
        host: HostInfo {
            os: host.os,
            arch: host.arch,
            detected_soc: host.detected_soc,
            supported_mlx_runtime: host.supported_mlx_runtime,
            unsupported_host_override_active: host.unsupported_host_override_active,
            detection_error: host.detection_error,
        },
        metal: MetalInfo {
            fully_available: metal.fully_available,
            metal: metal.metal.available,
            metallib: metal.metallib.available,
            metal_ar: metal.metal_ar.available,
        },
    })
}

/// Load an MLX model into the in-process worker. If `model_dir` is omitted,
/// resolves `model_id` against AX Studio's app-data downloads first, then the
/// HuggingFace cache
/// (`mlx-community/X-4bit` → `~/.cache/huggingface/hub/models--mlx-community--X-4bit/snapshots/<commit>/`)
/// so the chat frontend can load by HF model id without knowing FS paths.
/// Idempotent: a no-op when the model is already loaded.
#[tauri::command]
pub async fn mlx_load_model<R: Runtime>(
    state: State<'_, MlxState>,
    app_handle: AppHandle<R>,
    model_id: String,
    model_dir: Option<String>,
) -> Result<(), String> {
    let path = match model_dir {
        Some(p) => PathBuf::from(p),
        None => {
            resolve_downloaded_or_cached_model_dir(&app_handle, &model_id).ok_or_else(|| {
                format!(
                    "could not resolve AX Studio download or HF cache snapshot for '{model_id}'"
                )
            })?
        }
    };
    state.worker.load(model_id, path).await
}

/// Resolve an MLX Hugging Face cache snapshot for ax-serving.
///
/// This keeps extension JS from reading `~/.cache/huggingface` through the
/// app-data-scoped filesystem API while still validating that the resolved
/// snapshot is an AX Engine artifact.
#[tauri::command]
pub fn mlx_resolve_model_dir<R: Runtime>(
    app_handle: AppHandle<R>,
    model_id: String,
) -> Result<String, String> {
    if model_id.is_empty()
        || model_id.contains("..")
        || !model_id.contains('/')
        || !model_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
    {
        return Err(format!("invalid MLX model id '{model_id}'"));
    }

    let path = resolve_downloaded_or_cached_model_dir(&app_handle, &model_id).ok_or_else(|| {
        format!("could not resolve AX Studio download or HF cache snapshot for '{model_id}'")
    })?;

    Ok(path.to_string_lossy().to_string())
}

/// Resolve the local Hugging Face cache snapshot directory AX Studio should use
/// for a repo/revision download.
#[tauri::command]
pub fn mlx_hf_snapshot_dir(model_id: String, revision: String) -> Result<String, String> {
    let path = hf_cache::snapshot_dir(&model_id, &revision)?;
    Ok(path.to_string_lossy().to_string())
}

/// Best-effort cleanup for failed MLX imports. Cleanup is restricted to the
/// Hugging Face cache, so a failed remote download cannot delete arbitrary files.
#[tauri::command]
pub fn mlx_cleanup_import_artifacts(paths: Vec<String>) -> Result<(), String> {
    for raw_path in paths {
        if raw_path.trim().is_empty() {
            continue;
        }
        let path = hf_cache::normalize_existing_or_parent(Path::new(&raw_path));
        if !hf_cache::is_within_cache(&path) {
            log::warn!(
                "Skipping MLX import cleanup outside Hugging Face cache: {}",
                path.display()
            );
            continue;
        }
        if path.is_file() {
            let _ = std::fs::remove_file(&path);
        } else if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
    Ok(())
}

/// Check whether a Hugging Face cache snapshot has AX Engine native artifacts.
#[tauri::command]
pub fn mlx_has_model_manifest(model_dir: String) -> Result<bool, String> {
    let path = hf_cache::normalize_existing_or_parent(Path::new(&model_dir));
    if !hf_cache::is_within_cache(&path) {
        return Err(format!(
            "MLX model directory is outside Hugging Face cache: {}",
            path.display()
        ));
    }
    Ok(is_ax_native_model_dir(&path))
}

/// Generate or validate AX Engine's native manifest for a downloaded MLX
/// Hugging Face snapshot.
#[tauri::command]
pub async fn mlx_generate_model_manifest(model_dir: String) -> Result<(), String> {
    let path = PathBuf::from(&model_dir);
    if !path.is_dir() {
        return Err(format!("MLX model directory does not exist: {model_dir}"));
    }
    if !dir_contains_safetensors(&path) {
        return Err(format!(
            "MLX model directory does not contain safetensors: {model_dir}"
        ));
    }

    let manifest_path = path.join(AX_NATIVE_MODEL_MANIFEST_FILE);
    if manifest_path.is_file() {
        NativeModelArtifacts::from_dir(&path)
            .map_err(|error| format!("existing AX manifest is invalid: {error}"))?;
        return Ok(());
    }

    let path_for_task = path.clone();
    tokio::task::spawn_blocking(move || {
        let manifest = convert_hf_model_dir(&path_for_task)
            .map_err(|error| format!("failed to generate AX manifest: {error}"))?;
        write_manifest(&path_for_task, &manifest)
            .map_err(|error| format!("failed to write AX manifest: {error}"))?;
        NativeModelArtifacts::from_dir(&path_for_task)
            .map_err(|error| format!("generated AX manifest is invalid: {error}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("AX manifest generation task failed: {error}"))?
}

/// Look up `~/.cache/huggingface/hub/models--<author>--<name>/snapshots/<commit>/`
/// from a model id like `mlx-community/Qwen3.5-9B-MLX-4bit`. Returns the most
/// recent snapshot if multiple exist. Returns None if the cache layout doesn't
/// match (e.g. model not downloaded yet).
pub(crate) fn resolve_hf_cache_dir(model_id: &str) -> Option<PathBuf> {
    let repo_dir = hf_cache::repo_cache_dir(model_id).ok()?;
    let snapshots = repo_dir.join("snapshots");
    let entries = std::fs::read_dir(&snapshots).ok()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let mtime = entry.metadata().ok().and_then(|m| m.modified().ok())?;
        if best.as_ref().map(|(t, _)| mtime > *t).unwrap_or(true) {
            best = Some((mtime, path));
        }
    }
    best.map(|(_, p)| p)
}

fn resolve_downloaded_or_cached_model_dir<R: Runtime>(
    app_handle: &AppHandle<R>,
    model_id: &str,
) -> Option<PathBuf> {
    resolve_hf_cache_dir(model_id)
        .filter(|path| is_ax_native_model_dir(path))
        .or_else(|| resolve_app_data_model_dir(app_handle, model_id))
}

fn resolve_app_data_model_dir<R: Runtime>(
    app_handle: &AppHandle<R>,
    model_id: &str,
) -> Option<PathBuf> {
    if model_id.is_empty()
        || model_id.contains("..")
        || model_id
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return None;
    }

    let path = get_app_data_folder_path(app_handle.clone())
        .join("llamacpp")
        .join("models")
        .join(model_id);

    is_ax_native_model_dir(&path).then_some(path)
}

fn is_ax_native_model_dir(path: &Path) -> bool {
    path.is_dir() && path.join(AX_NATIVE_MODEL_MANIFEST_FILE).is_file()
}

fn dir_contains_safetensors(path: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(path) else {
        return false;
    };

    entries.flatten().any(|entry| {
        let path = entry.path();
        if path.is_dir() {
            return dir_contains_safetensors(&path);
        }
        path.extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("safetensors"))
    })
}

#[tauri::command]
pub async fn mlx_unload_model(state: State<'_, MlxState>, model_id: String) -> Result<(), String> {
    state.worker.unload(model_id).await
}

#[tauri::command]
pub async fn mlx_list_loaded(state: State<'_, MlxState>) -> Result<Vec<String>, String> {
    state.worker.list_loaded().await
}

// ── OpenAI-style chat completion shapes ──────────────────────────────────────
//
// Mirrors the subset of `POST /v1/chat/completions` the web app uses today, so
// the existing custom-chat-transport can call this Tauri command and parse the
// result without a separate code path. Streaming is added in Phase 4.

#[derive(Debug, Serialize)]
pub struct ChatCompletion {
    pub id: String,
    pub object: &'static str,
    pub created: u64,
    pub model: String,
    pub choices: Vec<ChatCompletionChoice>,
    pub usage: ChatCompletionUsage,
}

#[derive(Debug, Serialize)]
pub struct ChatCompletionChoice {
    pub index: u32,
    pub message: ChatCompletionAssistantMessage,
    pub finish_reason: String,
}

#[derive(Debug, Serialize)]
pub struct ChatCompletionAssistantMessage {
    pub role: &'static str,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct ChatCompletionUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// Streaming chat completion against a previously-loaded MLX model.
///
/// Emits `StreamEvent`s (Start → Delta* → Done) onto the supplied
/// `tauri::ipc::Channel`. The command itself resolves once the terminal Done
/// (or Error) event has been emitted, so callers can `await` the invoke to
/// detect "stream finished" without subscribing to a separate event.
#[tauri::command]
pub async fn mlx_chat_stream(
    state: State<'_, MlxState>,
    model_id: String,
    messages: Vec<ChatMessage>,
    params: Option<GenerateParams>,
    on_event: tauri::ipc::Channel<StreamEvent>,
) -> Result<(), String> {
    let params = params.unwrap_or_default();
    let sink = on_event.clone();
    state
        .worker
        .generate_stream(model_id, messages, params, move |evt| {
            // Best-effort emit; if the frontend dropped the channel, log and
            // keep going so the worker can still drain its terminal event and
            // unblock its reply.
            if let Err(e) = sink.send(evt) {
                log::debug!("[mlx-stream] frontend dropped channel: {e}");
            }
        })
        .await
}

/// In-process chat completion against a previously-loaded MLX model.
/// Returns an OpenAI-shape `chat.completion` object so callers don't need to
/// special-case this path versus the HTTP path.
#[tauri::command]
pub async fn mlx_chat_completion(
    state: State<'_, MlxState>,
    model_id: String,
    messages: Vec<ChatMessage>,
    params: Option<GenerateParams>,
) -> Result<ChatCompletion, String> {
    let params = params.unwrap_or_default();
    let result = state
        .worker
        .generate(model_id.clone(), messages, params)
        .await?;

    let created = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Ok(ChatCompletion {
        id: format!("mlx-{}", created),
        object: "chat.completion",
        created,
        model: model_id,
        choices: vec![ChatCompletionChoice {
            index: 0,
            message: ChatCompletionAssistantMessage {
                role: "assistant",
                content: result.output_text,
            },
            finish_reason: result.finish_reason,
        }],
        usage: ChatCompletionUsage {
            prompt_tokens: result.prompt_token_count,
            completion_tokens: result.output_token_count,
            total_tokens: result.prompt_token_count + result.output_token_count,
        },
    })
}
