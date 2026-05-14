//! Phase 1 + Phase 2 MLX Tauri commands.
//!
//! * `mlx_runtime_probe` — host + Metal toolchain status from the SDK
//! * `mlx_load_model` — load an MLX model into the in-process worker
//! * `mlx_unload_model` — drop a loaded model
//! * `mlx_list_loaded` — list currently-loaded model ids

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use ax_engine_sdk::{current_host_report, current_metal_toolchain_report};
use serde::Serialize;
use tauri::State;

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
/// resolves `model_id` against the HuggingFace cache
/// (`mlx-community/X-4bit` → `~/.cache/huggingface/hub/models--mlx-community--X-4bit/snapshots/<commit>/`)
/// so the chat frontend can load by HF model id without knowing FS paths.
/// Idempotent: a no-op when the model is already loaded.
#[tauri::command]
pub async fn mlx_load_model(
    state: State<'_, MlxState>,
    model_id: String,
    model_dir: Option<String>,
) -> Result<(), String> {
    let path = match model_dir {
        Some(p) => PathBuf::from(p),
        None => resolve_hf_cache_dir(&model_id)
            .ok_or_else(|| format!("could not resolve HF cache snapshot for '{model_id}'"))?,
    };
    state.worker.load(model_id, path).await
}

/// Look up `~/.cache/huggingface/hub/models--<author>--<name>/snapshots/<commit>/`
/// from a model id like `mlx-community/Qwen3.5-9B-MLX-4bit`. Returns the most
/// recent snapshot if multiple exist. Returns None if the cache layout doesn't
/// match (e.g. model not downloaded yet).
pub(crate) fn resolve_hf_cache_dir(model_id: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let repo_dirname = format!("models--{}", model_id.replace('/', "--"));
    let repo_dir = PathBuf::from(home)
        .join(".cache")
        .join("huggingface")
        .join("hub")
        .join(&repo_dirname);
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

#[tauri::command]
pub async fn mlx_unload_model(
    state: State<'_, MlxState>,
    model_id: String,
) -> Result<(), String> {
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
