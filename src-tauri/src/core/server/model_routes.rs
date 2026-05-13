//! Model provider routing: resolves provider config from model ID, builds outbound
//! requests, and handles upstream responses including Anthropic /messages fallback.
use ax_studio_utils::{is_cors_header, is_private_ip};
use futures_util::StreamExt;
use hyper::body::Bytes;
use hyper::{Body, Response, StatusCode};
use reqwest::Client;
use serde_json;
use std::collections::HashMap;
use std::time::Duration;
use tauri::Manager;

use super::provider_adapter::{
    forward_non_streaming, transform_and_forward_stream, transform_anthropic_to_openai,
};
use super::proxy::ProxyConfig;
use super::security::add_cors_headers_with_host_and_origin;
use crate::core::state::{AppState, ProviderConfig, ProviderCustomHeader, ProviderModelIndex};

const MODEL_LOAD_RETRY_ATTEMPTS: usize = 10;
const MODEL_LOAD_RETRY_DELAY: Duration = Duration::from_millis(500);
/// Guard against unbounded memory from malformed SSE (missing newlines) in the passthrough stream.
const MAX_SSE_LINE_BUFFER: usize = 1_048_576; // 1 MB

/// Result of resolving a model route — all data needed to send the upstream request.
pub(super) struct ProviderResolution {
    pub target_base_url: String,
    pub session_api_key: Option<String>,
    pub provider_custom_headers: Vec<ProviderCustomHeader>,
    pub is_anthropic_messages: bool,
    pub buffered_body: Bytes,
}

#[derive(Clone)]
struct ResolvedProviderConfig {
    target_base_url: String,
    session_api_key: Option<String>,
    provider_custom_headers: Vec<ProviderCustomHeader>,
}

fn is_reserved_upstream_custom_header(name: &str) -> bool {
    matches!(
        name,
        "accept-encoding"
            | "authorization"
            | "connection"
            | "content-length"
            | "cookie"
            | "forwarded"
            | "host"
            | "origin"
            | "proxy-authorization"
            | "proxy-connection"
            | "referer"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "x-api-key"
            | "x-forwarded-for"
            | "x-forwarded-host"
            | "x-forwarded-proto"
    ) || name.starts_with("proxy-")
        || name.starts_with("sec-")
}

fn error_response(
    status: StatusCode,
    message: impl Into<String>,
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
) -> Response<Body> {
    let mut builder = Response::builder().status(status);
    builder = add_cors_headers_with_host_and_origin(
        builder,
        host_header,
        origin_header,
        &config.trusted_hosts,
        config.cors_enabled,
    );
    builder
        .body(Body::from(message.into()))
        .unwrap_or_else(|e| {
            log::error!("Failed to build error response: {e}");
            Response::new(Body::from("Internal server error"))
        })
}

fn is_transient_model_loading_error(
    status: StatusCode,
    destination_path: &str,
    error_body: &str,
) -> bool {
    status == StatusCode::NOT_FOUND
        && destination_path == "/chat/completions"
        && error_body.contains("not loaded")
        && error_body.contains("loaded=")
}

/// Strip non-standard fields from the request body that upstream providers may reject.
///
/// Currently removes `reasoning_content` and `reasoning` from assistant messages.
/// These are response-only fields added by the Vercel AI SDK when prior assistant
/// turns contained thinking/reasoning tokens.  They are not part of the OpenAI API
/// spec and providers like Groq reject them with a 400 error.
///
/// Returns the original bytes unchanged if the body is not JSON, has no `messages`
/// array, or no assistant messages carry these fields.
fn message_has_tool_state(msg: &serde_json::Value) -> bool {
    if msg.get("role").and_then(|role| role.as_str()) == Some("tool") {
        return true;
    }
    if msg
        .get("tool_calls")
        .and_then(|tool_calls| tool_calls.as_array())
        .is_some_and(|tool_calls| !tool_calls.is_empty())
    {
        return true;
    }
    msg.get("content")
        .and_then(|content| content.as_array())
        .is_some_and(|content| {
            content.iter().any(|part| {
                matches!(
                    part.get("type").and_then(|part_type| part_type.as_str()),
                    Some("tool_result" | "tool_use")
                )
            })
        })
}

fn request_has_tool_state(json_body: &serde_json::Value) -> bool {
    if json_body
        .get("tools")
        .and_then(|tools| tools.as_array())
        .is_some_and(|tools| !tools.is_empty())
    {
        return true;
    }
    json_body
        .get("messages")
        .and_then(|messages| messages.as_array())
        .is_some_and(|messages| {
            messages
                .last()
                .and_then(|message| message.get("role"))
                .and_then(|role| role.as_str())
                == Some("assistant")
                || messages.iter().any(message_has_tool_state)
        })
}

fn request_has_local_knowledge_context(json_body: &serde_json::Value) -> bool {
    json_body
        .get("messages")
        .and_then(|messages| messages.as_array())
        .is_some_and(|messages| {
            messages.iter().any(|message| {
                message
                    .get("content")
                    .and_then(|content| content.as_str())
                    .is_some_and(|content| content.contains("Local Knowledge Base (ACTIVE)"))
                    || message
                        .get("content")
                        .and_then(|content| content.as_array())
                        .is_some_and(|parts| {
                            parts.iter().any(|part| {
                                part.get("text").and_then(|text| text.as_str()).is_some_and(
                                    |text| text.contains("Local Knowledge Base (ACTIVE)"),
                                )
                            })
                        })
            })
        })
}

fn disable_thinking_for_deterministic_answer(json_body: &mut serde_json::Value) -> bool {
    if !request_has_tool_state(json_body) && !request_has_local_knowledge_context(json_body) {
        return false;
    }

    if !json_body
        .get("chat_template_kwargs")
        .is_some_and(|value| value.is_object())
    {
        json_body["chat_template_kwargs"] = serde_json::json!({});
    }

    json_body["chat_template_kwargs"]["enable_thinking"] = serde_json::json!(false);
    true
}

fn normalize_request_body(body_bytes: &Bytes, allow_chat_template_kwargs: bool) -> Bytes {
    let mut json_body: serde_json::Value = match serde_json::from_slice(body_bytes) {
        Ok(v) => v,
        Err(_) => return body_bytes.clone(),
    };

    let mut modified = false;

    if let Some(messages) = json_body.get_mut("messages").and_then(|m| m.as_array_mut()) {
        for msg in messages.iter_mut() {
            let is_assistant = msg
                .get("role")
                .and_then(|r| r.as_str())
                .is_some_and(|r| r == "assistant");
            if !is_assistant {
                continue;
            }
            if let Some(obj) = msg.as_object_mut() {
                if obj.remove("reasoning_content").is_some() {
                    modified = true;
                }
                if obj.remove("reasoning").is_some() {
                    modified = true;
                }
            }
        }
    }

    if allow_chat_template_kwargs && disable_thinking_for_deterministic_answer(&mut json_body) {
        log::debug!("Disabled chat-template thinking for tool/local-knowledge request");
        modified = true;
    }

    if modified {
        if allow_chat_template_kwargs {
            log::debug!("Normalized request body before forwarding upstream");
        } else {
            log::debug!(
                "Stripped reasoning_content/reasoning from assistant messages in request body"
            );
        }
        match serde_json::to_vec(&json_body) {
            Ok(bytes) => Bytes::from(bytes),
            Err(_) => body_bytes.clone(),
        }
    } else {
        body_bytes.clone()
    }
}

fn extract_model_id(body_bytes: &[u8]) -> Result<String, String> {
    let json_body = serde_json::from_slice::<serde_json::Value>(body_bytes)
        .map_err(|e| format!("Invalid JSON body: {e}"))?;

    json_body
        .get("model")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Request body must contain a 'model' field".to_string())
}

fn find_provider_name(
    provider_configs: &HashMap<String, ProviderConfig>,
    provider_model_index: &ProviderModelIndex,
    model_id: &str,
) -> Result<Option<String>, String> {
    if let Some(sep_pos) = model_id.find('/') {
        let potential_provider = &model_id[..sep_pos];
        if provider_configs.contains_key(potential_provider) {
            return Ok(Some(potential_provider.to_string()));
        }
    }

    match provider_model_index.get(model_id).map(Vec::as_slice) {
        None | Some([]) => Ok(provider_configs.get(model_id).map(|config| config.provider.clone())),
        Some([provider]) => Ok(Some(provider.clone())),
        Some(_) => Err(format!(
            "Model '{model_id}' is configured for multiple providers. Use 'provider/model' to disambiguate."
        )),
    }
}

fn build_upstream_url(
    base_url: &str,
    destination_path: &str,
    is_anthropic_messages: bool,
) -> String {
    let trimmed = strip_provider_endpoint_suffix(base_url);

    if is_anthropic_messages {
        format!("{trimmed}/messages")
    } else {
        format!("{trimmed}{destination_path}")
    }
}

fn strip_provider_endpoint_suffix(base_url: &str) -> &str {
    let trimmed = base_url
        .trim_end_matches('/')
        .trim_end_matches("/messages")
        .trim_end_matches("/chat/completions")
        .trim_end_matches("/completions")
        .trim_end_matches("/embeddings");
    trimmed
}

fn resolve_provider_config_from_map(
    provider_configs: &HashMap<String, ProviderConfig>,
    provider_model_index: &ProviderModelIndex,
    model_id: &str,
    destination_path: &str,
    is_anthropic_messages: bool,
) -> Result<Option<ResolvedProviderConfig>, String> {
    let provider_name = match find_provider_name(provider_configs, provider_model_index, model_id)?
    {
        Some(provider_name) => provider_name,
        None => return Ok(None),
    };
    let Some(provider_cfg) = provider_configs.get(provider_name.as_str()) else {
        return Ok(None);
    };
    let Some(base_url) = provider_cfg.base_url.as_deref().filter(|u| !u.is_empty()) else {
        return Ok(None);
    };

    Ok(Some(ResolvedProviderConfig {
        target_base_url: build_upstream_url(base_url, destination_path, is_anthropic_messages),
        session_api_key: provider_cfg.api_key.clone(),
        provider_custom_headers: provider_cfg.custom_headers.clone(),
    }))
}

async fn resolve_active_ax_serving_fallback<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    provider_hint: Option<&str>,
    model_id: &str,
    destination_path: &str,
    is_anthropic_messages: bool,
) -> Option<ResolvedProviderConfig> {
    if provider_hint != Some("llamacpp") {
        return None;
    }

    let state = app_handle.try_state::<tauri_plugin_llamacpp::state::LlamacppState>()?;
    let process_map = state.llama_server_process.lock().await;
    let session = process_map
        .values()
        .find(|session| session.info.model_id == "__ax_serving__" && session.info.port > 0)?;
    let base_url = format!("http://127.0.0.1:{}/v1", session.info.port);

    log::warn!(
        "Provider 'llamacpp' was not registered for model '{model_id}'; \
         falling back to active ax-serving route at {base_url}"
    );

    Some(ResolvedProviderConfig {
        target_base_url: build_upstream_url(&base_url, destination_path, is_anthropic_messages),
        session_api_key: None,
        provider_custom_headers: Vec::new(),
    })
}

fn should_skip_upstream_request_header(name: &hyper::header::HeaderName) -> bool {
    let lower = name.as_str().to_ascii_lowercase();
    matches!(
        name,
        &hyper::header::HOST | &hyper::header::AUTHORIZATION | &hyper::header::CONTENT_LENGTH
    ) || lower == "x-api-key"
        || lower == "x-ax-provider"
        || lower == "x-ax-request-role"
        || super::proxy::is_hop_by_hop_header(name)
}

fn should_skip_anthropic_fallback_header(name: &hyper::header::HeaderName) -> bool {
    let lower = name.as_str().to_ascii_lowercase();
    matches!(
        name,
        &hyper::header::HOST
            | &hyper::header::AUTHORIZATION
            | &hyper::header::CONTENT_LENGTH
            | &hyper::header::ACCEPT_ENCODING
    ) || lower == "content-type"
        || super::proxy::is_hop_by_hop_header(name)
}

/// Resolve the provider for a POST model request (reads body, looks up provider config).
/// Returns `Ok(ProviderResolution)` on success, `Err(Response)` to return an error immediately.
pub(super) async fn resolve_model_route<R: tauri::Runtime>(
    destination_path: &str,
    body: Body,
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
    app_handle: &tauri::AppHandle<R>,
    provider_hint: Option<&str>,
    request_role: Option<&str>,
) -> Result<ProviderResolution, Response<Body>> {
    let is_anthropic_messages = destination_path == "/messages";
    if is_anthropic_messages {
        log::info!(
            "Handling POST request to /messages with chat/completions fallback on error role={}",
            request_role.unwrap_or("unknown")
        );
    } else {
        log::info!(
            "Handling POST request to {destination_path} requiring model lookup in body role={}",
            request_role.unwrap_or("unknown")
        );
    }

    let body_bytes = hyper::body::to_bytes(body).await.map_err(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read request body",
            host_header,
            origin_header,
            config,
        )
    })?;

    const MAX_BODY_SIZE: usize = 10 * 1024 * 1024;
    if body_bytes.len() > MAX_BODY_SIZE {
        return Err(error_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            &format!(
                "Request body exceeds {} MB limit",
                MAX_BODY_SIZE / 1024 / 1024
            ),
            host_header,
            origin_header,
            config,
        ));
    }

    let model_id = extract_model_id(&body_bytes).map_err(|message| {
        if is_anthropic_messages {
            log::warn!("POST body for /messages rejected: {message}");
        } else {
            log::warn!("POST body for {destination_path} rejected: {message}");
        }
        error_response(
            StatusCode::BAD_REQUEST,
            message,
            host_header,
            origin_header,
            config,
        )
    })?;

    log::debug!(
        "Extracted model_id: {model_id} role={}",
        request_role.unwrap_or("unknown")
    );

    let state = app_handle.state::<AppState>();
    let resolved = {
        let provider_state = state.provider_state.lock().await;
        let provider_configs = &provider_state.configs;
        let provider_model_index = &provider_state.model_index;

        log::debug!(
            "Registered providers: {:?}",
            provider_configs.keys().collect::<Vec<_>>()
        );

        // If the frontend sent an X-Ax-Provider header, try a direct lookup first.
        // This avoids ambiguity when the same model ID is registered under multiple providers.
        if let Some(hint) = provider_hint {
            if let Some(cfg) = provider_configs.get(hint) {
                log::debug!("Using provider hint from X-Ax-Provider header: {hint}");
                if let Some(base_url) = cfg.base_url.as_deref().filter(|u| !u.is_empty()) {
                    Ok(Some(ResolvedProviderConfig {
                        target_base_url: build_upstream_url(
                            base_url,
                            destination_path,
                            is_anthropic_messages,
                        ),
                        session_api_key: cfg.api_key.clone(),
                        provider_custom_headers: cfg.custom_headers.clone(),
                    }))
                } else {
                    // Provider is registered but has no base_url — fall through to
                    // heuristic first (handles prefixed model IDs like "openai/gpt-4"),
                    // then return an actionable error if that also fails.
                    log::debug!(
                        "Provider hint '{hint}' matched but has no base_url, trying heuristic"
                    );
                    let heuristic = resolve_provider_config_from_map(
                        &provider_configs,
                        &provider_model_index,
                        &model_id,
                        destination_path,
                        is_anthropic_messages,
                    );
                    match &heuristic {
                        Ok(None) => {
                            log::warn!(
                                "Provider '{hint}' has no Base URL configured and heuristic \
                                 lookup failed for model '{model_id}'. The provider must have \
                                 a Base URL set in Settings → AI Providers."
                            );
                            Err(format!(
                                "Provider '{hint}' has no Base URL configured. \
                                 Set one in Settings → AI Providers → {hint}."
                            ))
                        }
                        _ => heuristic,
                    }
                }
            } else {
                log::debug!("Provider hint '{hint}' not found in registered providers, falling back to heuristic");
                resolve_provider_config_from_map(
                    &provider_configs,
                    &provider_model_index,
                    &model_id,
                    destination_path,
                    is_anthropic_messages,
                )
            }
        } else {
            resolve_provider_config_from_map(
                &provider_configs,
                &provider_model_index,
                &model_id,
                destination_path,
                is_anthropic_messages,
            )
        }
    };

    let resolved = match resolved {
        Ok(Some(config)) => Ok(Some(config)),
        Ok(None) => {
            if let Some(config) = resolve_active_ax_serving_fallback(
                app_handle,
                provider_hint,
                &model_id,
                destination_path,
                is_anthropic_messages,
            )
            .await
            {
                Ok(Some(config))
            } else {
                Ok(None)
            }
        }
        Err(message) => {
            if let Some(config) = resolve_active_ax_serving_fallback(
                app_handle,
                provider_hint,
                &model_id,
                destination_path,
                is_anthropic_messages,
            )
            .await
            {
                Ok(Some(config))
            } else {
                Err(message)
            }
        }
    };

    // Normalize the request body: strip non-standard fields that upstream providers reject.
    let normalized_body = normalize_request_body(&body_bytes, !is_anthropic_messages);

    match resolved {
        Ok(Some(resolved)) => Ok(ProviderResolution {
            target_base_url: resolved.target_base_url,
            session_api_key: resolved.session_api_key,
            provider_custom_headers: resolved.provider_custom_headers,
            is_anthropic_messages,
            buffered_body: normalized_body,
        }),
        Ok(None) => {
            log::warn!("No remote provider configured for model_id: {model_id}");
            Err(error_response(
                StatusCode::NOT_FOUND,
                format!("No remote provider configured for model '{model_id}'"),
                host_header,
                origin_header,
                config,
            ))
        }
        Err(message) => {
            log::warn!("Ambiguous provider resolution for model_id {model_id}: {message}");
            Err(error_response(
                StatusCode::CONFLICT,
                message,
                host_header,
                origin_header,
                config,
            ))
        }
    }
}

/// Attempt to re-send a failed Anthropic /messages request as /chat/completions.
/// Returns `Some(Response)` if the fallback was attempted (success or error),
/// or `None` if the body couldn't be transformed.
async fn try_anthropic_fallback(
    target_base_url: &str,
    headers: &hyper::HeaderMap,
    session_api_key: &Option<String>,
    buffered_body: &Bytes,
    destination_path: &str,
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
    client: &Client,
) -> Option<Result<Response<Body>, hyper::Error>> {
    let fallback_url = strip_provider_endpoint_suffix(&target_base_url).to_string();

    let json_body = match serde_json::from_slice::<serde_json::Value>(buffered_body) {
        Ok(v) => v,
        Err(_) => return None,
    };
    let openai_body = match transform_anthropic_to_openai(&json_body) {
        Some(t) => t,
        None => {
            log::error!("transform_anthropic_to_openai returned None for body: {json_body}");
            return None;
        }
    };

    let chat_url = format!("{}/chat/completions", fallback_url);
    log::info!("Fallback to chat completions: {chat_url}");

    let mut fallback_req = client.post(&chat_url);
    fallback_req = fallback_req.header("Content-Type", "application/json");
    fallback_req = fallback_req.header("Accept-Encoding", "identity");

    for (name, value) in headers.iter() {
        if !should_skip_anthropic_fallback_header(name) {
            fallback_req = fallback_req.header(name, value);
        }
    }
    if let Some(key) = session_api_key {
        fallback_req = fallback_req.header("Authorization", format!("Bearer {key}"));
    }

    let fallback_response = fallback_req.body(openai_body.to_string()).send().await;

    match fallback_response {
        Ok(res) => {
            let fallback_status = res.status();

            if !fallback_status.is_success() {
                let fallback_error = res
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("Failed to read error: {}", e));
                return Some(Ok(error_response(
                    fallback_status,
                    fallback_error,
                    host_header,
                    origin_header,
                    config,
                )));
            }

            let mut builder = Response::builder().status(fallback_status);
            for (name, value) in res.headers() {
                if !is_cors_header(name.as_str()) && name != hyper::header::CONTENT_LENGTH {
                    builder = builder.header(name, value);
                }
            }
            builder = add_cors_headers_with_host_and_origin(
                builder,
                host_header,
                origin_header,
                &config.trusted_hosts,
                config.cors_enabled,
            );

            let is_streaming = openai_body
                .get("stream")
                .and_then(|s| s.as_bool())
                .unwrap_or(false);

            let (sender, body) = hyper::Body::channel();
            let dest_path = destination_path.to_string();

            tokio::spawn(async move {
                if is_streaming {
                    let stream = res.bytes_stream();
                    transform_and_forward_stream(stream, sender, &dest_path).await;
                } else {
                    let response_body = res.bytes().await;
                    forward_non_streaming(response_body, sender, &dest_path).await;
                }
            });

            Some(Ok(builder.body(body).unwrap_or_else(|_| {
                Response::new(Body::from("Internal server error"))
            })))
        }
        Err(ref err) => {
            log::error!("Chat completions fallback failed: {}", err);
            None
        }
    }
}

/// Build a streaming response from a successful upstream response.
/// Spawns a background task that forwards chunks, applying SSE line-patching
/// for `text/event-stream` responses (e.g. removing private reasoning fields).
/// (stream_id, Arc clone of active_streams) — passed so the spawn can remove the
/// entry when streaming completes, preventing a slow leak of dead senders.
type StreamsCleanup = Option<(
    String,
    std::sync::Arc<
        tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    >,
)>;

fn build_streaming_response(
    response: reqwest::Response,
    status: StatusCode,
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
    upstream_url: &str,
    abort_rx: Option<tokio::sync::oneshot::Receiver<()>>,
    streams_cleanup: StreamsCleanup,
) -> Response<Body> {
    let mut builder = Response::builder().status(status);

    for (name, value) in response.headers() {
        if !is_cors_header(name.as_str()) && name != hyper::header::CONTENT_LENGTH {
            builder = builder.header(name, value);
        }
    }

    builder = add_cors_headers_with_host_and_origin(
        builder,
        host_header,
        origin_header,
        &config.trusted_hosts,
        config.cors_enabled,
    );

    let upstream_ct = response
        .headers()
        .get(hyper::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<unknown>")
        .to_string();
    log::info!(
        "Upstream response: status={} content-type={}",
        response.status(),
        upstream_ct
    );

    let mut stream = response.bytes_stream();
    let (mut sender, body) = hyper::Body::channel();
    let upstream_url_for_log = upstream_url.to_string();

    tokio::spawn(async move {
        let is_sse = upstream_ct.contains("text/event-stream");
        let mut total_bytes: usize = 0;
        let mut chunk_count: usize = 0;
        let mut patched_lines_logged: usize = 0;
        let mut line_buffer = String::new();
        // Per-stream patcher state: tracks whether we're inside a reasoning
        // block (so we know when to emit </think>) and whether we're inside
        // a DeepSeek tool-call body (so we can buffer until the end marker).
        let mut patcher = SseStreamPatcher::new();

        let mut abort_rx = abort_rx;
        loop {
            let maybe_chunk = if let Some(ref mut rx) = abort_rx {
                tokio::select! {
                    biased;
                    _ = rx => {
                        log::debug!("Stream aborted via abort_remote_stream");
                        break;
                    }
                    chunk = stream.next() => chunk,
                }
            } else {
                stream.next().await
            };
            let chunk_result = match maybe_chunk {
                Some(r) => r,
                None => break,
            };
            match chunk_result {
                Ok(chunk) => {
                    chunk_count += 1;
                    total_bytes += chunk.len();

                    if !is_sse {
                        if sender.send_data(chunk).await.is_err() {
                            log::debug!("Client disconnected during streaming");
                            break;
                        }
                        continue;
                    }

                    let s = match std::str::from_utf8(&chunk) {
                        Ok(v) => v,
                        Err(_) => {
                            if sender.send_data(chunk).await.is_err() {
                                break;
                            }
                            continue;
                        }
                    };
                    line_buffer.push_str(s);

                    if line_buffer.len() > MAX_SSE_LINE_BUFFER {
                        log::error!(
                            "SSE line buffer exceeded {} bytes, aborting stream",
                            MAX_SSE_LINE_BUFFER
                        );
                        break;
                    }

                    let mut out = String::with_capacity(line_buffer.len());
                    while let Some(newline_idx) = line_buffer.find('\n') {
                        let line: String = line_buffer.drain(..=newline_idx).collect();
                        let patched = patcher.patch_line(&line);
                        if patched_lines_logged < 3
                            && patched != line
                            && patched.trim_start().starts_with("data:")
                        {
                            patched_lines_logged += 1;
                            let preview_len = patched.len().min(400);
                            log::info!(
                                "Patched SSE line #{patched_lines_logged}: {}",
                                &patched[..preview_len]
                            );
                        }
                        out.push_str(&patched);
                    }
                    if !out.is_empty() {
                        if sender
                            .send_data(hyper::body::Bytes::from(out))
                            .await
                            .is_err()
                        {
                            log::debug!("Client disconnected during streaming");
                            break;
                        }
                    }
                }
                Err(e) => {
                    log::error!("Stream error: {e}");
                    break;
                }
            }
        }

        if !line_buffer.is_empty() {
            let tail = patcher.patch_line(&line_buffer);
            let _ = sender.send_data(hyper::body::Bytes::from(tail)).await;
        }

        if total_bytes == 0 {
            log::warn!(
                "Streaming complete with EMPTY body — 0 bytes / 0 chunks from {upstream_url_for_log}. \
                 Likely an upstream error returned with a 2xx status; check the network response in the client."
            );
        } else {
            log::info!(
                "Streaming complete to client: {chunk_count} chunks, {total_bytes} bytes from {upstream_url_for_log}"
            );
        }

        // Remove the abort-channel entry now that the stream is done so the
        // sender does not linger in active_streams after the receiver is gone.
        if let Some((sid, arc)) = streams_cleanup {
            arc.lock().await.remove(&sid);
        }
    });

    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Body::from("Internal server error")))
}

/// Per-request SSRF guard: re-resolves the upstream URL host and rejects private IPs.
/// This defends against DNS rebinding attacks where a domain validated at registration
/// time later resolves to an internal address.
async fn check_upstream_not_ssrf(url: &str) -> Result<(), String> {
    let parsed = match url::Url::parse(url) {
        Ok(u) => u,
        Err(_) => return Ok(()),
    };
    let port = parsed.port_or_known_default().unwrap_or(80);
    match parsed.host() {
        Some(url::Host::Ipv4(ip)) => {
            let addr = std::net::IpAddr::V4(ip);
            if !addr.is_loopback() && is_private_ip(addr) {
                return Err(format!(
                    "Upstream URL points to a private address ({ip}); request blocked"
                ));
            }
        }
        Some(url::Host::Ipv6(ip)) => {
            let addr = std::net::IpAddr::V6(ip);
            if !addr.is_loopback() && is_private_ip(addr) {
                return Err(format!(
                    "Upstream URL points to a private address ({ip}); request blocked"
                ));
            }
        }
        Some(url::Host::Domain(domain)) => {
            if domain == "localhost" {
                return Ok(());
            }
            let addrs = tokio::net::lookup_host((domain, port))
                .await
                .map_err(|e| format!("Failed to resolve upstream host '{domain}': {e}"))?;
            for addr in addrs {
                let ip = addr.ip();
                if !ip.is_loopback() && is_private_ip(ip) {
                    return Err("Upstream URL resolves to an internal or private address; \
                         request blocked (possible DNS rebinding)"
                        .to_string());
                }
            }
        }
        None => {}
    }
    Ok(())
}

/// Send the buffered request to the upstream provider and return the response.
/// Handles the Anthropic /messages → /chat/completions fallback on error.
pub(super) async fn dispatch_to_upstream<R: tauri::Runtime>(
    resolution: ProviderResolution,
    destination_path: &str,
    headers: &hyper::HeaderMap,
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
    client: &Client,
    app_handle: &tauri::AppHandle<R>,
) -> Result<Response<Body>, hyper::Error> {
    let upstream_url = resolution.target_base_url.clone();
    let is_anthropic_messages = resolution.is_anthropic_messages;
    let session_api_key = resolution.session_api_key;
    let buffered_body = resolution.buffered_body;
    let provider_custom_headers = resolution.provider_custom_headers;
    let target_base_url = upstream_url.clone();

    log::info!(
        "Proxying request to model server at base URL {upstream_url}, path: {destination_path}"
    );

    // For Anthropic /messages, we need to track if we should transform the response
    let destination_path = destination_path.to_string();
    let mut model_load_attempts = 0;

    // If the client sends X-Ax-Stream-Id, wire up an abort channel so
    // abort_remote_stream() can terminate the upstream connection.
    let stream_id = headers
        .get("x-ax-stream-id")
        .and_then(|v| v.to_str().ok())
        .map(ToOwned::to_owned);
    let mut abort_rx: Option<tokio::sync::oneshot::Receiver<()>> = if let Some(ref sid) = stream_id
    {
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let state = app_handle.state::<crate::core::state::AppState>();
        let mut streams = state.active_streams.lock().await;
        streams.insert(sid.clone(), tx);
        Some(rx)
    } else {
        None
    };

    if let Err(e) = check_upstream_not_ssrf(&upstream_url).await {
        log::warn!("Per-request SSRF check blocked upstream: {e}");
        if let Some(ref sid) = stream_id {
            let state = app_handle.state::<crate::core::state::AppState>();
            state.active_streams.lock().await.remove(sid);
        }
        return Ok(error_response(
            StatusCode::FORBIDDEN,
            e,
            host_header,
            origin_header,
            config,
        ));
    }

    loop {
        let mut outbound_req = client.post(upstream_url.clone());

        for (name, value) in headers.iter() {
            // Strip auth headers — the proxy injects the real provider key below.
            // Also strip x-api-key so client dummy keys never reach the upstream API.
            // Strip x-ax-* headers — internal routing/trace headers, not for upstream providers.
            // Strip Content-Length — the body may have been modified by normalize_request_body
            // (e.g., reasoning fields stripped), so reqwest must recalculate it from the actual body.
            if !should_skip_upstream_request_header(name) {
                outbound_req = outbound_req.header(name, value);
            }
        }

        if let Some(key) = session_api_key.clone() {
            // Authorization Bearer covers OpenAI, Gemini, Groq, and most others.
            outbound_req = outbound_req.header("Authorization", format!("Bearer {key}"));
            // x-api-key is Anthropic's native auth header; sending it to other providers
            // can expose credentials in unexpected ways.
            if is_anthropic_messages {
                outbound_req = outbound_req.header("x-api-key", key.clone());
            }
        } else {
            log::debug!("No session API key available for this request");
        }

        // Apply provider-specific custom headers from provider_configs
        // (e.g., anthropic-version: 2023-06-01 for Anthropic's OpenAI-compatible endpoint)
        // Skip reserved headers that could override auth or routing set above.
        for ch in &provider_custom_headers {
            let h = ch.header.to_ascii_lowercase();
            if is_reserved_upstream_custom_header(&h) {
                log::debug!("Skipping reserved custom header '{}'", ch.header);
                continue;
            }
            if ch.value.chars().any(|c| matches!(c, '\0' | '\r' | '\n')) {
                log::debug!("Skipping unsafe custom header value for '{}'", ch.header);
                continue;
            }
            let Ok(header_name) = reqwest::header::HeaderName::from_bytes(ch.header.as_bytes())
            else {
                log::debug!("Skipping invalid custom header name '{}'", ch.header);
                continue;
            };
            let Ok(header_value) = reqwest::header::HeaderValue::from_str(ch.value.as_str()) else {
                log::debug!("Skipping invalid custom header value for '{}'", ch.header);
                continue;
            };
            outbound_req = outbound_req.header(header_name, header_value);
        }

        let outbound_req_with_body = outbound_req.body(buffered_body.clone());

        match outbound_req_with_body.send().await {
            Ok(response) => {
                let status = response.status();

                if !status.is_success() {
                    let error_body = response
                        .text()
                        .await
                        .unwrap_or_else(|e| format!("Failed to read error body: {}", e));

                    if is_transient_model_loading_error(status, &destination_path, &error_body)
                        && model_load_attempts < MODEL_LOAD_RETRY_ATTEMPTS
                    {
                        model_load_attempts += 1;
                        log::info!(
                            "Upstream model is still loading for {destination_path}; retrying {model_load_attempts}/{MODEL_LOAD_RETRY_ATTEMPTS}"
                        );
                        tokio::time::sleep(MODEL_LOAD_RETRY_DELAY).await;
                        continue;
                    }

                    // For Anthropic /messages requests with errors, try /chat/completions
                    if is_anthropic_messages {
                        log::warn!("Request failed for /messages with status {status}, trying /chat/completions...");

                        if let Some(result) = try_anthropic_fallback(
                            &target_base_url,
                            headers,
                            &session_api_key,
                            &buffered_body,
                            &destination_path,
                            host_header,
                            origin_header,
                            config,
                            client,
                        )
                        .await
                        {
                            if let Some(ref sid) = stream_id {
                                app_handle
                                    .state::<crate::core::state::AppState>()
                                    .active_streams
                                    .lock()
                                    .await
                                    .remove(sid);
                            }
                            return result;
                        }

                        if let Some(ref sid) = stream_id {
                            app_handle
                                .state::<crate::core::state::AppState>()
                                .active_streams
                                .lock()
                                .await
                                .remove(sid);
                        }
                        return Ok(error_response(
                            status,
                            error_body,
                            host_header,
                            origin_header,
                            config,
                        ));
                    }

                    // Non-/messages error - return error response with body
                    log::error!(
                        "Upstream provider returned {status} for {destination_path}: {}",
                        &error_body[..error_body.len().min(500)]
                    );

                    if let Some(ref sid) = stream_id {
                        app_handle
                            .state::<crate::core::state::AppState>()
                            .active_streams
                            .lock()
                            .await
                            .remove(sid);
                    }
                    return Ok(error_response(
                        status,
                        error_body,
                        host_header,
                        origin_header,
                        config,
                    ));
                }

                // Success case - stream the response
                let streams_cleanup = stream_id.clone().map(|sid| {
                    let state = app_handle.state::<crate::core::state::AppState>();
                    (sid, state.active_streams.clone())
                });
                return Ok(build_streaming_response(
                    response,
                    status,
                    host_header,
                    origin_header,
                    config,
                    &upstream_url,
                    abort_rx.take(),
                    streams_cleanup,
                ));
            }
            Err(e) => {
                let error_msg = format!("Proxy request to model failed: {e}");
                log::error!("{error_msg}");
                // Clean up any unclaimed stream abort handle on network failure.
                if let Some(ref sid) = stream_id {
                    let state = app_handle.state::<crate::core::state::AppState>();
                    let mut streams = state.active_streams.lock().await;
                    streams.remove(sid);
                }
                return Ok(error_response(
                    StatusCode::BAD_GATEWAY,
                    error_msg,
                    host_header,
                    origin_header,
                    config,
                ));
            }
        }
    }
}

// DeepSeek-R1 (and other models using the same chat template) emit tool calls
// as text using these special tokens. Each `｜` is U+FF5C FULLWIDTH VERTICAL LINE.
const DS_TOOL_CALLS_BEGIN: &str = "<\u{ff5c}tool calls begin\u{ff5c}>";
const DS_TOOL_CALLS_END: &str = "<\u{ff5c}tool calls end\u{ff5c}>";
const DS_TOOL_CALL_BEGIN: &str = "<\u{ff5c}tool call begin\u{ff5c}>";
const DS_TOOL_CALL_END: &str = "<\u{ff5c}tool call end\u{ff5c}>";
const DS_TOOL_SEP: &str = "<\u{ff5c}tool sep\u{ff5c}>";

/// Per-stream state for patching SSE lines.
///
/// Responsibilities:
/// 1. Wrap `reasoning_content` / `reasoning` deltas in `<think>...</think>` so
///    the frontend's existing reasoning extractor can render them in a
///    collapsible block instead of leaking raw chain-of-thought as visible text.
/// 2. Detect DeepSeek-style tool calls emitted as text (using fullwidth
///    `<｜tool calls begin｜>...<｜tool calls end｜>` markers), parse them, and
///    emit them as proper OpenAI-format `tool_calls` deltas that the Vercel AI
///    SDK can dispatch.
///
/// Lines that don't match either pattern pass through unchanged.
pub(super) struct SseStreamPatcher {
    /// True while we have emitted a `<think>` opener but not yet a closer.
    reasoning_active: bool,
    /// True while we are between `<｜tool calls begin｜>` and `<｜tool calls end｜>`.
    in_tool_calls: bool,
    /// Buffered tool-call body text (everything between begin and end markers).
    tool_calls_buffer: String,
    /// Index for assigning ids to parsed tool calls within this stream.
    next_tool_call_index: usize,
}

impl SseStreamPatcher {
    pub(super) fn new() -> Self {
        Self {
            reasoning_active: false,
            in_tool_calls: false,
            tool_calls_buffer: String::new(),
            next_tool_call_index: 0,
        }
    }

    /// Patch a single SSE line in-place before forwarding to the client.
    ///
    /// Non-`data:` lines and malformed JSON pass through untouched.
    pub(super) fn patch_line(&mut self, line: &str) -> String {
        // Preserve non-data lines (event:, id:, retry:, blank lines) verbatim.
        let trimmed = line.trim_start();
        if !trimmed.starts_with("data:") {
            return line.to_string();
        }
        let (prefix_ws_len, _) = line
            .char_indices()
            .find(|(_, c)| !c.is_whitespace())
            .unwrap_or((0, ' '));
        let prefix = &line[..prefix_ws_len];

        // Strip "data:" and any whitespace after it, but remember line ending.
        let after_data = &trimmed[5..];
        let (payload_str, trailing_newline) = match after_data.strip_suffix("\r\n") {
            Some(s) => (s.trim_start(), "\r\n"),
            None => match after_data.strip_suffix('\n') {
                Some(s) => (s.trim_start(), "\n"),
                None => (after_data.trim_start(), ""),
            },
        };
        // Sentinel [DONE] passes through unchanged.
        if payload_str == "[DONE]" {
            return line.to_string();
        }
        // Parse JSON; on failure, pass through.
        let mut value: serde_json::Value = match serde_json::from_str(payload_str) {
            Ok(v) => v,
            Err(_) => return line.to_string(),
        };
        let choices = match value.get_mut("choices").and_then(|c| c.as_array_mut()) {
            Some(c) => c,
            None => return line.to_string(),
        };
        let mut changed = false;
        for choice in choices.iter_mut() {
            // First: extract any reasoning text and wrap it in <think> tags so
            // the frontend extractor catches it. This must run before the tool-call
            // logic because reasoning is in a separate field and never contains
            // tool-call markers.
            if self.apply_reasoning_wrap(choice) {
                changed = true;
            }
            // Then: process the `content` field for DeepSeek tool-call markers
            // and convert them to structured `tool_calls`.
            if self.apply_tool_call_parsing(choice) {
                changed = true;
            }
            // If the stream is finishing (finish_reason set) and reasoning is
            // still open, close it so the frontend regex matches the full block.
            if self.reasoning_active
                && choice
                    .get("finish_reason")
                    .map(|v| !v.is_null())
                    .unwrap_or(false)
            {
                let delta = choice.get_mut("delta").and_then(|d| d.as_object_mut());
                if let Some(delta) = delta {
                    let existing = delta
                        .get("content")
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .to_string();
                    let closed = format!("{existing}</think>");
                    delta.insert("content".to_string(), serde_json::Value::String(closed));
                    self.reasoning_active = false;
                    changed = true;
                }
            }
        }
        if !changed {
            return line.to_string();
        }
        let Ok(new_payload) = serde_json::to_string(&value) else {
            return line.to_string();
        };
        format!("{prefix}data: {new_payload}{trailing_newline}")
    }

    /// Convert `reasoning_content` / `reasoning` deltas to inline `<think>` blocks
    /// in the `content` field. Returns true if the delta was modified.
    ///
    /// State machine:
    /// - First reasoning chunk: emit `<think>` + reasoning text, set active=true.
    /// - Subsequent reasoning chunks: emit reasoning text plain (already inside think block).
    /// - First content chunk after reasoning: prepend `</think>` to content, set active=false.
    fn apply_reasoning_wrap(&mut self, choice: &mut serde_json::Value) -> bool {
        let Some(delta) = choice.get_mut("delta").and_then(|d| d.as_object_mut()) else {
            return false;
        };
        let mut changed = false;
        let reasoning_text = delta
            .get("reasoning_content")
            .and_then(|v| v.as_str())
            .or_else(|| delta.get("reasoning").and_then(|v| v.as_str()))
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned);
        let content_text = delta
            .get("content")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned);

        // Always strip the reasoning fields from the outgoing delta.
        if delta.remove("reasoning_content").is_some() {
            changed = true;
        }
        if delta.remove("reasoning").is_some() {
            changed = true;
        }

        match (reasoning_text, content_text) {
            (Some(r), None) => {
                // Reasoning chunk with no visible content.
                let wrapped = if self.reasoning_active {
                    r
                } else {
                    self.reasoning_active = true;
                    format!("<think>{r}")
                };
                delta.insert("content".to_string(), serde_json::Value::String(wrapped));
                changed = true;
            }
            (Some(r), Some(c)) => {
                // Reasoning + content in same delta (unusual but possible).
                // Open think (if needed), then close before the content.
                let opener = if self.reasoning_active {
                    String::new()
                } else {
                    self.reasoning_active = true;
                    "<think>".to_string()
                };
                self.reasoning_active = false;
                let merged = format!("{opener}{r}</think>{c}");
                delta.insert("content".to_string(), serde_json::Value::String(merged));
                changed = true;
            }
            (None, Some(c)) if self.reasoning_active => {
                // Transition from reasoning to visible content — close the block.
                self.reasoning_active = false;
                let closed = format!("</think>{c}");
                delta.insert("content".to_string(), serde_json::Value::String(closed));
                changed = true;
            }
            _ => {}
        }
        changed
    }

    /// Detect DeepSeek-format tool calls in the `content` field and convert them
    /// to OpenAI-format `tool_calls` deltas. Returns true if the delta was
    /// modified.
    ///
    /// Spans multiple deltas: state is held in `self.in_tool_calls` and
    /// `self.tool_calls_buffer`. When the closing marker arrives, the buffer is
    /// parsed and emitted as a single `delta.tool_calls` array.
    fn apply_tool_call_parsing(&mut self, choice: &mut serde_json::Value) -> bool {
        let Some(delta) = choice.get_mut("delta").and_then(|d| d.as_object_mut()) else {
            return false;
        };
        let Some(content) = delta
            .get("content")
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned)
        else {
            return false;
        };
        if content.is_empty() && !self.in_tool_calls {
            return false;
        }

        // Process the content text against the state machine. The remaining
        // visible content is what should stay in delta.content; tool calls (if
        // any) are returned separately.
        let (visible, parsed_calls) = self.process_content_text(&content);

        let mut changed = false;
        if visible != content {
            if visible.is_empty() {
                // Suppress entirely rather than emitting an empty-content delta.
                // Mid-stream chunks of a tool-call body should produce no visible
                // content at all so the AI SDK doesn't misinterpret them as a
                // pause in the assistant's text stream.
                delta.remove("content");
            } else {
                delta.insert("content".to_string(), serde_json::Value::String(visible));
            }
            changed = true;
        }
        if !parsed_calls.is_empty() {
            delta.insert(
                "tool_calls".to_string(),
                serde_json::Value::Array(parsed_calls),
            );
            changed = true;
        }
        changed
    }

    /// Drive the content text through the tool-call state machine.
    /// Returns (visible_content_to_emit, parsed_tool_calls).
    fn process_content_text(&mut self, content: &str) -> (String, Vec<serde_json::Value>) {
        let mut visible = String::new();
        let mut parsed: Vec<serde_json::Value> = Vec::new();
        let mut remaining = content;

        loop {
            if self.in_tool_calls {
                // Look for end marker.
                if let Some(end_idx) = remaining.find(DS_TOOL_CALLS_END) {
                    self.tool_calls_buffer.push_str(&remaining[..end_idx]);
                    let buffered = std::mem::take(&mut self.tool_calls_buffer);
                    let calls =
                        parse_deepseek_tool_call_body(&buffered, &mut self.next_tool_call_index);
                    parsed.extend(calls);
                    self.in_tool_calls = false;
                    remaining = &remaining[end_idx + DS_TOOL_CALLS_END.len()..];
                    continue;
                } else {
                    // No end marker yet; buffer everything and stop.
                    self.tool_calls_buffer.push_str(remaining);
                    break;
                }
            } else {
                // Look for begin marker.
                if let Some(begin_idx) = remaining.find(DS_TOOL_CALLS_BEGIN) {
                    visible.push_str(&remaining[..begin_idx]);
                    self.in_tool_calls = true;
                    remaining = &remaining[begin_idx + DS_TOOL_CALLS_BEGIN.len()..];
                    continue;
                } else {
                    visible.push_str(remaining);
                    break;
                }
            }
        }
        (visible, parsed)
    }
}

/// Parse the body between `<｜tool calls begin｜>` and `<｜tool calls end｜>` into
/// OpenAI-format tool_call objects.
///
/// Each call is structured as:
///   `<｜tool call begin｜>function<｜tool sep｜>{name}\n```json\n{args}\n```\n<｜tool call end｜>`
///
/// The parser is tolerant: missing fences are OK, missing `function` prefix is OK,
/// and unparsable JSON args become a string passthrough so the AI SDK can still
/// surface them rather than dropping the call entirely.
fn parse_deepseek_tool_call_body(body: &str, next_index: &mut usize) -> Vec<serde_json::Value> {
    let mut calls: Vec<serde_json::Value> = Vec::new();
    let mut cursor = body;
    while let Some(begin_pos) = cursor.find(DS_TOOL_CALL_BEGIN) {
        let after_begin = &cursor[begin_pos + DS_TOOL_CALL_BEGIN.len()..];
        let (call_text, rest) = match after_begin.find(DS_TOOL_CALL_END) {
            Some(end_pos) => (
                &after_begin[..end_pos],
                &after_begin[end_pos + DS_TOOL_CALL_END.len()..],
            ),
            // Unterminated — take everything that's left and stop.
            None => (after_begin, ""),
        };

        if let Some(call) = parse_single_deepseek_tool_call(call_text, *next_index) {
            calls.push(call);
            *next_index += 1;
        }

        cursor = rest;
    }
    calls
}

fn parse_single_deepseek_tool_call(text: &str, index: usize) -> Option<serde_json::Value> {
    // Format: "function<｜tool sep｜>{name}\n[optional ```json ...```]\n{args}"
    // Some models omit the "function" prefix; tolerate both.
    let (name_and_args, _has_function_prefix) = match text.find(DS_TOOL_SEP) {
        Some(sep) => (&text[sep + DS_TOOL_SEP.len()..], true),
        None => (text, false),
    };
    let trimmed = name_and_args.trim_start();
    // Name runs up to first newline.
    let (name, after_name) = match trimmed.find('\n') {
        Some(idx) => (trimmed[..idx].trim(), &trimmed[idx + 1..]),
        None => (trimmed.trim(), ""),
    };
    if name.is_empty() {
        return None;
    }
    // Extract args: strip an optional ```json ... ``` fence and trim.
    let args_text = extract_fenced_or_plain(after_name);
    let args_string = if args_text.trim().is_empty() {
        "{}".to_string()
    } else {
        // Try to parse as JSON; if it parses, re-serialize compactly so the
        // arguments field is always a clean JSON string. If it doesn't,
        // pass the raw string through so the AI SDK can attempt downstream.
        match serde_json::from_str::<serde_json::Value>(args_text.trim()) {
            Ok(v) => serde_json::to_string(&v).unwrap_or_else(|_| args_text.trim().to_string()),
            Err(_) => args_text.trim().to_string(),
        }
    };

    Some(serde_json::json!({
        "index": index,
        "id": format!("call_ds_{index}"),
        "type": "function",
        "function": {
            "name": name,
            "arguments": args_string,
        }
    }))
}

/// Pull JSON out of either a fenced code block (```json ... ``` or ``` ... ```)
/// or return the raw text as-is.
fn extract_fenced_or_plain(text: &str) -> &str {
    let trimmed = text.trim_start();
    if let Some(after_fence) = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
    {
        let after = after_fence.trim_start_matches('\n');
        if let Some(end) = after.find("```") {
            return &after[..end];
        }
        return after;
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_provider(provider: &str, base_url: Option<&str>, models: &[&str]) -> ProviderConfig {
        ProviderConfig {
            provider: provider.to_string(),
            api_key: Some("sk-test".to_string()),
            base_url: base_url.map(ToOwned::to_owned),
            custom_headers: vec![ProviderCustomHeader {
                header: "X-Test".to_string(),
                value: "1".to_string(),
            }],
            models: models.iter().map(|model| model.to_string()).collect(),
        }
    }

    #[test]
    fn find_provider_name_matches_explicit_model_membership() {
        let mut providers = HashMap::new();
        providers.insert(
            "openai".to_string(),
            make_provider("openai", Some("https://api.openai.com/v1"), &["gpt-4.1"]),
        );

        assert_eq!(
            find_provider_name(
                &providers,
                &crate::core::state::build_provider_model_index(&providers),
                "gpt-4.1",
            )
            .expect("provider should resolve"),
            Some("openai".to_string())
        );
    }

    #[test]
    fn find_provider_name_prefers_provider_prefix() {
        let mut providers = HashMap::new();
        providers.insert(
            "anthropic".to_string(),
            make_provider("anthropic", Some("https://api.anthropic.com/v1"), &[]),
        );

        assert_eq!(
            find_provider_name(
                &providers,
                &crate::core::state::build_provider_model_index(&providers),
                "anthropic/claude-3-7-sonnet",
            )
            .expect("provider prefix should resolve"),
            Some("anthropic".to_string())
        );
    }

    #[test]
    fn find_provider_name_rejects_ambiguous_plain_model_ids() {
        let mut providers = HashMap::new();
        providers.insert(
            "openai".to_string(),
            make_provider("openai", Some("https://api.openai.com/v1"), &["gpt-4.1"]),
        );
        providers.insert(
            "openrouter".to_string(),
            make_provider(
                "openrouter",
                Some("https://openrouter.ai/api/v1"),
                &["gpt-4.1"],
            ),
        );

        assert_eq!(
            find_provider_name(
                &providers,
                &crate::core::state::build_provider_model_index(&providers),
                "gpt-4.1",
            ),
            Err(
                "Model 'gpt-4.1' is configured for multiple providers. Use 'provider/model' to disambiguate."
                    .to_string()
            )
        );
    }

    #[test]
    fn build_upstream_url_normalizes_known_suffixes() {
        assert_eq!(
            build_upstream_url(
                "https://gateway.example.com/compat/chat/completions",
                "/chat/completions",
                false,
            ),
            "https://gateway.example.com/compat/chat/completions"
        );
        assert_eq!(
            build_upstream_url("https://api.anthropic.com/v1/messages", "/messages", true,),
            "https://api.anthropic.com/v1/messages"
        );
    }

    #[test]
    fn resolve_provider_config_from_map_builds_expected_target() {
        let mut providers = HashMap::new();
        providers.insert(
            "openai".to_string(),
            make_provider(
                "openai",
                Some("https://api.openai.com/v1/chat/completions"),
                &["gpt-4.1"],
            ),
        );

        let resolved = resolve_provider_config_from_map(
            &providers,
            &crate::core::state::build_provider_model_index(&providers),
            "gpt-4.1",
            "/chat/completions",
            false,
        )
        .expect("provider lookup should succeed")
        .expect("provider should resolve");

        assert_eq!(
            resolved.target_base_url,
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(resolved.session_api_key.as_deref(), Some("sk-test"));
        assert_eq!(resolved.provider_custom_headers.len(), 1);
    }

    #[test]
    fn resolve_provider_config_from_map_returns_error_for_ambiguous_model() {
        let mut providers = HashMap::new();
        providers.insert(
            "openai".to_string(),
            make_provider("openai", Some("https://api.openai.com/v1"), &["gpt-4.1"]),
        );
        providers.insert(
            "openrouter".to_string(),
            make_provider(
                "openrouter",
                Some("https://openrouter.ai/api/v1"),
                &["gpt-4.1"],
            ),
        );

        assert!(matches!(
            resolve_provider_config_from_map(
                &providers,
                &crate::core::state::build_provider_model_index(&providers),
                "gpt-4.1",
                "/chat/completions",
                false,
            ),
            Err(message)
                if message
                    == "Model 'gpt-4.1' is configured for multiple providers. Use 'provider/model' to disambiguate."
        ));
    }

    #[test]
    fn extract_model_id_requires_valid_json_and_model_field() {
        assert_eq!(
            extract_model_id(br#"{"model":"gpt-4.1"}"#).expect("valid model"),
            "gpt-4.1"
        );
        assert!(extract_model_id(br#"{"messages":[]}"#).is_err());
        assert!(extract_model_id(br#"not-json"#).is_err());
    }

    #[test]
    fn normalize_request_body_strips_reasoning_from_assistant_messages() {
        let body = Bytes::from(
            r#"{"model":"gpt-4","messages":[
                {"role":"user","content":"hello"},
                {"role":"assistant","content":"hi","reasoning_content":"thinking...","reasoning":"also thinking"},
                {"role":"user","content":"bye"}
            ]}"#,
        );
        let result = normalize_request_body(&body, false);
        let parsed: serde_json::Value = serde_json::from_slice(&result).unwrap();
        let assistant = &parsed["messages"][1];
        assert_eq!(assistant["content"], "hi");
        assert!(assistant.get("reasoning_content").is_none());
        assert!(assistant.get("reasoning").is_none());
    }

    #[test]
    fn normalize_request_body_preserves_user_messages_unchanged() {
        let body = Bytes::from(
            r#"{"model":"gpt-4","messages":[
                {"role":"user","content":"hello","reasoning_content":"not stripped"}
            ]}"#,
        );
        let result = normalize_request_body(&body, false);
        let parsed: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(parsed["messages"][0]["reasoning_content"], "not stripped");
    }

    #[test]
    fn normalize_request_body_returns_original_when_no_reasoning() {
        let body = Bytes::from(r#"{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}"#);
        let result = normalize_request_body(&body, false);
        // No modification needed — should return equivalent JSON
        let original: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let normalized: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(original, normalized);
    }

    #[test]
    fn normalize_request_body_handles_non_json() {
        let body = Bytes::from("not json at all");
        let result = normalize_request_body(&body, false);
        assert_eq!(result, body);
    }

    #[test]
    fn normalize_request_body_handles_no_messages_field() {
        let body = Bytes::from(r#"{"model":"gpt-4","input":"embed this"}"#);
        let result = normalize_request_body(&body, false);
        let original: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let normalized: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(original, normalized);
    }

    #[test]
    fn normalize_request_body_disables_thinking_for_local_knowledge_context() {
        let body = Bytes::from(
            r#"{"model":"Qwen3_5-9B-IQ4_XS","messages":[
                {"role":"user","content":"What real-world hiring outcome did the author achieve?\n\n## Local Knowledge Base (ACTIVE)\nAfter going through this study plan, I got hired as a Software Development Engineer at Amazon."}
            ]}"#,
        );

        let result = normalize_request_body(&body, true);
        let parsed: serde_json::Value = serde_json::from_slice(&result).unwrap();

        assert_eq!(parsed["chat_template_kwargs"]["enable_thinking"], false);
    }

    #[test]
    fn normalize_request_body_does_not_add_chat_template_kwargs_when_not_allowed() {
        let body = Bytes::from(
            r#"{"model":"gpt-4","messages":[
                {"role":"user","content":"Question\n\n## Local Knowledge Base (ACTIVE)\nRetrieved context."}
            ]}"#,
        );

        let result = normalize_request_body(&body, false);
        let parsed: serde_json::Value = serde_json::from_slice(&result).unwrap();

        assert!(parsed.get("chat_template_kwargs").is_none());
    }

    #[test]
    fn transient_model_loading_error_is_retryable_for_chat_completions() {
        assert!(is_transient_model_loading_error(
            StatusCode::NOT_FOUND,
            "/chat/completions",
            r#"{"detail":"model gemma-4-26b-a4b-it-4bit not loaded; loaded=[]"}"#,
        ));
        assert!(is_transient_model_loading_error(
            StatusCode::NOT_FOUND,
            "/chat/completions",
            r#"{"detail":"model Qwen3.6-35B-A3B-4bit not loaded; loaded=['gemma-4-26b-a4b-it-4bit']"}"#,
        ));
    }

    #[test]
    fn transient_model_loading_error_does_not_retry_real_not_found() {
        assert!(!is_transient_model_loading_error(
            StatusCode::NOT_FOUND,
            "/chat/completions",
            r#"{"detail":"provider route not found"}"#,
        ));
        assert!(!is_transient_model_loading_error(
            StatusCode::NOT_FOUND,
            "/models",
            r#"{"detail":"model test not loaded; loaded=[]"}"#,
        ));
    }

    // --- SseStreamPatcher tests ---------------------------------------------
    //
    // Helpers and constants kept local to the test module so they don't appear
    // in the main API surface.

    fn parse_data_line(line: &str) -> serde_json::Value {
        let trimmed = line.trim_end_matches(|c: char| c == '\n' || c == '\r');
        let after = trimmed
            .trim_start()
            .strip_prefix("data:")
            .unwrap()
            .trim_start();
        serde_json::from_str(after).expect("valid JSON after data:")
    }

    fn data_line(content: &str) -> String {
        format!("data: {content}\n")
    }

    fn delta_with(payload: serde_json::Value) -> String {
        let body = serde_json::json!({
            "choices": [{ "delta": payload }]
        });
        data_line(&body.to_string())
    }

    #[test]
    fn patcher_non_data_lines_pass_through() {
        let mut p = SseStreamPatcher::new();
        assert_eq!(p.patch_line("event: ping\n"), "event: ping\n");
        assert_eq!(p.patch_line(": comment\n"), ": comment\n");
        assert_eq!(p.patch_line("\n"), "\n");
    }

    #[test]
    fn patcher_done_sentinel_passes_through() {
        let mut p = SseStreamPatcher::new();
        assert_eq!(p.patch_line("data: [DONE]\n"), "data: [DONE]\n");
    }

    #[test]
    fn patcher_plain_content_unchanged() {
        let mut p = SseStreamPatcher::new();
        let line = delta_with(serde_json::json!({ "content": "Hello world" }));
        assert_eq!(p.patch_line(&line), line);
    }

    #[test]
    fn patcher_wraps_reasoning_content_in_think_tags() {
        let mut p = SseStreamPatcher::new();
        // Chunk 1: reasoning only
        let line1 = delta_with(serde_json::json!({ "reasoning_content": "Let me think." }));
        let patched1 = p.patch_line(&line1);
        let parsed1 = parse_data_line(&patched1);
        assert_eq!(
            parsed1["choices"][0]["delta"]["content"],
            "<think>Let me think."
        );
        assert!(parsed1["choices"][0]["delta"]
            .get("reasoning_content")
            .is_none());

        // Chunk 2: more reasoning (no opener)
        let line2 = delta_with(serde_json::json!({ "reasoning_content": " More thinking." }));
        let patched2 = p.patch_line(&line2);
        let parsed2 = parse_data_line(&patched2);
        assert_eq!(parsed2["choices"][0]["delta"]["content"], " More thinking.");

        // Chunk 3: real content — should prepend </think>
        let line3 = delta_with(serde_json::json!({ "content": "Hello!" }));
        let patched3 = p.patch_line(&line3);
        let parsed3 = parse_data_line(&patched3);
        assert_eq!(parsed3["choices"][0]["delta"]["content"], "</think>Hello!");

        // Chunk 4: more content — no extra closer.
        let line4 = delta_with(serde_json::json!({ "content": " More text." }));
        let patched4 = p.patch_line(&line4);
        let parsed4 = parse_data_line(&patched4);
        assert_eq!(parsed4["choices"][0]["delta"]["content"], " More text.");
    }

    #[test]
    fn patcher_closes_reasoning_on_finish_reason() {
        let mut p = SseStreamPatcher::new();
        let r = delta_with(serde_json::json!({ "reasoning_content": "alone" }));
        p.patch_line(&r);

        let finish = data_line(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
        let patched = p.patch_line(&finish);
        let parsed = parse_data_line(&patched);
        assert_eq!(parsed["choices"][0]["delta"]["content"], "</think>");
        assert_eq!(parsed["choices"][0]["finish_reason"], "stop");
    }

    #[test]
    fn patcher_strips_reasoning_field_alias() {
        // Some providers use `reasoning` instead of `reasoning_content`.
        let mut p = SseStreamPatcher::new();
        let line = delta_with(serde_json::json!({ "reasoning": "alt field" }));
        let patched = p.patch_line(&line);
        let parsed = parse_data_line(&patched);
        assert_eq!(parsed["choices"][0]["delta"]["content"], "<think>alt field");
        assert!(parsed["choices"][0]["delta"].get("reasoning").is_none());
    }

    #[test]
    fn patcher_detects_deepseek_tool_call_in_single_delta() {
        let mut p = SseStreamPatcher::new();
        let body = format!(
            "Some prefix {begin}{call_begin}function{sep}web_search\n```json\n{{\"q\":\"hello\"}}\n```{call_end}{end} Some suffix",
            begin = DS_TOOL_CALLS_BEGIN,
            call_begin = DS_TOOL_CALL_BEGIN,
            sep = DS_TOOL_SEP,
            call_end = DS_TOOL_CALL_END,
            end = DS_TOOL_CALLS_END,
        );
        let line = delta_with(serde_json::json!({ "content": body }));
        let patched = p.patch_line(&line);
        let parsed = parse_data_line(&patched);
        let delta = &parsed["choices"][0]["delta"];
        // Visible content preserves the prefix and suffix, drops the tool-call block.
        assert_eq!(delta["content"], "Some prefix  Some suffix");
        // tool_calls populated with structured function.
        let calls = delta["tool_calls"].as_array().expect("tool_calls array");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["type"], "function");
        assert_eq!(calls[0]["function"]["name"], "web_search");
        let args: serde_json::Value =
            serde_json::from_str(calls[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["q"], "hello");
        assert!(calls[0]["id"].as_str().unwrap().starts_with("call_ds_"));
    }

    #[test]
    fn patcher_handles_deepseek_tool_call_across_chunks() {
        let mut p = SseStreamPatcher::new();
        // Begin in chunk 1
        let l1 = delta_with(serde_json::json!({
            "content": format!("Thinking. {}", DS_TOOL_CALLS_BEGIN)
        }));
        let p1 = parse_data_line(&p.patch_line(&l1));
        assert_eq!(p1["choices"][0]["delta"]["content"], "Thinking. ");
        assert!(p1["choices"][0]["delta"].get("tool_calls").is_none());

        // Body in chunk 2 (function name + args)
        let l2 = delta_with(serde_json::json!({
            "content": format!(
                "{}function{}fabric_search\n",
                DS_TOOL_CALL_BEGIN, DS_TOOL_SEP
            )
        }));
        let p2 = parse_data_line(&p.patch_line(&l2));
        // Content should be empty (suppressed) and no tool_calls yet.
        assert_eq!(p2["choices"][0]["delta"].get("content"), None);
        assert!(p2["choices"][0]["delta"].get("tool_calls").is_none());

        // Body in chunk 3 (more args)
        let l3 = delta_with(serde_json::json!({
            "content": "```json\n{\"query\":\"x\"}\n```"
        }));
        let _ = p.patch_line(&l3);

        // End in chunk 4
        let l4 = delta_with(serde_json::json!({
            "content": format!("{}{} Done.", DS_TOOL_CALL_END, DS_TOOL_CALLS_END)
        }));
        let p4 = parse_data_line(&p.patch_line(&l4));
        assert_eq!(p4["choices"][0]["delta"]["content"], " Done.");
        let calls = p4["choices"][0]["delta"]["tool_calls"]
            .as_array()
            .expect("tool_calls array");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["function"]["name"], "fabric_search");
        let args: serde_json::Value =
            serde_json::from_str(calls[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["query"], "x");
    }

    #[test]
    fn patcher_handles_unfenced_args() {
        // Some local llamacpp builds emit args without ```json fences.
        let mut p = SseStreamPatcher::new();
        let body = format!(
            "{begin}{call_begin}function{sep}list_files\n{{\"path\":\"/\"}}\n{call_end}{end}",
            begin = DS_TOOL_CALLS_BEGIN,
            call_begin = DS_TOOL_CALL_BEGIN,
            sep = DS_TOOL_SEP,
            call_end = DS_TOOL_CALL_END,
            end = DS_TOOL_CALLS_END,
        );
        let line = delta_with(serde_json::json!({ "content": body }));
        let parsed = parse_data_line(&p.patch_line(&line));
        let calls = parsed["choices"][0]["delta"]["tool_calls"]
            .as_array()
            .expect("tool_calls array");
        assert_eq!(calls[0]["function"]["name"], "list_files");
        let args: serde_json::Value =
            serde_json::from_str(calls[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["path"], "/");
    }

    #[test]
    fn patcher_handles_multiple_tool_calls_in_one_block() {
        let mut p = SseStreamPatcher::new();
        let body = format!(
            "{begin}\
             {call_begin}function{sep}a\n{{\"x\":1}}\n{call_end}\
             {call_begin}function{sep}b\n{{\"y\":2}}\n{call_end}\
             {end}",
            begin = DS_TOOL_CALLS_BEGIN,
            call_begin = DS_TOOL_CALL_BEGIN,
            sep = DS_TOOL_SEP,
            call_end = DS_TOOL_CALL_END,
            end = DS_TOOL_CALLS_END,
        );
        let line = delta_with(serde_json::json!({ "content": body }));
        let parsed = parse_data_line(&p.patch_line(&line));
        let calls = parsed["choices"][0]["delta"]["tool_calls"]
            .as_array()
            .expect("tool_calls array");
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["function"]["name"], "a");
        assert_eq!(calls[0]["index"], 0);
        assert_eq!(calls[1]["function"]["name"], "b");
        assert_eq!(calls[1]["index"], 1);
    }

    #[test]
    fn patcher_passes_existing_openai_tool_calls_unchanged() {
        // A delta that already has structured tool_calls should not be perturbed.
        let mut p = SseStreamPatcher::new();
        let line = delta_with(serde_json::json!({
            "tool_calls": [{
                "index": 0,
                "id": "call_xyz",
                "type": "function",
                "function": { "name": "foo", "arguments": "{\"a\":1}" }
            }]
        }));
        assert_eq!(p.patch_line(&line), line);
    }
}
