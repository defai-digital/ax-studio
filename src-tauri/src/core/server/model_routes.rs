//! Model provider routing: resolves provider config from model ID, builds outbound
//! requests, and handles upstream responses including Anthropic /messages fallback.
use ax_studio_utils::is_cors_header;
use futures_util::StreamExt;
use hyper::body::Bytes;
use hyper::{Body, Response, StatusCode};
use reqwest::Client;
use serde_json;
use std::collections::HashMap;
use tauri::Manager;

use super::provider_adapter::{
    forward_non_streaming, transform_and_forward_stream, transform_anthropic_to_openai,
};
use super::proxy::ProxyConfig;
use super::security::add_cors_headers_with_host_and_origin;
use crate::core::state::{AppState, ProviderConfig, ProviderCustomHeader, ProviderModelIndex};

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

/// Strip non-standard fields from the request body that upstream providers may reject.
///
/// Currently removes `reasoning_content` and `reasoning` from assistant messages.
/// These are response-only fields added by the Vercel AI SDK when prior assistant
/// turns contained thinking/reasoning tokens.  They are not part of the OpenAI API
/// spec and providers like Groq reject them with a 400 error.
///
/// Returns the original bytes unchanged if the body is not JSON, has no `messages`
/// array, or no assistant messages carry these fields.
fn normalize_request_body(body_bytes: &Bytes) -> Bytes {
    let mut json_body: serde_json::Value = match serde_json::from_slice(body_bytes) {
        Ok(v) => v,
        Err(_) => return body_bytes.clone(),
    };

    let messages = match json_body.get_mut("messages").and_then(|m| m.as_array_mut()) {
        Some(msgs) => msgs,
        None => return body_bytes.clone(),
    };

    let mut modified = false;
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

    if modified {
        log::debug!("Stripped reasoning_content/reasoning from assistant messages in request body");
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
    let trimmed = base_url
        .trim_end_matches('/')
        .trim_end_matches("/messages")
        .trim_end_matches("/chat/completions")
        .trim_end_matches("/completions")
        .trim_end_matches("/embeddings");

    if is_anthropic_messages {
        format!("{trimmed}/messages")
    } else {
        format!("{trimmed}{destination_path}")
    }
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
) -> Result<ProviderResolution, Response<Body>> {
    let is_anthropic_messages = destination_path == "/messages";
    if is_anthropic_messages {
        log::info!("Handling POST request to /messages with chat/completions fallback on error");
    } else {
        log::info!("Handling POST request to {destination_path} requiring model lookup in body");
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

    log::debug!("Extracted model_id: {model_id}");

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
                if let Some(base_url) =
                    cfg.base_url.as_deref().filter(|u| !u.is_empty())
                {
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
                    log::debug!("Provider hint '{hint}' matched but has no base_url, trying heuristic");
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

    // Normalize the request body: strip non-standard fields that upstream providers reject.
    let normalized_body = normalize_request_body(&body_bytes);

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
    let fallback_url = target_base_url
        .trim_end_matches("/messages")
        .trim_end_matches('/')
        .to_string();

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
        if name != hyper::header::HOST
            && name != hyper::header::AUTHORIZATION
            && name != "content-type"
            && name != hyper::header::CONTENT_LENGTH
            && name != hyper::header::ACCEPT_ENCODING
            && !super::proxy::is_hop_by_hop_header(name)
        {
            fallback_req = fallback_req.header(name, value);
        }
    }
    if let Some(key) = session_api_key {
        fallback_req = fallback_req.header("Authorization", format!("Bearer {key}"));
    }

    let fallback_response = fallback_req
        .body(openai_body.to_string())
        .send()
        .await;

    match fallback_response {
        Ok(res) => {
            let fallback_status = res.status();

            if !fallback_status.is_success() {
                let fallback_error =
                    res.text()
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
                if !is_cors_header(name.as_str())
                    && name != hyper::header::CONTENT_LENGTH
                {
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

            Some(Ok(builder
                .body(body)
                .unwrap_or_else(|_| Response::new(Body::from("Internal server error")))))
        }
        Err(ref err) => {
            log::error!("Chat completions fallback failed: {}", err);
            None
        }
    }
}

/// Build a streaming response from a successful upstream response.
/// Spawns a background task that forwards chunks, applying SSE line-patching
/// for `text/event-stream` responses (e.g. promoting `reasoning_content` to `content`).
fn build_streaming_response(
    response: reqwest::Response,
    status: StatusCode,
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
    upstream_url: &str,
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

        while let Some(chunk_result) = stream.next().await {
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
                            if sender.send_data(chunk).await.is_err() { break }
                            continue;
                        }
                    };
                    line_buffer.push_str(s);

                    let mut out = String::with_capacity(line_buffer.len());
                    while let Some(newline_idx) = line_buffer.find('\n') {
                        let line: String = line_buffer.drain(..=newline_idx).collect();
                        let patched = patch_sse_line(&line);
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
            let tail = patch_sse_line(&line_buffer);
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
    });

    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Body::from("Internal server error")))
}

/// Send the buffered request to the upstream provider and return the response.
/// Handles the Anthropic /messages → /chat/completions fallback on error.
pub(super) async fn dispatch_to_upstream(
    resolution: ProviderResolution,
    destination_path: &str,
    headers: &hyper::HeaderMap,
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
    client: &Client,
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

    let mut outbound_req = client.post(upstream_url.clone());

    for (name, value) in headers.iter() {
        // Strip auth headers — the proxy injects the real provider key below.
        // Also strip x-api-key so client dummy keys never reach the upstream API.
        // Strip x-ax-provider — internal routing header, not for upstream providers.
        // Strip Content-Length — the body may have been modified by normalize_request_body
        // (e.g., reasoning fields stripped), so reqwest must recalculate it from the actual body.
        if name != hyper::header::HOST
            && name != hyper::header::AUTHORIZATION
            && name != hyper::header::CONTENT_LENGTH
            && name.as_str() != "x-api-key"
            && name.as_str() != "x-ax-provider"
            && !super::proxy::is_hop_by_hop_header(name)
        {
            outbound_req = outbound_req.header(name, value);
        }
    }

    let session_api_key_for_req = session_api_key.clone();
    let buffered_body_for_req = buffered_body.clone();

    if let Some(key) = session_api_key_for_req {
        // Add key as both Authorization Bearer (OpenAI / Gemini / Groq / etc.)
        // and x-api-key (Anthropic native format). Providers use whichever they support.
        outbound_req = outbound_req.header("Authorization", format!("Bearer {key}"));
        outbound_req = outbound_req.header("x-api-key", key.clone());
    } else {
        log::debug!("No session API key available for this request");
    }

    // Apply provider-specific custom headers from provider_configs
    // (e.g., anthropic-version: 2023-06-01 for Anthropic's OpenAI-compatible endpoint)
    // Skip reserved headers that could override auth or routing set above.
    for ch in &provider_custom_headers {
        let h = ch.header.to_ascii_lowercase();
        if h == "host" || h == "authorization" || h == "x-api-key" {
            log::debug!("Skipping reserved custom header '{}'", ch.header);
            continue;
        }
        outbound_req = outbound_req.header(ch.header.as_str(), ch.value.as_str());
    }

    let outbound_req_with_body = outbound_req.body(buffered_body_for_req);

    // For Anthropic /messages, we need to track if we should transform the response
    let destination_path = destination_path.to_string();

    match outbound_req_with_body.send().await {
        Ok(response) => {
            let status = response.status();

            let is_error = !status.is_success();

            // For Anthropic /messages requests with errors, try /chat/completions
            if is_error && is_anthropic_messages {
                log::warn!("Request failed for /messages with status {status}, trying /chat/completions...");

                let error_body = response
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("Failed to read error body: {}", e));

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
                ).await {
                    return result;
                }

                return Ok(error_response(status, error_body, host_header, origin_header, config));
            } else if is_error {
                // Non-/messages error - return error response with body
                let error_body = response
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("Failed to read error body: {}", e));

                log::error!(
                    "Upstream provider returned {status} for {destination_path}: {}",
                    &error_body[..error_body.len().min(500)]
                );

                return Ok(error_response(status, error_body, host_header, origin_header, config));
            }

            // Success case - stream the response
            return Ok(build_streaming_response(
                response,
                status,
                host_header,
                origin_header,
                config,
                &upstream_url,
            ));
        }
        Err(e) => {
            let error_msg = format!("Proxy request to model failed: {e}");
            log::error!("{error_msg}");
            Ok(error_response(StatusCode::BAD_GATEWAY, error_msg, host_header, origin_header, config))
        }
    }
}

/// Patch a single SSE line in-place before forwarding to the client.
///
/// Reasoning models exposed over OpenAI-compatible endpoints (e.g.
/// DeepSeek-R1, Cloudflare's `@cf/zai-org/glm-4.7-flash`) only emit their
/// output under non-standard `delta.reasoning` / `delta.reasoning_content`
/// fields. The Vercel AI SDK's OpenAI parser only reads `delta.content`,
/// so without this promotion 100% of the tokens arrive but nothing renders
/// in the chat UI — user sees the "thinking" indicator forever.
///
/// Non-`data:` lines and malformed JSON pass through untouched.
fn patch_sse_line(line: &str) -> String {
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
        let delta = match choice.get_mut("delta").and_then(|d| d.as_object_mut()) {
            Some(d) => d,
            None => continue,
        };
        // Take reasoning_content string if present & non-empty.
        let reasoning = delta
            .get("reasoning_content")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                delta
                    .get("reasoning")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            });
        if let Some(r) = reasoning {
            if !r.is_empty() {
                let existing = delta
                    .get("content")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                delta.insert(
                    "content".to_string(),
                    serde_json::Value::String(format!("{existing}{r}")),
                );
                // Remove reasoning fields so the client's OpenAI parser doesn't
                // double-process them; AI SDK ignores unknown fields but we want
                // the body as clean as possible.
                delta.remove("reasoning_content");
                delta.remove("reasoning");
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
        let result = normalize_request_body(&body);
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
        let result = normalize_request_body(&body);
        let parsed: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(parsed["messages"][0]["reasoning_content"], "not stripped");
    }

    #[test]
    fn normalize_request_body_returns_original_when_no_reasoning() {
        let body = Bytes::from(r#"{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}"#);
        let result = normalize_request_body(&body);
        // No modification needed — should return equivalent JSON
        let original: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let normalized: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(original, normalized);
    }

    #[test]
    fn normalize_request_body_handles_non_json() {
        let body = Bytes::from("not json at all");
        let result = normalize_request_body(&body);
        assert_eq!(result, body);
    }

    #[test]
    fn normalize_request_body_handles_no_messages_field() {
        let body = Bytes::from(r#"{"model":"gpt-4","input":"embed this"}"#);
        let result = normalize_request_body(&body);
        let original: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let normalized: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(original, normalized);
    }
}
