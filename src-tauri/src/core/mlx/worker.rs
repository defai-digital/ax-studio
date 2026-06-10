//! Dedicated MLX worker thread.
//!
//! `ax-engine-mlx`'s `MlxRunner` (inside `EngineSession`) holds Metal/MLX FFI
//! handles via `mlx-sys`. These types are not `Send`, so we cannot put them
//! behind a tokio mutex or call them from arbitrary tokio tasks. Instead we
//! spawn a single OS thread that owns the session registry and processes
//! commands from an mpsc channel. Tauri commands are thin async wrappers that
//! send a request through the channel and await a oneshot reply.

#![cfg(target_os = "macos")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};
use std::thread::{self, JoinHandle};

use ax_engine_sdk::{
    current_host_report, EngineSession, EngineSessionConfig, GenerateRequest, GenerateSampling,
    GenerateStreamEvent as SdkGenerateStreamEvent, NativeModelArtifactsSource,
};
use serde::{Deserialize, Serialize};
use tokenizers::Tokenizer;
use tokio::sync::oneshot;

/// OpenAI-style chat message.
#[derive(Clone, Debug, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Per-call sampling/length controls. Optional — sensible defaults applied
/// when caller omits.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct GenerateParams {
    pub max_output_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub top_k: Option<u32>,
    pub repetition_penalty: Option<f32>,
    pub seed: Option<u64>,
    pub stop: Option<Vec<String>>,
}

/// Result returned from a single non-streaming chat completion.
#[derive(Clone, Debug)]
pub struct ChatCompletionResult {
    pub output_text: String,
    pub prompt_token_count: u32,
    pub output_token_count: u32,
    pub finish_reason: String,
}

/// Streaming events emitted while a chat completion is in flight.
/// Mirrors the SSE event shapes that the chat transport already handles for
/// HTTP backends, so the frontend can treat both paths uniformly.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    /// First event — emitted once the model has accepted the request.
    Start {
        model_id: String,
        prompt_token_count: u32,
    },
    /// One or more decoded output tokens since the previous Delta.
    Delta { text: String },
    /// Final event with usage stats and stop reason. `elapsed_ms` is the
    /// wall-clock time spent inside native streaming, useful for diagnostics
    /// and speed display fallbacks.
    Done {
        prompt_token_count: u32,
        output_token_count: u32,
        finish_reason: String,
        elapsed_ms: u64,
    },
    /// Terminal error event. The Tauri command's Result also surfaces the
    /// error, but emitting it on the channel keeps the chat UI's incremental
    /// state machine simple.
    Error { message: String },
}

/// Commands the worker thread can execute.
pub enum MlxCommand {
    Load {
        model_id: String,
        model_dir: PathBuf,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Unload {
        model_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    ListLoaded {
        reply: oneshot::Sender<Vec<String>>,
    },
    Generate {
        model_id: String,
        messages: Vec<ChatMessage>,
        params: GenerateParams,
        reply: oneshot::Sender<Result<ChatCompletionResult, String>>,
    },
    /// Stream tokens for a chat request, emitting `StreamEvent`s as they
    /// arrive. The `reply` channel resolves with the terminal status once
    /// the worker has emitted the `Done` (or `Error`) event.
    GenerateStream {
        model_id: String,
        messages: Vec<ChatMessage>,
        params: GenerateParams,
        on_event: Box<dyn Fn(StreamEvent) + Send>,
        reply: oneshot::Sender<Result<(), String>>,
    },
}

/// Handle to the MLX worker thread. Clonable via the inner sender — multiple
/// Tauri command handlers can dispatch to the same worker.
#[derive(Clone)]
pub struct MlxWorker {
    cmd_tx: Sender<MlxCommand>,
}

impl MlxWorker {
    pub fn spawn() -> (Self, JoinHandle<()>) {
        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel();
        let join = thread::Builder::new()
            .name("ax-mlx-worker".to_string())
            .spawn(move || run_worker(cmd_rx))
            .expect("failed to spawn mlx worker thread");
        (Self { cmd_tx }, join)
    }

    fn dispatch(&self, cmd: MlxCommand) -> Result<(), String> {
        self.cmd_tx
            .send(cmd)
            .map_err(|_| "mlx worker thread is no longer running".to_string())
    }

    pub async fn load(&self, model_id: String, model_dir: PathBuf) -> Result<(), String> {
        let (reply, rx) = oneshot::channel();
        self.dispatch(MlxCommand::Load {
            model_id,
            model_dir,
            reply,
        })?;
        rx.await
            .map_err(|_| "mlx worker dropped Load reply".to_string())?
    }

    pub async fn unload(&self, model_id: String) -> Result<(), String> {
        let (reply, rx) = oneshot::channel();
        self.dispatch(MlxCommand::Unload { model_id, reply })?;
        rx.await
            .map_err(|_| "mlx worker dropped Unload reply".to_string())?
    }

    pub async fn list_loaded(&self) -> Result<Vec<String>, String> {
        let (reply, rx) = oneshot::channel();
        self.dispatch(MlxCommand::ListLoaded { reply })?;
        rx.await
            .map_err(|_| "mlx worker dropped ListLoaded reply".to_string())
    }

    pub async fn generate(
        &self,
        model_id: String,
        messages: Vec<ChatMessage>,
        params: GenerateParams,
    ) -> Result<ChatCompletionResult, String> {
        let (reply, rx) = oneshot::channel();
        self.dispatch(MlxCommand::Generate {
            model_id,
            messages,
            params,
            reply,
        })?;
        rx.await
            .map_err(|_| "mlx worker dropped Generate reply".to_string())?
    }

    pub async fn generate_stream<F>(
        &self,
        model_id: String,
        messages: Vec<ChatMessage>,
        params: GenerateParams,
        on_event: F,
    ) -> Result<(), String>
    where
        F: Fn(StreamEvent) + Send + 'static,
    {
        let (reply, rx) = oneshot::channel();
        self.dispatch(MlxCommand::GenerateStream {
            model_id,
            messages,
            params,
            on_event: Box::new(on_event),
            reply,
        })?;
        rx.await
            .map_err(|_| "mlx worker dropped GenerateStream reply".to_string())?
    }
}

/// Per-model resources owned by the worker thread.
///
/// We keep one prebuilt, unused `EngineSession` ready for the next request.
/// Once a session has generated output we drop it instead of reusing it,
/// because reused native MLX sessions previously triggered slice-rank crashes:
///   "MLX error: [slice] Invalid number of indices or strides for array
///    with dimension 2."
/// This gives us the speed benefit of moving `EngineSession::new` out of the
/// user-visible first-token path without depending on post-generation session
/// reuse.
struct LoadedModel {
    model_dir: PathBuf,
    tokenizer: Tokenizer,
    warm_session: Option<EngineSession>,
}

/// Build a fresh `EngineSession` pointed at the model dir. The worker keeps at
/// most one unused session warm per loaded model and consumes it for the next
/// generate / generate_stream request.
///
/// **n-gram acceleration: OFF by default.** ax-engine's library default is
/// ON, but the n-gram code path triggers the mlx-c 0.6.0 4-bit slice abort
/// on every 4-bit model on disk — confirmed against `Qwen3-4B-4bit` and
/// `Qwen3.5-9B-MLX-4bit`. We default to the direct (no-speculation) path so
/// `make dev` just works.
///
/// To deliberately enable n-gram for A/B testing (e.g. to demonstrate the
/// crash, or once upstream fixes it), set env var `AX_MLX_NGRAM=1` when
/// launching the app.
fn build_session(model_dir: &PathBuf) -> Result<EngineSession, String> {
    let enable_ngram = std::env::var("AX_MLX_NGRAM")
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "True"))
        .unwrap_or(false);
    let disable_ngram = !enable_ngram;
    let mut config = EngineSessionConfig::default();
    config.mlx_model_artifacts_dir = Some(model_dir.clone());
    config.mlx_model_artifacts_source = Some(NativeModelArtifactsSource::ExplicitConfig);
    config.mlx_disable_ngram_acceleration = disable_ngram;
    log::info!(
        "[mlx-worker] build_session model_dir={} ngram={}",
        model_dir.display(),
        if enable_ngram {
            "ON (set via AX_MLX_NGRAM=1 — expect crash on 4-bit)"
        } else {
            "OFF (default; direct path)"
        },
    );
    EngineSession::new(config).map_err(|e| format!("EngineSession::new failed: {e:?}"))
}

fn take_warm_session(entry: &mut LoadedModel, model_id: &str) -> Result<EngineSession, String> {
    if let Some(session) = entry.warm_session.take() {
        log::info!("[mlx-worker] using prebuilt session for {model_id}");
        Ok(session)
    } else {
        log::info!("[mlx-worker] no prebuilt session for {model_id}; building on demand");
        build_session(&entry.model_dir)
    }
}

fn prepare_next_session(entry: &mut LoadedModel, model_id: &str) {
    let started = std::time::Instant::now();
    match build_session(&entry.model_dir) {
        Ok(session) => {
            let elapsed_ms = started.elapsed().as_millis();
            entry.warm_session = Some(session);
            log::info!("[mlx-worker] prepared next session for {model_id} in {elapsed_ms}ms");
        }
        Err(e) => {
            entry.warm_session = None;
            log::warn!("[mlx-worker] failed to prepare next session for {model_id}: {e}");
        }
    }
}

fn run_worker(rx: Receiver<MlxCommand>) {
    // Sessions live here, on the worker thread. EngineSession + MlxRunner
    // are !Send, which is exactly why we need this single-thread design.
    let mut models: HashMap<String, LoadedModel> = HashMap::new();

    let host = current_host_report();
    if !host.supported_mlx_runtime {
        log::warn!(
            "[mlx-worker] host does not support MLX runtime — load commands will fail. \
             os={} arch={} soc={:?} detection_error={:?}",
            host.os,
            host.arch,
            host.detected_soc,
            host.detection_error
        );
    } else {
        log::info!(
            "[mlx-worker] started on {} ({}), SoC={:?}",
            host.os,
            host.arch,
            host.detected_soc
        );
    }

    while let Ok(cmd) = rx.recv() {
        match cmd {
            MlxCommand::Load {
                model_id,
                model_dir,
                reply,
            } => {
                let result = handle_load(&mut models, &model_id, &model_dir);
                let _ = reply.send(result);
            }
            MlxCommand::Unload { model_id, reply } => {
                let removed = models.remove(&model_id).is_some();
                let result = if removed {
                    log::info!("[mlx-worker] unloaded model {model_id}");
                    Ok(())
                } else {
                    Err(format!("model not loaded: {model_id}"))
                };
                let _ = reply.send(result);
            }
            MlxCommand::ListLoaded { reply } => {
                let mut ids: Vec<String> = models.keys().cloned().collect();
                ids.sort();
                let _ = reply.send(ids);
            }
            MlxCommand::Generate {
                model_id,
                messages,
                params,
                reply,
            } => {
                let result = handle_generate(&mut models, &model_id, messages, params);
                let _ = reply.send(result);
            }
            MlxCommand::GenerateStream {
                model_id,
                messages,
                params,
                on_event,
                reply,
            } => {
                let result =
                    handle_generate_stream(&mut models, &model_id, messages, params, &on_event);
                if let Err(ref e) = result {
                    on_event(StreamEvent::Error { message: e.clone() });
                }
                let _ = reply.send(result);
            }
        }
    }

    log::info!("[mlx-worker] command channel closed; thread exiting");
}

fn handle_load(
    models: &mut HashMap<String, LoadedModel>,
    model_id: &str,
    model_dir: &PathBuf,
) -> Result<(), String> {
    if models.contains_key(model_id) {
        log::debug!("[mlx-worker] load: {model_id} already resident, no-op");
        return Ok(());
    }

    if !model_dir.is_dir() {
        return Err(format!(
            "model directory does not exist or is not a directory: {}",
            model_dir.display()
        ));
    }

    let tokenizer_path = model_dir.join("tokenizer.json");
    if !tokenizer_path.is_file() {
        return Err(format!(
            "tokenizer.json missing from model directory: {}",
            tokenizer_path.display()
        ));
    }
    let tokenizer = Tokenizer::from_file(&tokenizer_path)
        .map_err(|e| format!("Tokenizer::from_file failed for {model_id}: {e}"))?;

    // Build the first warm session up-front, so the user gets a clear error
    // here instead of on first generate and the first request can skip
    // EngineSession::new on the visible path.
    log::info!(
        "[mlx-worker] loading model {model_id} from {}",
        model_dir.display()
    );
    let warm_session = build_session(model_dir)
        .map_err(|e| format!("EngineSession::new probe failed for {model_id}: {e}"))?;

    models.insert(
        model_id.to_string(),
        LoadedModel {
            model_dir: model_dir.clone(),
            tokenizer,
            warm_session: Some(warm_session),
        },
    );
    log::info!("[mlx-worker] loaded model {model_id}");
    Ok(())
}

fn handle_generate(
    models: &mut HashMap<String, LoadedModel>,
    model_id: &str,
    messages: Vec<ChatMessage>,
    params: GenerateParams,
) -> Result<ChatCompletionResult, String> {
    let entry = models
        .get_mut(model_id)
        .ok_or_else(|| format!("model not loaded: {model_id}"))?;

    // Build the prompt using ChatML (Qwen-family chat template). This is the
    // format Qwen3.5 / Qwen3.6 / Qwen3-Coder / similar Qwen-architecture
    // models expect. Other model families (GLM, Gemma) use different
    // templates — extend this helper if/when those are loaded.
    let prompt = format_prompt(&messages, model_id);
    let prompt_tokens = entry
        .tokenizer
        .encode(prompt.as_str(), false)
        .map_err(|e| format!("tokenizer.encode failed for {model_id}: {e}"))?
        .get_ids()
        .to_vec();
    let _ = prompt; // prompt string was only used for tokenization

    let sampling = GenerateSampling {
        temperature: params.temperature.unwrap_or(0.7),
        top_p: params.top_p.unwrap_or(0.95),
        top_k: params.top_k.unwrap_or(0),
        min_p: None,
        repetition_penalty: params.repetition_penalty.unwrap_or(1.0),
        repetition_context_size: None,
        seed: params.seed.unwrap_or(0),
        deterministic: None,
        ignore_eos: false,
    };

    let request = GenerateRequest {
        model_id: model_id.to_string(),
        input_tokens: prompt_tokens.clone(),
        input_text: None,
        max_output_tokens: params.max_output_tokens.unwrap_or(2048),
        sampling,
        stop_sequences: params.stop.unwrap_or_default(),
        multimodal_inputs: Default::default(),
        metadata: None,
    };

    log::info!(
        "[mlx-worker] generate {model_id}: {} prompt tokens, max_out={}",
        prompt_tokens.len(),
        request.max_output_tokens
    );

    // Consume one unused warm session per call. We intentionally do not reuse
    // this session after generation.
    let mut session = take_warm_session(entry, model_id)?;
    let response = session
        .generate(request)
        .map_err(|e| format!("session.generate failed for {model_id}: {e:?}"))?;
    drop(session);

    let output_text = entry
        .tokenizer
        .decode(&response.output_tokens, true)
        .map_err(|e| format!("tokenizer.decode failed for {model_id}: {e}"))?;

    let prompt_token_count = response
        .prompt_token_count
        .unwrap_or_else(|| response.prompt_tokens.len() as u32);
    let output_token_count = response
        .output_token_count
        .unwrap_or_else(|| response.output_tokens.len() as u32);

    // `GenerateResponse.status` carries finish_reason; map it to OpenAI-style.
    let finish_reason = response_finish_reason(&response);

    prepare_next_session(entry, model_id);

    Ok(ChatCompletionResult {
        output_text,
        prompt_token_count,
        output_token_count,
        finish_reason,
    })
}

fn handle_generate_stream(
    models: &mut HashMap<String, LoadedModel>,
    model_id: &str,
    messages: Vec<ChatMessage>,
    params: GenerateParams,
    on_event: &(dyn Fn(StreamEvent) + Send),
) -> Result<(), String> {
    let entry = models
        .get_mut(model_id)
        .ok_or_else(|| format!("model not loaded: {model_id}"))?;

    let prompt = format_prompt(&messages, model_id);
    let prompt_tokens = entry
        .tokenizer
        .encode(prompt.as_str(), false)
        .map_err(|e| format!("tokenizer.encode failed for {model_id}: {e}"))?
        .get_ids()
        .to_vec();
    let prompt_token_count = prompt_tokens.len() as u32;
    let _ = prompt;

    let sampling = GenerateSampling {
        temperature: params.temperature.unwrap_or(0.7),
        top_p: params.top_p.unwrap_or(0.95),
        top_k: params.top_k.unwrap_or(0),
        min_p: None,
        repetition_penalty: params.repetition_penalty.unwrap_or(1.0),
        repetition_context_size: None,
        seed: params.seed.unwrap_or(0),
        deterministic: None,
        ignore_eos: false,
    };
    let max_output_tokens = params.max_output_tokens.unwrap_or(2048);
    let stop_sequences = params.stop.unwrap_or_default();

    let request = GenerateRequest {
        model_id: model_id.to_string(),
        input_tokens: prompt_tokens,
        input_text: None,
        max_output_tokens,
        sampling,
        stop_sequences,
        multimodal_inputs: Default::default(),
        metadata: None,
    };

    log::info!(
        "[mlx-worker] stream {model_id}: {prompt_token_count} prompt tokens, \
         max_out={max_output_tokens}"
    );

    let mut session = take_warm_session(entry, model_id)?;
    let started = std::time::Instant::now();
    let mut stream = session
        .stream_generate(request)
        .map_err(|e| format!("session.stream_generate failed for {model_id}: {e:?}"))?;
    let mut saw_start = false;
    let mut prompt_token_count = prompt_token_count;
    let mut output_token_count = 0_u32;
    let mut finish_reason = "stop".to_string();

    while let Some(event_result) = stream.next() {
        let event = event_result
            .map_err(|e| format!("session.next_stream_event failed for {model_id}: {e:?}"))?;

        match event {
            SdkGenerateStreamEvent::Request(request_event) => {
                prompt_token_count = request_event
                    .request
                    .prompt_len
                    .max(request_event.request.prompt_tokens.len() as u32);
                on_event(StreamEvent::Start {
                    model_id: model_id.to_string(),
                    prompt_token_count,
                });
                saw_start = true;
            }
            SdkGenerateStreamEvent::Step(step_event) => {
                if !saw_start {
                    on_event(StreamEvent::Start {
                        model_id: model_id.to_string(),
                        prompt_token_count,
                    });
                    saw_start = true;
                }
                if !step_event.delta_tokens.is_empty() {
                    let text = entry
                        .tokenizer
                        .decode(&step_event.delta_tokens, true)
                        .map_err(|e| format!("tokenizer.decode failed for {model_id}: {e}"))?;
                    if !text.is_empty() {
                        on_event(StreamEvent::Delta { text });
                    }
                } else if let Some(text) = step_event.delta_text {
                    if !text.is_empty() {
                        on_event(StreamEvent::Delta { text });
                    }
                }
            }
            SdkGenerateStreamEvent::Response(response_event) => {
                let response = response_event.response;
                prompt_token_count = response
                    .prompt_token_count
                    .unwrap_or_else(|| response.prompt_tokens.len() as u32);
                output_token_count = response
                    .output_token_count
                    .unwrap_or_else(|| response.output_tokens.len() as u32);
                finish_reason = response_finish_reason(&response);
            }
        }
    }

    let elapsed_ms = started.elapsed().as_millis() as u64;
    log::info!(
        "[mlx-worker] stream done: {output_token_count} tokens in {elapsed_ms}ms = {:.1} t/s",
        if elapsed_ms == 0 {
            0.0
        } else {
            output_token_count as f64 * 1000.0 / elapsed_ms as f64
        },
    );

    on_event(StreamEvent::Done {
        prompt_token_count,
        output_token_count,
        finish_reason,
        elapsed_ms,
    });

    drop(stream);
    drop(session);
    prepare_next_session(entry, model_id);

    Ok(())
}

/// Dispatch prompt formatting to the right template based on the model
/// family. Each family has its own turn-marker conventions and the model
/// will produce garbage if fed the wrong format.
fn format_prompt(messages: &[ChatMessage], model_id: &str) -> String {
    if is_gemma_family(model_id) {
        format_gemma(messages)
    } else {
        format_chatml(messages, model_id)
    }
}

fn is_gemma_family(model_id: &str) -> bool {
    let id_lower = model_id.to_lowercase();
    id_lower.contains("gemma-4") || id_lower.contains("gemma-3") || id_lower.contains("gemma4")
}

/// Gemma turn-template: `<start_of_turn>{role}\n{content}<end_of_turn>\n`.
/// Gemma's chat template doesn't have a separate `system` role — system
/// messages are usually prepended to the first user turn. We do the same.
fn format_gemma(messages: &[ChatMessage]) -> String {
    let mut out = String::new();
    let mut pending_system: Option<String> = None;
    for m in messages {
        match m.role.as_str() {
            "system" => {
                // Gemma has no system role; carry into the next user turn.
                pending_system = Some(m.content.clone());
            }
            "user" => {
                out.push_str("<start_of_turn>user\n");
                if let Some(sys) = pending_system.take() {
                    out.push_str(&sys);
                    out.push_str("\n\n");
                }
                out.push_str(&m.content);
                out.push_str("<end_of_turn>\n");
            }
            "assistant" | "tool" => {
                out.push_str("<start_of_turn>model\n");
                out.push_str(&m.content);
                out.push_str("<end_of_turn>\n");
            }
            other => {
                log::warn!("[mlx-worker] gemma: unknown role '{other}', treating as user");
                out.push_str("<start_of_turn>user\n");
                out.push_str(&m.content);
                out.push_str("<end_of_turn>\n");
            }
        }
    }
    out.push_str("<start_of_turn>model\n");
    out
}

/// Format chat messages into a single prompt string using the Qwen ChatML
/// template. For Qwen3 dense models we seed the assistant turn with an
/// empty `<think></think>` block — that tells the model "reasoning already
/// complete (empty), produce the answer directly." Without this Qwen3 emits
/// a few hundred tokens of `<thinking>...</thinking>` before the visible
/// answer (which native mode can't strip, since unlike the mlx_lm.server
/// SSE path there's no `delta.reasoning` channel separation).
///
/// We *do not* apply the prefix for MoE Qwens (`A3B` in the model id) or
/// GLM models — empirically those don't have thinking mode in this template
/// dialect, and seeding the prefix appears to confuse their decode (output
/// truncates to ~3–9 tokens). For non-thinking families we use the plain
/// `<|im_start|>assistant\n` opener.
fn format_chatml(messages: &[ChatMessage], model_id: &str) -> String {
    let mut out = String::new();
    for m in messages {
        let role = match m.role.as_str() {
            "system" | "user" | "assistant" | "tool" => m.role.as_str(),
            other => {
                log::warn!("[mlx-worker] unknown chat role '{other}', treating as 'user'");
                "user"
            }
        };
        out.push_str("<|im_start|>");
        out.push_str(role);
        out.push('\n');
        out.push_str(&m.content);
        out.push_str("<|im_end|>\n");
    }
    if uses_qwen3_thinking_mode(model_id) {
        out.push_str("<|im_start|>assistant\n<think>\n\n</think>\n\n");
    } else {
        out.push_str("<|im_start|>assistant\n");
    }
    out
}

/// True for Qwen3 dense models that emit a `<thinking>` chain by default
/// (`Qwen3-4B`, `Qwen3-8B`, `Qwen3.5-9B-MLX`, etc.). False for MoE Qwens
/// (anything with `A3B` in the id) and for non-Qwen families like GLM.
fn uses_qwen3_thinking_mode(model_id: &str) -> bool {
    if model_id.contains("A3B") || model_id.contains("GLM") {
        return false;
    }
    model_id.contains("Qwen3")
}

fn response_finish_reason(response: &ax_engine_sdk::GenerateResponse) -> String {
    use ax_engine_sdk::{GenerateFinishReason, GenerateStatus};
    if let Some(reason) = response.finish_reason {
        return match reason {
            GenerateFinishReason::Stop => "stop".to_string(),
            GenerateFinishReason::MaxOutputTokens => "length".to_string(),
            GenerateFinishReason::ContentFilter => "content_filter".to_string(),
            GenerateFinishReason::Cancelled => "cancelled".to_string(),
            GenerateFinishReason::Error => "error".to_string(),
        };
    }
    // Fall back to status if no explicit finish_reason was set.
    match response.status {
        GenerateStatus::Finished => "stop".to_string(),
        GenerateStatus::Cancelled => "cancelled".to_string(),
        GenerateStatus::Failed => "error".to_string(),
        GenerateStatus::Pending => "incomplete".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_msg(content: &str) -> ChatMessage {
        ChatMessage {
            role: "user".to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn qwen36_27b_uses_qwen_direct_answer_prefix() {
        let prompt = format_prompt(&[user_msg("Hello")], "mlx-community/Qwen3.6-27B-4bit");

        assert!(prompt.contains("<|im_start|>user\nHello<|im_end|>\n"));
        assert!(prompt.ends_with("<|im_start|>assistant\n<think>\n\n</think>\n\n"));
    }

    #[test]
    fn gemma4_12b_it_uses_gemma_template() {
        let prompt = format_prompt(&[user_msg("Hello")], "mlx-community/gemma-4-12B-it-4bit");

        assert!(prompt.contains("<start_of_turn>user\nHello<end_of_turn>\n"));
        assert!(prompt.ends_with("<start_of_turn>model\n"));
        assert!(!prompt.contains("<|im_start|>"));
    }
}
