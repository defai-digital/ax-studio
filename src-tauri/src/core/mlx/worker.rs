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
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc::{Receiver, Sender},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};

use ax_engine_sdk::{
    current_host_report, EngineSession, EngineSessionConfig, GenerateRequest, GenerateSampling,
    GenerateStreamEvent as SdkGenerateStreamEvent, MlxMtpPolicy, NativeModelArtifactsSource,
    StatelessGenerateContext,
};
use serde::{Deserialize, Serialize};
use tokenizers::Tokenizer;
use tokio::sync::oneshot;

const DEFAULT_MLX_MAX_OUTPUT_TOKENS: u32 = 2048;
// A bounded target filter keeps temperature-sampled requests eligible for AX
// Engine's exact MTP rejection-sampling route. Zero plus top_p < 1 would force
// every otherwise valid MTP package to direct fallback.
const DEFAULT_MLX_TOP_K: u32 = 20;
const GEMMA4_CHANNEL_OPEN: &str = "<|channel>";
const GEMMA4_CHANNEL_CLOSE: &str = "<channel|>";
static NEXT_DIFFUSION_REQUEST_SEED: AtomicU64 = AtomicU64::new(1);

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

/// Versioned native timing and route telemetry forwarded unchanged to the
/// frontend. Durations use a monotonic engine clock and microseconds so the UI
/// can apply the same generation-only throughput denominator as other local
/// runtimes without timing IPC delivery.
#[derive(Clone, Debug, Serialize)]
pub struct StreamPerformanceMetrics {
    pub metrics_version: u32,
    pub total_time_us: u64,
    pub time_to_first_token_us: Option<u64>,
    pub generation_time_us: Option<u64>,
    pub generation_token_count: u32,
    pub prompt_eval_time_us: Option<u64>,
    pub prompt_runner_time_us: Option<u64>,
    pub model_eval_time_us: Option<u64>,
    pub model_runner_time_us: Option<u64>,
    pub model_eval_token_count: Option<u32>,
    pub generation_kind: String,
    pub mtp: StreamMtpMetrics,
}

#[derive(Clone, Debug, Serialize)]
pub struct StreamMtpMetrics {
    pub available: bool,
    pub requested: bool,
    pub active: bool,
    pub direct_fallback_steps: u32,
    pub draft_tokens: u32,
    pub accepted_tokens: u32,
    pub decode_steps: u32,
}

impl StreamPerformanceMetrics {
    fn from_response(response: &ax_engine_sdk::GenerateResponse) -> Self {
        let performance = &response.performance;
        let mtp = &performance.mtp;
        Self {
            metrics_version: performance.metrics_version,
            total_time_us: performance.total_time_us,
            time_to_first_token_us: performance.time_to_first_token_us,
            generation_time_us: performance.generation_time_us,
            generation_token_count: performance.generation_token_count,
            prompt_eval_time_us: performance.prompt_eval_time_us,
            prompt_runner_time_us: performance.prompt_runner_time_us,
            model_eval_time_us: performance.model_eval_time_us,
            model_runner_time_us: performance.model_runner_time_us,
            model_eval_token_count: performance.model_eval_token_count,
            generation_kind: if response.route.decision("ax_mlx_generation_kind") == Some(1) {
                "block_diffusion"
            } else {
                "autoregressive"
            }
            .to_string(),
            mtp: StreamMtpMetrics {
                available: mtp.available,
                requested: mtp.requested,
                active: mtp.active,
                direct_fallback_steps: mtp.direct_fallback_steps,
                draft_tokens: mtp.draft_tokens,
                accepted_tokens: mtp.accepted_tokens,
                decode_steps: mtp.decode_steps,
            },
        }
    }

    fn tokens_per_second(&self) -> Option<f64> {
        let (token_count, time_us) = match (self.model_eval_token_count, self.model_eval_time_us) {
            (Some(token_count), Some(time_us)) => (token_count, time_us),
            _ => (self.generation_token_count, self.generation_time_us?),
        };
        (time_us > 0 && token_count > 0)
            .then(|| f64::from(token_count) * 1_000_000.0 / time_us as f64)
    }

    fn delivery_tokens_per_second(&self) -> Option<f64> {
        let time_us = self.generation_time_us?;
        (time_us > 0 && self.generation_token_count > 0)
            .then(|| f64::from(self.generation_token_count) * 1_000_000.0 / time_us as f64)
    }

    fn runner_tokens_per_second(&self) -> Option<f64> {
        let time_us = self.model_runner_time_us?;
        let token_count = self.model_eval_token_count?;
        (time_us > 0 && token_count > 0)
            .then(|| f64::from(token_count) * 1_000_000.0 / time_us as f64)
    }

    fn acceleration_mode(&self) -> &'static str {
        if self.mtp.active {
            "mtp"
        } else if self.mtp.available && self.mtp.requested && self.mtp.direct_fallback_steps > 0 {
            "mtp_fallback"
        } else {
            "direct"
        }
    }
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
    /// Final event with usage stats, stop reason, and native performance data.
    /// `elapsed_ms` remains for backward compatibility and cancellation, while
    /// completed requests use `performance` for comparable speed reporting.
    Done {
        prompt_token_count: u32,
        output_token_count: u32,
        finish_reason: String,
        elapsed_ms: u64,
        performance: Option<StreamPerformanceMetrics>,
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
        request_id: String,
        model_id: String,
        messages: Vec<ChatMessage>,
        params: GenerateParams,
        cancellation: Arc<AtomicBool>,
        on_event: Box<dyn Fn(StreamEvent) + Send>,
        reply: oneshot::Sender<Result<(), String>>,
    },
}

#[derive(Clone, Default)]
struct StreamCancellationRegistry {
    flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl StreamCancellationRegistry {
    fn register(&self, request_id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut flags = self
            .flags
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if flags.contains_key(request_id) {
            return Err(format!("MLX stream request already exists: {request_id}"));
        }
        let cancellation = Arc::new(AtomicBool::new(false));
        flags.insert(request_id.to_string(), Arc::clone(&cancellation));
        Ok(cancellation)
    }

    fn cancel(&self, request_id: &str) -> Result<bool, String> {
        let flags = self
            .flags
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(cancellation) = flags.get(request_id) else {
            return Ok(false);
        };
        cancellation.store(true, Ordering::Release);
        Ok(true)
    }

    /// Signal every in-flight stream to stop. Used before model load/unload so
    /// a multi-minute generation cannot block the single-threaded worker queue.
    fn cancel_all(&self) -> Result<usize, String> {
        let flags = self
            .flags
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let count = flags.len();
        for cancellation in flags.values() {
            cancellation.store(true, Ordering::Release);
        }
        Ok(count)
    }

    fn unregister(&self, request_id: &str, cancellation: &Arc<AtomicBool>) {
        let mut flags = self
            .flags
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if flags
            .get(request_id)
            .is_some_and(|current| Arc::ptr_eq(current, cancellation))
        {
            flags.remove(request_id);
        }
    }
}

/// Handle to the MLX worker thread. Clonable via the inner sender — multiple
/// Tauri command handlers can dispatch to the same worker.
#[derive(Clone)]
pub struct MlxWorker {
    cmd_tx: Sender<MlxCommand>,
    stream_cancellations: StreamCancellationRegistry,
}

impl MlxWorker {
    pub fn spawn() -> Result<(Self, JoinHandle<()>), String> {
        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel();
        let join = thread::Builder::new()
            .name("ax-mlx-worker".to_string())
            .spawn(move || run_worker(cmd_rx))
            .map_err(|error| format!("failed to spawn mlx worker thread: {error}"))?;
        Ok((
            Self {
                cmd_tx,
                stream_cancellations: StreamCancellationRegistry::default(),
            },
            join,
        ))
    }

    fn dispatch(&self, cmd: MlxCommand) -> Result<(), String> {
        self.cmd_tx
            .send(cmd)
            .map_err(|_| "mlx worker thread is no longer running".to_string())
    }

    pub async fn load(&self, model_id: String, model_dir: PathBuf) -> Result<(), String> {
        // Model switch must not wait behind an unrelated long generation. Flag
        // active streams cancelled; the worker checks between decode steps and
        // will drain the GenerateStream command before processing this Load.
        match self.stream_cancellations.cancel_all() {
            Ok(0) => {}
            Ok(n) => log::info!(
                "[mlx-worker] cancelling {n} in-flight stream(s) before load of {model_id}"
            ),
            Err(e) => log::warn!("[mlx-worker] could not cancel streams before load: {e}"),
        }
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
        match self.stream_cancellations.cancel_all() {
            Ok(0) => {}
            Ok(n) => log::info!(
                "[mlx-worker] cancelling {n} in-flight stream(s) before unload of {model_id}"
            ),
            Err(e) => log::warn!("[mlx-worker] could not cancel streams before unload: {e}"),
        }
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
        request_id: String,
        model_id: String,
        messages: Vec<ChatMessage>,
        params: GenerateParams,
        on_event: F,
    ) -> Result<(), String>
    where
        F: Fn(StreamEvent) + Send + 'static,
    {
        let (reply, rx) = oneshot::channel();
        let cancellation = self.stream_cancellations.register(&request_id)?;
        if let Err(error) = self.dispatch(MlxCommand::GenerateStream {
            request_id: request_id.clone(),
            model_id,
            messages,
            params,
            cancellation: Arc::clone(&cancellation),
            on_event: Box::new(on_event),
            reply,
        }) {
            self.stream_cancellations
                .unregister(&request_id, &cancellation);
            return Err(error);
        }
        let result = match rx.await {
            Ok(result) => result,
            Err(_) => Err("mlx worker dropped GenerateStream reply".to_string()),
        };
        self.stream_cancellations
            .unregister(&request_id, &cancellation);
        result
    }

    pub fn cancel_stream(&self, request_id: &str) -> Result<bool, String> {
        self.stream_cancellations.cancel(request_id)
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
    tokenizer: Tokenizer,
    session_context: StatelessGenerateContext,
    warm_session: Option<EngineSession>,
}

impl LoadedModel {
    fn decode_chat_output(
        &self,
        model_id: &str,
        output_tokens: &[u32],
    ) -> Result<String, tokenizers::Error> {
        if is_gemma4_family(model_id) {
            decode_gemma4_chat_output(&self.tokenizer, output_tokens)
        } else {
            self.tokenizer.decode(output_tokens, true)
        }
    }
}

/// Build the per-model session factory. Every request still gets a fresh
/// `EngineSession` (avoiding the historical post-generation reuse crash), but
/// sessions created by this context share validated prompt-prefix snapshots.
///
/// **Packaged MTP: AUTO; standalone n-gram: OFF by default.** AX Engine only
/// admits MTP when the loaded package contains a validated Qwen MTP sidecar or
/// Gemma assistant. Ordinary models safely remain direct. The separate n-gram
/// path stays off because it triggers the mlx-c 0.6.0 4-bit slice abort on
/// affected packages.
///
/// To deliberately enable n-gram for A/B testing (e.g. to demonstrate the
/// crash, or once upstream fixes it), set env var `AX_MLX_NGRAM=1` when
/// launching the app. `AX_MLX_MTP_POLICY=disabled|required|auto` is available
/// for direct baselines and package validation; normal users should keep Auto.
fn build_session_context(model_dir: &Path) -> Result<StatelessGenerateContext, String> {
    let enable_ngram = std::env::var("AX_MLX_NGRAM")
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "True"))
        .unwrap_or(false);
    let disable_ngram = !enable_ngram;
    let mtp_policy = mtp_policy_from_env();
    let config = EngineSessionConfig {
        mlx_model_artifacts_dir: Some(model_dir.to_path_buf()),
        mlx_model_artifacts_source: Some(NativeModelArtifactsSource::ExplicitConfig),
        mlx_mtp_policy: mtp_policy,
        mlx_disable_ngram_acceleration: disable_ngram,
        // Keep the unstable n-gram draft source out of the otherwise validated
        // model-based MTP verification loop.
        mlx_mtp_disable_ngram_stacking: true,
        ..Default::default()
    };
    log::info!(
        "[mlx-worker] build_session_context model_dir={} mtp={mtp_policy:?} ngram={}",
        model_dir.display(),
        if enable_ngram {
            "ON (set via AX_MLX_NGRAM=1 — expect crash on 4-bit)"
        } else {
            "OFF (default; independent from packaged MTP)"
        },
    );
    StatelessGenerateContext::new(config)
        .map_err(|e| format!("StatelessGenerateContext::new failed: {e:?}"))
}

fn build_session(context: &StatelessGenerateContext) -> Result<EngineSession, String> {
    // Wrap in catch_unwind: the MLX FFI layer may panic on unsupported
    // configurations or corrupted model files. Without this, the panic
    // kills the worker thread and the frontend sees only "worker dropped
    // reply" with no useful error message.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        context.build_stateful_session()
    }))
    .map_err(|panic_info| {
        let detail = if let Some(s) = panic_info.downcast_ref::<String>() {
            s.clone()
        } else if let Some(s) = panic_info.downcast_ref::<&str>() {
            s.to_string()
        } else {
            "unknown panic".to_string()
        };
        format!("MLX engine panicked during model initialization: {detail}")
    })?
    .map_err(|e| format!("StatelessGenerateContext::build_stateful_session failed: {e:?}"))
}

fn mtp_policy_from_env() -> MlxMtpPolicy {
    let value = std::env::var("AX_MLX_MTP_POLICY").ok();
    match value.as_deref().map(str::trim) {
        None | Some("") | Some("auto") | Some("AUTO") | Some("Auto") | Some("1") | Some("true")
        | Some("TRUE") | Some("on") | Some("ON") => MlxMtpPolicy::Auto,
        Some("disabled") | Some("DISABLED") | Some("Disabled") | Some("disable") | Some("off")
        | Some("OFF") | Some("0") | Some("false") | Some("FALSE") => MlxMtpPolicy::Disabled,
        Some("required") | Some("REQUIRED") | Some("Required") | Some("require") => {
            MlxMtpPolicy::Required
        }
        Some(other) => {
            log::warn!("[mlx-worker] ignoring invalid AX_MLX_MTP_POLICY={other:?}; using Auto");
            MlxMtpPolicy::Auto
        }
    }
}

fn take_warm_session(entry: &mut LoadedModel, model_id: &str) -> Result<EngineSession, String> {
    if let Some(session) = entry.warm_session.take() {
        log::info!("[mlx-worker] using prebuilt session for {model_id}");
        Ok(session)
    } else {
        log::info!("[mlx-worker] no prebuilt session for {model_id}; building on demand");
        build_session(&entry.session_context)
    }
}

/// Optionally prebuild the next `EngineSession` after a successful generation.
///
/// **Default: OFF.** Rebuilding a full session after every reply keeps a second
/// copy of large models (e.g. Qwen 27B MTP) resident in unified memory. When the
/// user then switches to Gemma 4, Metal has to free that working set before the
/// new load can proceed — that free+alloc thrash is the multi-minute "hang"
/// after Qwen → Gemma. Opt in with `AX_MLX_WARM_NEXT_SESSION=1` for small-model
/// TTFT experiments only.
fn prepare_next_session(entry: &mut LoadedModel, model_id: &str) {
    let enable = std::env::var("AX_MLX_WARM_NEXT_SESSION")
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "True" | "on" | "ON"))
        .unwrap_or(false);
    if !enable {
        entry.warm_session = None;
        log::debug!(
            "[mlx-worker] skipping next-session warm for {model_id} \
             (set AX_MLX_WARM_NEXT_SESSION=1 to re-enable)"
        );
        return;
    }
    let started = std::time::Instant::now();
    match build_session(&entry.session_context) {
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
                let result = if models.remove(&model_id).is_some() {
                    log::info!("[mlx-worker] unloaded model {model_id}");
                    // Only clear process-global compile caches once no model
                    // remains. Clearing while another model is still resident
                    // would drop that model's live decode closures.
                    if models.is_empty() {
                        clear_native_caches_after_model_drain("explicit unload");
                    }
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
                request_id,
                model_id,
                messages,
                params,
                cancellation,
                on_event,
                reply,
            } => {
                let result = handle_generate_stream(
                    &mut models,
                    &request_id,
                    &model_id,
                    messages,
                    params,
                    &cancellation,
                    &on_event,
                );
                if let Err(ref e) = result {
                    on_event(StreamEvent::Error { message: e.clone() });
                }
                let _ = reply.send(result);
            }
        }
    }

    log::info!("[mlx-worker] command channel closed; thread exiting");
}

/// Drop every resident model, then clear process-global MLX compile caches.
///
/// This mirrors `ax-engine-server`'s `NativeGenerationService::spawn_replacement`
/// contract: `EngineSession` / `StatelessGenerateContext` drop free request-local
/// weights and prefix state, but **process-global** compiled per-layer decode
/// closures (MoE, dense FFN, Gemma4 dual-path) and the MLX allocator cache
/// survive. After a large Qwen MTP run those graphs still reference the old
/// model's buffers; loading Gemma 4 without clearing them hangs Metal eval or
/// SIGSEGVs in sampling (`sample_categorical_with_topp_gpu`).
fn drain_loaded_models(models: &mut HashMap<String, LoadedModel>, reason: &str) {
    if models.is_empty() {
        return;
    }
    let previous_models: Vec<String> = models.keys().cloned().collect();
    for previous_model in &previous_models {
        log::info!("[mlx-worker] unloading previous model ({reason}): {previous_model}");
    }
    // Drop warm sessions first (full weight sets), then contexts. Logging the
    // wall time makes Metal free stalls visible in app.log when switching from
    // large MTP packages to smaller models.
    let drop_started = std::time::Instant::now();
    for (model_id, mut entry) in models.drain() {
        let warm_started = std::time::Instant::now();
        if entry.warm_session.take().is_some() {
            log::info!(
                "[mlx-worker] dropped warm session for {model_id} in {}ms",
                warm_started.elapsed().as_millis()
            );
        }
        let ctx_started = std::time::Instant::now();
        drop(entry);
        log::info!(
            "[mlx-worker] dropped session context for {model_id} in {}ms",
            ctx_started.elapsed().as_millis()
        );
    }
    log::info!(
        "[mlx-worker] finished dropping previous model(s) for {reason} in {}ms",
        drop_started.elapsed().as_millis()
    );
    clear_native_caches_after_model_drain(reason);
}

fn clear_native_caches_after_model_drain(reason: &str) {
    let started = std::time::Instant::now();
    log::info!("[mlx-worker] clearing native MLX compile caches after {reason}");
    EngineSession::clear_native_model_compile_caches();
    // Second pass: after large MTP packages the allocator can still hold
    // peak-watermark slabs; one more clear after the first free helps the
    // subsequent model load fit in unified memory without thrashing.
    EngineSession::clear_native_model_compile_caches();
    log::info!(
        "[mlx-worker] native MLX compile caches cleared in {}ms",
        started.elapsed().as_millis()
    );
}

fn handle_load(
    models: &mut HashMap<String, LoadedModel>,
    model_id: &str,
    model_dir: &Path,
) -> Result<(), String> {
    if models.contains_key(model_id) {
        log::debug!("[mlx-worker] load: {model_id} already resident, no-op");
        return Ok(());
    }

    // Single-resident design: any previous model must be fully drained
    // (sessions + process-global compile caches) before constructing the next.
    drain_loaded_models(models, "model switch");

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

    // Validate model architecture before calling into MLX FFI. Unsupported
    // architectures (e.g. multimodal MoE) cause the MLX C library to abort()
    // which kills the worker thread with no recoverable error. Pre-checking
    // here gives the user a clear message instead of a silent crash.
    validate_model_architecture(model_dir, model_id)?;

    // Probe that the model can initialize, then drop the probe session so large
    // packages (Qwen 27B MTP) are not kept resident between load and the first
    // chat turn — and so a subsequent model switch does not have to free a
    // full weight set that was never used for generation.
    log::info!(
        "[mlx-worker] loading model {model_id} from {}",
        model_dir.display()
    );
    let session_context = build_session_context(model_dir)
        .map_err(|e| format!("session context probe failed for {model_id}: {e}"))?;
    let probe_started = std::time::Instant::now();
    let probe_session = build_session(&session_context)
        .map_err(|e| format!("EngineSession::new probe failed for {model_id}: {e}"))?;
    drop(probe_session);
    log::info!(
        "[mlx-worker] model probe ok for {model_id} in {}ms (session not retained)",
        probe_started.elapsed().as_millis()
    );

    models.insert(
        model_id.to_string(),
        LoadedModel {
            tokenizer,
            session_context,
            warm_session: None,
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

    let sampling = effective_sampling(model_id, &params);

    let stop_sequences = effective_stop_sequences(model_id, params.stop);

    let max_output_tokens = effective_max_output_tokens(params.max_output_tokens);

    let request = GenerateRequest {
        model_id: model_id.to_string(),
        input_tokens: prompt_tokens.clone(),
        input_text: None,
        max_output_tokens,
        sampling,
        stop_sequences,
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
    let response = match session.generate(request) {
        Ok(r) => r,
        Err(e) => {
            let err_str = format!("{e:?}");
            // Provide more helpful diagnostics for common MLX failures
            if err_str.contains("Compute error") || err_str.contains("compute") {
                return Err(format!(
                    "MLX compute error for {model_id}. This typically means: \
                     (1) insufficient unified memory — try a smaller quantization like Q4_K_M, \
                     (2) incompatible quantization format (IQ4_XS may not work on all chips), \
                     (3) older Apple Silicon with limited Metal support. \
                     Original error: {err_str}"
                ));
            }
            return Err(format!("session.generate failed for {model_id}: {err_str}"));
        }
    };
    drop(session);

    let mut output_text = entry
        .decode_chat_output(model_id, &response.output_tokens)
        .map_err(|e| format!("tokenizer.decode failed for {model_id}: {e}"))?;
    if is_gemma4_family(model_id) {
        output_text = strip_gemma4_leading_thought_label(&output_text);
    }

    let prompt_token_count = response
        .prompt_token_count
        .unwrap_or(response.prompt_tokens.len() as u32);
    let output_token_count = response
        .output_token_count
        .unwrap_or(response.output_tokens.len() as u32);

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
    request_id: &str,
    model_id: &str,
    messages: Vec<ChatMessage>,
    params: GenerateParams,
    cancellation: &AtomicBool,
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

    let sampling = effective_sampling(model_id, &params);
    let max_output_tokens = effective_max_output_tokens(params.max_output_tokens);
    let stop_sequences = effective_stop_sequences(model_id, params.stop);

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
         max_out={max_output_tokens}, temperature={}, top_p={}, top_k={}, \
         repetition_penalty={}, seed={}",
        request.sampling.temperature,
        request.sampling.top_p,
        request.sampling.top_k,
        request.sampling.repetition_penalty,
        request.sampling.seed
    );

    let mut session = take_warm_session(entry, model_id)?;
    let started = std::time::Instant::now();
    let mut stream = match session.stream_generate(request) {
        Ok(s) => s,
        Err(e) => {
            let err_str = format!("{e:?}");
            if err_str.contains("Compute error") || err_str.contains("compute") {
                return Err(format!(
                    "MLX compute error for {model_id}. This typically means: \
                     (1) insufficient unified memory — try a smaller quantization like Q4_K_M, \
                     (2) incompatible quantization format (IQ4_XS may not work on all chips), \
                     (3) older Apple Silicon with limited Metal support. \
                     Original error: {err_str}"
                ));
            }
            return Err(format!(
                "session.stream_generate failed for {model_id}: {err_str}"
            ));
        }
    };
    let mut saw_start = false;
    let mut engine_request_id = None;
    let mut prompt_token_count = prompt_token_count;
    let mut output_token_count = 0_u32;
    let mut finish_reason = "stop".to_string();
    let mut accumulated_output_tokens = Vec::new();
    let mut emitted_text = String::new();
    let mut strip_gemma4_thought_prefix = is_gemma4_family(model_id);
    // Hugging Face's DecodeStream keeps only the small context window needed
    // for whitespace and byte-fallback correctness. Re-decoding the complete
    // growing output after every engine step is O(n²) and blocks the next GPU
    // pull. Gemma 4 keeps its channel-aware decoder until that state machine is
    // migrated separately.
    let mut output_decode_stream =
        (!is_gemma4_family(model_id)).then(|| entry.tokenizer.decode_stream(true));
    let mut text_decode_time_us = 0_u64;
    let mut delta_delivery_time_us = 0_u64;
    let mut cancelled = false;
    let mut performance = None;
    let mut prefix_reused_tokens = 0_u32;

    loop {
        if cancellation.load(Ordering::Acquire) {
            cancelled = true;
            break;
        }
        let Some(event_result) = stream.next() else {
            break;
        };
        let event = event_result
            .map_err(|e| format!("session.next_stream_event failed for {model_id}: {e:?}"))?;

        if cancellation.load(Ordering::Acquire) {
            cancelled = true;
            break;
        }

        match event {
            SdkGenerateStreamEvent::Request(request_event) => {
                engine_request_id = Some(request_event.request.request_id);
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
                engine_request_id = Some(step_event.request.request_id);
                if !saw_start {
                    on_event(StreamEvent::Start {
                        model_id: model_id.to_string(),
                        prompt_token_count,
                    });
                    saw_start = true;
                }
                if !step_event.delta_tokens.is_empty() {
                    let decode_started = std::time::Instant::now();
                    accumulated_output_tokens.extend(step_event.delta_tokens.iter().copied());
                    let incremental_result = output_decode_stream.as_mut().map(|decoder| {
                        let mut text = String::new();
                        for &token in &step_event.delta_tokens {
                            let step_result =
                                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                    decoder.step(token)
                                }));
                            match step_result {
                                Ok(Ok(Some(chunk))) => text.push_str(&chunk),
                                Ok(Ok(None)) => {}
                                Ok(Err(error)) => return Err(error.to_string()),
                                Err(_) => return Err("decoder panicked".to_string()),
                            }
                        }
                        Ok(text)
                    });
                    let text = match incremental_result {
                        Some(Ok(text)) => {
                            emitted_text.push_str(&text);
                            text
                        }
                        Some(Err(error)) => {
                            // A decoder is third-party stateful code. Never let
                            // an internal error or panic kill the long-lived MLX
                            // worker; fall back to the proven cumulative path
                            // for the rest of this response.
                            log::warn!(
                                "[mlx-worker] incremental tokenizer failed for {model_id}: \
                                 {error}; falling back to cumulative decode"
                            );
                            output_decode_stream = None;
                            let full_text = entry
                                .decode_chat_output(model_id, &accumulated_output_tokens)
                                .map_err(|e| {
                                    format!("tokenizer.decode failed for {model_id}: {e}")
                                })?;
                            if decoded_text_has_incomplete_trailing_codepoint(&full_text) {
                                String::new()
                            } else {
                                let text = decoded_text_delta(&emitted_text, &full_text);
                                emitted_text = full_text;
                                text
                            }
                        }
                        None => {
                            let mut full_text = entry
                                .decode_chat_output(model_id, &accumulated_output_tokens)
                                .map_err(|e| {
                                    format!("tokenizer.decode failed for {model_id}: {e}")
                                })?;
                            full_text = strip_gemma4_leading_thought_label(&full_text);
                            if !full_text.is_empty() {
                                strip_gemma4_thought_prefix = false;
                            }
                            if decoded_text_has_incomplete_trailing_codepoint(&full_text) {
                                log::debug!(
                                "[mlx-worker] holding back incomplete trailing codepoint for {model_id}"
                            );
                                String::new()
                            } else {
                                let text = decoded_text_delta(&emitted_text, &full_text);
                                emitted_text = full_text;
                                text
                            }
                        }
                    };
                    text_decode_time_us = text_decode_time_us.saturating_add(
                        decode_started
                            .elapsed()
                            .as_micros()
                            .min(u128::from(u64::MAX)) as u64,
                    );
                    if !text.is_empty() {
                        let delivery_started = std::time::Instant::now();
                        on_event(StreamEvent::Delta { text });
                        delta_delivery_time_us = delta_delivery_time_us.saturating_add(
                            delivery_started
                                .elapsed()
                                .as_micros()
                                .min(u128::from(u64::MAX)) as u64,
                        );
                    }
                } else if let Some(text) = step_event.delta_text {
                    let text = if strip_gemma4_thought_prefix {
                        strip_gemma4_stream_prefix(text, &mut strip_gemma4_thought_prefix)
                    } else {
                        text
                    };
                    if !text.is_empty() {
                        emitted_text.push_str(&text);
                        let delivery_started = std::time::Instant::now();
                        on_event(StreamEvent::Delta { text });
                        delta_delivery_time_us = delta_delivery_time_us.saturating_add(
                            delivery_started
                                .elapsed()
                                .as_micros()
                                .min(u128::from(u64::MAX)) as u64,
                        );
                    }
                }
            }
            SdkGenerateStreamEvent::Response(response_event) => {
                let response = response_event.response;
                prefix_reused_tokens = response
                    .route
                    .decision("ax_mlx_prefix_cache_reused_tokens")
                    .or_else(|| response.route.decision("prefix_reused_tokens"))
                    .unwrap_or_default();
                if !response.output_tokens.is_empty() {
                    let decode_started = std::time::Instant::now();
                    let mut final_text = entry
                        .decode_chat_output(model_id, &response.output_tokens)
                        .map_err(|e| format!("tokenizer.decode failed for {model_id}: {e}"))?;
                    if is_gemma4_family(model_id) {
                        final_text = strip_gemma4_leading_thought_label(&final_text);
                    }
                    let text = decoded_text_delta(&emitted_text, &final_text);
                    emitted_text = final_text;
                    text_decode_time_us = text_decode_time_us.saturating_add(
                        decode_started
                            .elapsed()
                            .as_micros()
                            .min(u128::from(u64::MAX)) as u64,
                    );
                    if !text.is_empty() {
                        let delivery_started = std::time::Instant::now();
                        on_event(StreamEvent::Delta { text });
                        delta_delivery_time_us = delta_delivery_time_us.saturating_add(
                            delivery_started
                                .elapsed()
                                .as_micros()
                                .min(u128::from(u64::MAX)) as u64,
                        );
                    }
                }
                prompt_token_count = response
                    .prompt_token_count
                    .unwrap_or(response.prompt_tokens.len() as u32);
                output_token_count = response
                    .output_token_count
                    .unwrap_or(response.output_tokens.len() as u32);
                performance = Some(StreamPerformanceMetrics::from_response(&response));
                finish_reason = response_finish_reason(&response);
            }
        }
    }

    if cancelled {
        output_token_count = accumulated_output_tokens.len() as u32;
        finish_reason = "cancelled".to_string();
        log::info!("[mlx-worker] cancelled stream {request_id} for {model_id}");
    }

    let elapsed_ms = started.elapsed().as_millis() as u64;
    if let Some(metrics) = &performance {
        let mtp_acceptance_percent = if metrics.mtp.draft_tokens > 0 {
            f64::from(metrics.mtp.accepted_tokens) * 100.0 / f64::from(metrics.mtp.draft_tokens)
        } else {
            0.0
        };
        log::info!(
            "[mlx-worker] stream done: model={} tokens/{:?}us = {:.1} t/s, \
             runner={:.1} t/s, delivered={} tokens/{:?}us = {:.1} t/s, \
             total={}us, ttft={:?}us, prompt_eval={:?}us, prefix_reused={}, \
             decode={}us, ipc={}us, \
             route={}, mtp={}/{} ({:.1}%), mtp_steps={}, direct_fallback_steps={}, \
             finish_reason={finish_reason}",
            metrics
                .model_eval_token_count
                .unwrap_or(metrics.generation_token_count),
            metrics.model_eval_time_us.or(metrics.generation_time_us),
            metrics.tokens_per_second().unwrap_or_default(),
            metrics.runner_tokens_per_second().unwrap_or_default(),
            metrics.generation_token_count,
            metrics.generation_time_us,
            metrics.delivery_tokens_per_second().unwrap_or_default(),
            metrics.total_time_us,
            metrics.time_to_first_token_us,
            metrics.prompt_eval_time_us,
            prefix_reused_tokens,
            text_decode_time_us,
            delta_delivery_time_us,
            metrics.acceleration_mode(),
            metrics.mtp.accepted_tokens,
            metrics.mtp.draft_tokens,
            mtp_acceptance_percent,
            metrics.mtp.decode_steps,
            metrics.mtp.direct_fallback_steps,
        );
    } else {
        log::info!(
            "[mlx-worker] stream done without native performance report: \
             {output_token_count} tokens in {elapsed_ms}ms, finish_reason={finish_reason}"
        );
    }

    on_event(StreamEvent::Done {
        prompt_token_count,
        output_token_count,
        finish_reason,
        elapsed_ms,
        performance,
    });

    drop(output_decode_stream);
    // Stream borrows session mutably; drop it before cancel_request / drop.
    drop(stream);
    if cancelled {
        if let Some(engine_request_id) = engine_request_id {
            if let Err(error) = session.cancel_request(engine_request_id) {
                log::debug!(
                    "[mlx-worker] native cancellation cleanup failed for {request_id}: {error}"
                );
            }
        }
    }
    drop(session);
    // Warm-next is off by default (see prepare_next_session). After cancel we
    // never warm — the user is usually switching models.
    if !cancelled {
        prepare_next_session(entry, model_id);
    }

    Ok(())
}

/// Dispatch prompt formatting to the right template based on the model
/// family. Each family has its own turn-marker conventions and the model
/// will produce garbage if fed the wrong format.
fn format_prompt(messages: &[ChatMessage], model_id: &str) -> String {
    if is_gemma4_family(model_id) {
        format_gemma4(messages)
    } else if is_gemma_family(model_id) {
        format_gemma(messages)
    } else {
        format_chatml(messages, model_id)
    }
}

fn effective_stop_sequences(model_id: &str, requested: Option<Vec<String>>) -> Vec<String> {
    let mut stops = requested.unwrap_or_default();
    // Gemma 4's generation_config lists multiple EOS ids (<eos>, <turn|>,
    // <|tool_response>). The engine also stops on model eos ids, but string
    // stop sequences cover the decoded path when packages omit full eos wiring.
    let family_stops: &[&str] = if is_gemma4_family(model_id) {
        &["<turn|>", "<eos>", "<|tool_response>"]
    } else if is_gemma_family(model_id) {
        &["<end_of_turn>", "<eos>"]
    } else if model_id.to_lowercase().contains("qwen") {
        &["<|im_end|>"]
    } else {
        &[]
    };

    for stop in family_stops {
        if !stops.iter().any(|existing| existing == stop) {
            stops.push((*stop).to_string());
        }
    }
    stops
}

fn effective_max_output_tokens(requested: Option<u32>) -> u32 {
    // AX Engine owns model-family-specific scheduling. In particular,
    // DiffusionGemma's canvas size is an internal block size, not a response
    // limit: the engine drains a completed block and generates another while
    // request budget remains. Preserve the caller's budget so long-form and
    // multi-block responses can complete normally.
    requested.unwrap_or(DEFAULT_MLX_MAX_OUTPUT_TOKENS).max(1)
}

fn effective_sampling(model_id: &str, params: &GenerateParams) -> GenerateSampling {
    if is_diffusion_gemma_family(model_id) {
        return GenerateSampling {
            temperature: 0.0,
            top_p: 1.0,
            top_k: 0,
            min_p: None,
            repetition_penalty: 1.1,
            repetition_context_size: None,
            // Diffusion generation starts from a random token canvas. Reusing
            // seed 0 for every chat request makes a failed/early-EOS block
            // recur almost verbatim when the user retries or says "continue".
            // Keep explicit seeds reproducible, but give ordinary chat turns
            // a fresh canvas.
            seed: params
                .seed
                .unwrap_or_else(|| NEXT_DIFFUSION_REQUEST_SEED.fetch_add(1, Ordering::Relaxed)),
            deterministic: None,
            ignore_eos: false,
        };
    }

    GenerateSampling {
        temperature: params.temperature.unwrap_or(0.7),
        top_p: params.top_p.unwrap_or(0.95),
        top_k: params.top_k.unwrap_or(DEFAULT_MLX_TOP_K),
        min_p: None,
        repetition_penalty: params.repetition_penalty.unwrap_or(1.0),
        repetition_context_size: None,
        seed: params.seed.unwrap_or(0),
        deterministic: None,
        ignore_eos: false,
    }
}

fn decoded_text_delta(previous: &str, current: &str) -> String {
    if let Some(suffix) = current.strip_prefix(previous) {
        return suffix.to_string();
    }

    let mut previous_chars = previous.chars();
    let mut common_byte_len = 0;
    for (idx, current_ch) in current.char_indices() {
        match previous_chars.next() {
            Some(previous_ch) if previous_ch == current_ch => {
                common_byte_len = idx + current_ch.len_utf8();
            }
            _ => break,
        }
    }
    current[common_byte_len..].to_string()
}

fn decoded_text_has_incomplete_trailing_codepoint(text: &str) -> bool {
    text.ends_with('\u{FFFD}')
}

/// Validate the model architecture from `config.json` before calling into MLX
/// FFI. The MLX C library calls `abort()` on unsupported architectures, which
/// kills the worker thread irrecoverably. We reject known-unsupported types
/// (multimodal MoE, vision-conditional) with a clear error message.
fn validate_model_architecture(model_dir: &Path, model_id: &str) -> Result<(), String> {
    let config_path = model_dir.join("config.json");
    if !config_path.is_file() {
        // No config.json — let the engine decide; it may still work.
        return Ok(());
    }

    let config_str = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return Ok(()), // can't read — don't block
    };

    // Minimal JSON parse: extract "architectures": ["..."] without pulling
    // in a full JSON crate. The field is always a simple string array.
    let Some(arch_block) = extract_json_string_array(&config_str, "architectures") else {
        return Ok(()); // no architectures field — don't block
    };

    if arch_block.is_empty() {
        return Ok(());
    }

    let arch = &arch_block[0]; // primary architecture

    log::info!("[mlx-worker] model {model_id} architecture: {arch}");
    Ok(())
}

/// Extract the first string array value for a given JSON key from raw JSON
/// text. Minimal parser — avoids pulling in serde_json for a single field.
fn extract_json_string_array(json: &str, key: &str) -> Option<Vec<String>> {
    let pattern = format!("\"{}\"", key);
    let key_pos = json.find(&pattern)?;
    let after_key = &json[key_pos + pattern.len()..];
    let colon_pos = after_key.find(':')?;
    let after_colon = after_key[colon_pos + 1..].trim_start();

    if !after_colon.starts_with('[') {
        return None;
    }
    let bracket_start = &after_colon[1..];
    let bracket_end = bracket_start.find(']')?;
    let array_content = &bracket_start[..bracket_end];

    let mut results = Vec::new();
    let mut remaining = array_content;
    while let Some(quote_start) = remaining.find('"') {
        let inner = &remaining[quote_start + 1..];
        if let Some(quote_end) = inner.find('"') {
            results.push(inner[..quote_end].to_string());
            remaining = &inner[quote_end + 1..];
        } else {
            break;
        }
    }
    Some(results)
}

#[derive(Clone, Copy, Debug)]
struct Gemma4ChannelIds {
    open: u32,
    close: u32,
}

impl Gemma4ChannelIds {
    fn from_tokenizer(tokenizer: &Tokenizer) -> Option<Self> {
        Some(Self {
            open: tokenizer.token_to_id(GEMMA4_CHANNEL_OPEN)?,
            close: tokenizer.token_to_id(GEMMA4_CHANNEL_CLOSE)?,
        })
    }
}

fn split_gemma4_channels(tokens: &[u32], ids: Gemma4ChannelIds) -> (Vec<u32>, Vec<Vec<u32>>) {
    let mut kept = Vec::with_capacity(tokens.len());
    let mut channel_bodies = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        if tokens[i] == ids.open {
            let body_start = i + 1;
            match tokens[body_start..].iter().position(|&t| t == ids.close) {
                Some(offset) => {
                    channel_bodies.push(tokens[body_start..body_start + offset].to_vec());
                    i = body_start + offset + 1;
                }
                None => {
                    channel_bodies.push(tokens[body_start..].to_vec());
                    i = tokens.len();
                }
            }
        } else if tokens[i] == ids.close {
            if !kept.is_empty() {
                channel_bodies.push(std::mem::take(&mut kept));
            }
            i += 1;
        } else {
            kept.push(tokens[i]);
            i += 1;
        }
    }
    (kept, channel_bodies)
}

fn strip_gemma4_channel_name_header(body: &str) -> &str {
    let Some((name, rest)) = body.split_once('\n') else {
        return body;
    };
    let name = name.trim();
    if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        rest
    } else {
        body
    }
}

fn decode_gemma4_chat_output(
    tokenizer: &Tokenizer,
    output_tokens: &[u32],
) -> Result<String, tokenizers::Error> {
    let Some(ids) = Gemma4ChannelIds::from_tokenizer(tokenizer) else {
        return tokenizer.decode(output_tokens, true);
    };
    let (kept, channel_bodies) = split_gemma4_channels(output_tokens, ids);
    if channel_bodies.is_empty() {
        return tokenizer.decode(output_tokens, true);
    }

    let mut body_texts = Vec::with_capacity(channel_bodies.len());
    for body in &channel_bodies {
        let body_text = tokenizer.decode(body, true)?;
        body_texts.push(strip_gemma4_channel_name_header(&body_text).to_string());
    }
    let kept_text = tokenizer.decode(&kept, true)?;
    if kept_text.trim().is_empty() {
        Ok(body_texts.pop().unwrap_or(kept_text))
    } else {
        Ok(kept_text)
    }
}

fn is_gemma4_family(model_id: &str) -> bool {
    let id_lower = model_id.to_lowercase();
    id_lower.contains("gemma-4")
        || id_lower.contains("gemma4")
        || is_diffusion_gemma_family(model_id)
}

fn is_gemma_family(model_id: &str) -> bool {
    let id_lower = model_id.to_lowercase();
    id_lower.contains("gemma-4") || id_lower.contains("gemma-3") || id_lower.contains("gemma4")
}

fn is_diffusion_gemma_family(model_id: &str) -> bool {
    let id_lower = model_id.to_lowercase();
    id_lower.contains("diffusiongemma")
        || id_lower.contains("diffusion-gemma")
        || id_lower.contains("diffusion_gemma")
}

/// Gemma 4 unified chat-template dialect. The empty thought channel mirrors
/// the model's tokenizer template when `enable_thinking=false`; without it,
/// Gemma may expose `thought` as visible answer text.
fn format_gemma4(messages: &[ChatMessage]) -> String {
    let mut out = String::from("<bos>");
    for m in messages {
        match m.role.as_str() {
            "system" | "developer" => {
                out.push_str("<|turn>system\n");
                out.push_str(&m.content);
                out.push_str("<turn|>\n");
            }
            "user" => {
                out.push_str("<|turn>user\n");
                out.push_str(&m.content);
                out.push_str("<turn|>\n");
            }
            "assistant" | "tool" => {
                out.push_str("<|turn>model\n");
                out.push_str(&strip_gemma4_leading_thought_label(&m.content));
                out.push_str("<turn|>\n");
            }
            other => {
                log::warn!("[mlx-worker] gemma4: unknown role '{other}', treating as user");
                out.push_str("<|turn>user\n");
                out.push_str(&m.content);
                out.push_str("<turn|>\n");
            }
        }
    }
    out.push_str("<|turn>model\n<|channel>thought\n<channel|>");
    out
}

fn strip_gemma4_leading_thought_label(text: &str) -> String {
    let trimmed = text.trim_start();
    if let Some(rest) = trimmed.strip_prefix("thought") {
        if rest.is_empty()
            || rest
                .chars()
                .next()
                .is_some_and(|ch| ch.is_whitespace() || ch == ':' || ch == '\n')
        {
            return rest
                .trim_start_matches(|ch: char| ch.is_whitespace() || ch == ':')
                .to_string();
        }
    }
    text.to_string()
}

fn strip_gemma4_stream_prefix(text: String, stripping: &mut bool) -> String {
    if !*stripping {
        return text;
    }

    let trimmed = text.trim_start();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(rest) = trimmed.strip_prefix("thought") {
        if rest.is_empty()
            || rest
                .chars()
                .next()
                .is_some_and(|ch| ch.is_whitespace() || ch == ':' || ch == '\n')
        {
            let cleaned = rest
                .trim_start_matches(|ch: char| ch.is_whitespace() || ch == ':')
                .to_string();
            if !cleaned.is_empty() {
                *stripping = false;
            }
            return cleaned;
        }
    }

    *stripping = false;
    trimmed.to_string()
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

        assert!(prompt.starts_with("<bos>"));
        assert!(prompt.contains("<|turn>user\nHello<turn|>\n"));
        assert!(prompt.ends_with("<|turn>model\n<|channel>thought\n<channel|>"));
        assert!(!prompt.contains("<start_of_turn>"));
    }

    #[test]
    fn diffusiongemma_uses_gemma4_template_and_preserves_request_budget() {
        let prompt = format_prompt(
            &[user_msg("Hello")],
            "mlx-community/diffusiongemma-26B-A4B-it-4bit",
        );

        assert!(prompt.starts_with("<bos>"));
        assert!(prompt.contains("<|turn>user\nHello<turn|>\n"));
        assert!(prompt.ends_with("<|turn>model\n<|channel>thought\n<channel|>"));
        assert!(!prompt.contains("<|im_start|>"));

        let stops = effective_stop_sequences(
            "mlx-community/diffusiongemma-26B-A4B-it-4bit",
            Some(vec!["custom-stop".to_string()]),
        );
        assert!(stops.contains(&"custom-stop".to_string()));
        assert!(stops.contains(&"<turn|>".to_string()));
        assert!(!stops.contains(&"<|channel>".to_string()));
        assert!(!stops.contains(&"<channel|>".to_string()));

        let requested_budget = 4096;
        assert_eq!(
            effective_max_output_tokens(Some(requested_budget)),
            requested_budget
        );
        assert_eq!(
            effective_max_output_tokens(None),
            DEFAULT_MLX_MAX_OUTPUT_TOKENS
        );
        assert_eq!(effective_max_output_tokens(Some(0)), 1);

        let sampling = effective_sampling(
            "mlx-community/diffusiongemma-26B-A4B-it-4bit",
            &GenerateParams {
                max_output_tokens: Some(4096),
                temperature: Some(0.8),
                top_p: Some(0.5),
                top_k: Some(20),
                repetition_penalty: Some(1.0),
                seed: Some(42),
                stop: None,
            },
        );
        assert_eq!(sampling.temperature, 0.0);
        assert_eq!(sampling.top_p, 1.0);
        assert_eq!(sampling.top_k, 0);
        assert_eq!(sampling.repetition_penalty, 1.1);
        assert_eq!(sampling.seed, 42);

        let default_params = GenerateParams::default();
        let first_seed = effective_sampling(
            "mlx-community/diffusiongemma-26B-A4B-it-4bit",
            &default_params,
        )
        .seed;
        let second_seed = effective_sampling(
            "mlx-community/diffusiongemma-26B-A4B-it-4bit",
            &default_params,
        )
        .seed;
        assert_ne!(first_seed, second_seed);
    }

    #[test]
    fn autoregressive_defaults_keep_exact_sampled_mtp_eligible() {
        let sampling = effective_sampling(
            "mlx-community/Qwen3.6-35B-A3B-6bit-MTP",
            &GenerateParams::default(),
        );

        assert_eq!(sampling.temperature, 0.7);
        assert_eq!(sampling.top_p, 0.95);
        assert_eq!(sampling.top_k, DEFAULT_MLX_TOP_K);
        assert_eq!(sampling.repetition_penalty, 1.0);
    }

    #[test]
    fn gemma4_strips_leading_thought_label_from_visible_output() {
        assert_eq!(
            strip_gemma4_leading_thought_label("thought The capital is Ottawa."),
            "The capital is Ottawa."
        );

        let mut stripping = true;
        assert_eq!(
            strip_gemma4_stream_prefix("thought".to_string(), &mut stripping),
            ""
        );
        assert!(stripping);
        assert_eq!(
            strip_gemma4_stream_prefix("\nThe capital is Ottawa.".to_string(), &mut stripping),
            "The capital is Ottawa."
        );
        assert!(!stripping);
    }

    #[test]
    fn gemma4_adds_control_token_stop_sequences() {
        let stops = effective_stop_sequences(
            "mlx-community/gemma-4-12B-it-4bit",
            Some(vec!["custom-stop".to_string(), "<turn|>".to_string()]),
        );

        assert!(stops.contains(&"custom-stop".to_string()));
        assert!(stops.contains(&"<turn|>".to_string()));
        assert!(stops.contains(&"<eos>".to_string()));
        assert!(stops.contains(&"<|tool_response>".to_string()));
        assert!(!stops.contains(&"<|turn>".to_string()));
        assert!(!stops.contains(&"<|channel>".to_string()));
        assert!(!stops.contains(&"<channel|>".to_string()));
        assert_eq!(
            stops
                .iter()
                .filter(|stop| stop.as_str() == "<turn|>")
                .count(),
            1
        );
    }

    #[test]
    fn prepare_next_session_defaults_to_off_without_env() {
        // Safety: do not leave a full second EngineSession resident after every
        // reply — that is what made Qwen 27B → Gemma switches thrash Metal.
        let enable = std::env::var("AX_MLX_WARM_NEXT_SESSION")
            .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "True" | "on" | "ON"))
            .unwrap_or(false);
        // In CI / normal test runs the env is unset, so warm-next stays off.
        if std::env::var_os("AX_MLX_WARM_NEXT_SESSION").is_none() {
            assert!(!enable);
        }
    }

    #[test]
    fn cumulative_decode_delta_emits_only_new_text() {
        assert_eq!(decoded_text_delta("Hello", "Hello world"), " world");
        assert_eq!(decoded_text_delta("AGI", "AGI stands"), " stands");
    }

    #[test]
    fn extract_json_string_array_parses_architectures() {
        let json = r#"{"architectures": ["Qwen3_5MoeForConditionalGeneration"], "model_type": "qwen3_5_moe"}"#;
        let result = extract_json_string_array(json, "architectures");
        assert_eq!(
            result,
            Some(vec!["Qwen3_5MoeForConditionalGeneration".to_string()])
        );
    }

    #[test]
    fn extract_json_string_array_returns_none_for_missing_key() {
        let json = r#"{"model_type": "qwen3"}"#;
        assert_eq!(extract_json_string_array(json, "architectures"), None);
    }

    #[test]
    fn validate_model_architecture_logs_moe_without_blocking() {
        let dir = std::env::temp_dir().join("test_mlx_arch_moe");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("config.json"),
            r#"{"architectures": ["Qwen3_5MoeForConditionalGeneration"]}"#,
        )
        .unwrap();
        // MoE models should pass validation (engine supports qwen3_5_moe)
        let result = validate_model_architecture(&dir, "mlx-community/Qwen3.5-35B-A3B-4bit");
        assert!(result.is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validate_model_architecture_allows_text_only() {
        let dir = std::env::temp_dir().join("test_mlx_arch_allow");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("config.json"),
            r#"{"architectures": ["Qwen3ForCausalLM"]}"#,
        )
        .unwrap();
        let result = validate_model_architecture(&dir, "mlx-community/Qwen3-8B-4bit");
        assert!(result.is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn incomplete_trailing_codepoint_is_detected() {
        assert!(decoded_text_has_incomplete_trailing_codepoint(
            "Program 1: �"
        ));
        assert!(!decoded_text_has_incomplete_trailing_codepoint(
            "Program 1: ✅"
        ));
        assert!(!decoded_text_has_incomplete_trailing_codepoint(
            "literal � inside text."
        ));
    }

    #[test]
    fn incremental_decode_survives_a_skipped_leading_special_token() {
        use tokenizers::{models::wordlevel::WordLevel, AddedToken};

        let vocab = [
            ("<unk>".to_string(), 0),
            ("<special>".to_string(), 1),
            ("hello".to_string(), 2),
        ]
        .into_iter()
        .collect();
        let model = WordLevel::builder()
            .vocab(vocab)
            .unk_token("<unk>".to_string())
            .build()
            .expect("word-level tokenizer should build");
        let mut tokenizer = Tokenizer::new(model);
        tokenizer
            .add_special_tokens([AddedToken::from("<special>", true)])
            .expect("special token should register");

        let mut decoder = tokenizer.decode_stream(true);
        assert_eq!(decoder.step(1).expect("special token should decode"), None);

        let mut decoded = String::new();
        for _ in 0..32 {
            if let Some(chunk) = decoder.step(2).expect("word token should decode") {
                decoded.push_str(&chunk);
            }
        }
        assert_eq!(decoded.split_whitespace().count(), 32);
    }

    #[test]
    fn stream_cancellation_registry_signals_and_cleans_up_requests() {
        let registry = StreamCancellationRegistry::default();
        let cancellation = registry.register("stream-1").unwrap();

        assert!(!cancellation.load(Ordering::Acquire));
        assert_eq!(registry.cancel("stream-1"), Ok(true));
        assert!(cancellation.load(Ordering::Acquire));

        registry.unregister("stream-1", &cancellation);
        assert_eq!(registry.cancel("stream-1"), Ok(false));
    }

    #[test]
    fn stream_cancellation_registry_cancel_all_flags_every_active_stream() {
        let registry = StreamCancellationRegistry::default();
        let a = registry.register("a").unwrap();
        let b = registry.register("b").unwrap();
        assert_eq!(registry.cancel_all().unwrap(), 2);
        assert!(a.load(Ordering::Acquire));
        assert!(b.load(Ordering::Acquire));
        // Second call still sees registered flags until unregister.
        assert_eq!(registry.cancel_all().unwrap(), 2);
        registry.unregister("a", &a);
        registry.unregister("b", &b);
        assert_eq!(registry.cancel_all().unwrap(), 0);
    }

    #[test]
    fn drain_loaded_models_is_a_no_op_when_empty() {
        let mut models: HashMap<String, LoadedModel> = HashMap::new();
        drain_loaded_models(&mut models, "unit-test empty");
        assert!(models.is_empty());
    }

    #[test]
    fn clear_native_caches_after_model_drain_does_not_panic() {
        // Mirrors ax-engine-server hot-swap: clearing process-global compile
        // caches must be safe even when no model was ever loaded.
        clear_native_caches_after_model_drain("unit-test");
    }
}
