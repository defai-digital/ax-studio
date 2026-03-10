//! Model provider routing: resolves provider config from model ID, builds outbound
//! requests, and handles upstream responses including Anthropic /messages fallback.
use ax_studio_utils::is_cors_header;
use futures_util::StreamExt;
use hyper::body::Bytes;
use hyper::{Body, Response, StatusCode};
use reqwest::Client;
use serde_json;
use tauri::Manager;

use crate::core::state::{AppState, ProviderCustomHeader};
use super::provider_adapter::{
    forward_non_streaming, transform_and_forward_stream, transform_anthropic_to_openai,
};
use super::proxy::ProxyConfig;
use super::security::add_cors_headers_with_host_and_origin;

/// Result of resolving a model route — all data needed to send the upstream request.
pub(super) struct ProviderResolution {
    pub target_base_url: String,
    pub session_api_key: Option<String>,
    pub provider_custom_headers: Vec<ProviderCustomHeader>,
    pub is_anthropic_messages: bool,
    pub buffered_body: Bytes,
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
) -> Result<ProviderResolution, Response<Body>> {
    if destination_path == "/messages" {
        let is_anthropic_messages = true;
        log::info!(
            "Handling POST request to /messages with chat/completions fallback on error",
        );
        let body_bytes = match hyper::body::to_bytes(body).await {
            Ok(bytes) => bytes,
            Err(_) => {
                let mut error_response =
                    Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    host_header,
                    origin_header,
                    &config.trusted_hosts,
                );
                return Err(error_response
                    .body(Body::from("Failed to read request body"))
                    .unwrap());
            }
        };

        // Parse body to get model_id for routing (don't transform yet)
        match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
            Ok(json_body) => {
                if let Some(model_id) = json_body.get("model").and_then(|v| v.as_str()) {
                    let mut target_base_url: Option<String> = None;
                    let mut session_api_key: Option<String> = None;
                    let mut provider_custom_headers: Vec<ProviderCustomHeader> = vec![];
                    let provider_name: Option<String>;

                    // Single lock acquisition: resolve provider and extract all config data at once
                    let state = app_handle.state::<AppState>();
                    {
                        let provider_configs = state.provider_configs.lock().await;

                        let found = provider_configs
                            .iter()
                            .find(|(_, config)| config.models.iter().any(|m| m == model_id))
                            .map(|(_, config)| config.provider.clone())
                            .or_else(|| {
                                if let Some(sep_pos) = model_id.find('/') {
                                    let potential_provider: &str = &model_id[..sep_pos];
                                    if provider_configs.contains_key(potential_provider) {
                                        return Some(potential_provider.to_string());
                                    }
                                }
                                provider_configs.get(model_id).map(|c| c.provider.clone())
                            });

                        if let Some(ref p) = found {
                            log::info!("Using remote provider '{p}' for model '{model_id}'");
                            if let Some(provider_cfg) = provider_configs.get(p.as_str()) {
                                target_base_url = provider_cfg.base_url.clone().map(|url| {
                                    let trimmed = url
                                        .trim_end_matches('/')
                                        .trim_end_matches("/messages")
                                        .trim_end_matches("/chat/completions")
                                        .trim_end_matches("/completions");
                                    format!("{trimmed}/messages")
                                });
                                session_api_key = provider_cfg.api_key.clone();
                                provider_custom_headers = provider_cfg.custom_headers.clone();
                            }
                        }
                        provider_name = found;
                        // lock released here
                    }

                    if provider_name.is_none() {
                        // No remote provider configured for this model
                        log::warn!("No remote provider configured for model_id: {model_id}");
                        let mut error_response =
                            Response::builder().status(StatusCode::NOT_FOUND);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            host_header,
                            origin_header,
                            &config.trusted_hosts,
                        );
                        return Err(error_response
                            .body(Body::from(format!(
                                "No remote provider configured for model '{model_id}'"
                            )))
                            .unwrap());
                    }

                    let upstream_url = match target_base_url {
                        Some(url) => url,
                        None => {
                            log::error!(
                                "Internal API server routing error: target is None after successful lookup"
                            );
                            let mut error_response =
                                Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                            error_response = add_cors_headers_with_host_and_origin(
                                error_response,
                                host_header,
                                origin_header,
                                &config.trusted_hosts,
                            );
                            return Err(error_response
                                .body(Body::from("Internal routing error"))
                                .unwrap());
                        }
                    };

                    return Ok(ProviderResolution {
                        target_base_url: upstream_url,
                        session_api_key,
                        provider_custom_headers,
                        is_anthropic_messages,
                        buffered_body: body_bytes,
                    });
                } else {
                    let error_msg = "Request body must contain a 'model' field";
                    log::warn!("POST body for /messages missing 'model' field");
                    let mut error_response =
                        Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        host_header,
                        origin_header,
                        &config.trusted_hosts,
                    );
                    return Err(error_response.body(Body::from(error_msg)).unwrap());
                }
            }
            Err(e) => {
                log::warn!("Failed to parse POST body for /messages as JSON: {e}");
                let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    host_header,
                    origin_header,
                    &config.trusted_hosts,
                );
                let error_msg = format!("Invalid JSON body: {}", e);
                return Err(error_response.body(Body::from(error_msg)).unwrap());
            }
        }
    } else {
        // /chat/completions, /completions, /embeddings, /messages/count_tokens
        log::info!(
            "Handling POST request to {destination_path} requiring model lookup in body",
        );
        let body_bytes = match hyper::body::to_bytes(body).await {
            Ok(bytes) => bytes,
            Err(_) => {
                let mut error_response =
                    Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    host_header,
                    origin_header,
                    &config.trusted_hosts,
                );
                return Err(error_response
                    .body(Body::from("Failed to read request body"))
                    .unwrap());
            }
        };

        match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
            Ok(json_body) => {
                if let Some(model_id) = json_body.get("model").and_then(|v| v.as_str()) {
                    log::debug!("Extracted model_id: {model_id}");

                    let mut target_base_url: Option<String> = None;
                    let mut session_api_key: Option<String> = None;
                    let mut provider_custom_headers: Vec<ProviderCustomHeader> = vec![];
                    let provider_name: Option<String>;

                    // Single lock acquisition: resolve provider and extract all config at once
                    let state = app_handle.state::<AppState>();
                    {
                        let provider_configs = state.provider_configs.lock().await;

                        log::debug!(
                            "Registered providers: {:?}",
                            provider_configs.keys().collect::<Vec<_>>()
                        );

                        let found = provider_configs
                            .iter()
                            .find(|(_, config)| config.models.iter().any(|m| m == model_id))
                            .map(|(_, config)| config.provider.clone())
                            .or_else(|| {
                                if let Some(sep_pos) = model_id.find('/') {
                                    let potential_provider: &str = &model_id[..sep_pos];
                                    if provider_configs.contains_key(potential_provider) {
                                        return Some(potential_provider.to_string());
                                    }
                                }
                                provider_configs.get(model_id).map(|c| c.provider.clone())
                            });

                        if let Some(ref provider) = found {
                            log::info!(
                                "Found remote provider '{provider}' for model '{model_id}'"
                            );
                            if let Some(provider_cfg) = provider_configs.get(provider.as_str())
                            {
                                if let Some(ref api_url) = provider_cfg.base_url {
                                    // Strip known endpoint suffixes from base_url before
                                    // appending destination_path.  Providers like Cloudflare
                                    // gateway have base_urls that already include the endpoint
                                    // (e.g. ".../compat/chat/completions").  Without stripping,
                                    // the final URL would be doubled.
                                    let trimmed_url = api_url
                                        .trim_end_matches('/')
                                        .trim_end_matches("/chat/completions")
                                        .trim_end_matches("/completions")
                                        .trim_end_matches("/embeddings")
                                        .trim_end_matches("/messages");
                                    target_base_url =
                                        Some(format!("{trimmed_url}{destination_path}"));
                                } else {
                                    target_base_url = None;
                                }
                                session_api_key = provider_cfg.api_key.clone();
                                provider_custom_headers = provider_cfg.custom_headers.clone();
                            } else {
                                log::error!("Provider config not found for '{provider}'");
                            }
                        }
                        provider_name = found;
                        // lock released here
                    }

                    if provider_name.is_none() {
                        // No remote provider configured for this model
                        log::warn!("No remote provider configured for model_id: {model_id}");
                        let mut error_response =
                            Response::builder().status(StatusCode::NOT_FOUND);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            host_header,
                            origin_header,
                            &config.trusted_hosts,
                        );
                        return Err(error_response
                            .body(Body::from(format!(
                                "No remote provider configured for model '{model_id}'"
                            )))
                            .unwrap());
                    }

                    let upstream_url = match target_base_url {
                        Some(url) => url,
                        None => {
                            log::error!(
                                "Internal API server routing error: target is None after successful lookup"
                            );
                            let mut error_response =
                                Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                            error_response = add_cors_headers_with_host_and_origin(
                                error_response,
                                host_header,
                                origin_header,
                                &config.trusted_hosts,
                            );
                            return Err(error_response
                                .body(Body::from("Internal routing error"))
                                .unwrap());
                        }
                    };

                    return Ok(ProviderResolution {
                        target_base_url: upstream_url,
                        session_api_key,
                        provider_custom_headers,
                        is_anthropic_messages: false,
                        buffered_body: body_bytes,
                    });
                } else {
                    let error_msg = "Request body must contain a 'model' field";
                    log::warn!(
                        "POST body for {destination_path} is missing 'model' field or it's not a string"
                    );
                    let mut error_response =
                        Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        host_header,
                        origin_header,
                        &config.trusted_hosts,
                    );
                    return Err(error_response.body(Body::from(error_msg)).unwrap());
                }
            }
            Err(e) => {
                log::warn!("Failed to parse POST body for {destination_path} as JSON: {e}");
                let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    host_header,
                    origin_header,
                    &config.trusted_hosts,
                );
                let error_msg = format!("Invalid JSON body: {}", e);
                return Err(error_response.body(Body::from(error_msg)).unwrap());
            }
        }
    }
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
        if name != hyper::header::HOST
            && name != hyper::header::AUTHORIZATION
            && name.as_str() != "x-api-key"
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
    for ch in &provider_custom_headers {
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

                // Read the error body to return to client if fallback fails
                let error_body = response
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("Failed to read error body: {}", e));

                // Clone what we need for the fallback request
                let fallback_url = Some(target_base_url.clone()).map(|url| {
                    url.trim_end_matches("/messages")
                        .trim_end_matches('/')
                        .to_string()
                });
                let fallback_api_key = session_api_key.clone();
                let fallback_body = Some(buffered_body.clone());

                // Transform body to OpenAI format for fallback
                if let Some((url, openai_body)) = fallback_url.zip(fallback_body).and_then(|(url, body)| {
                    let json_body = serde_json::from_slice::<serde_json::Value>(&body).ok()?;
                    match transform_anthropic_to_openai(&json_body) {
                        Some(transformed) => Some((url, transformed)),
                        None => {
                            log::error!("transform_anthropic_to_openai returned None for body: {json_body}");
                            None
                        }
                    }
                }) {
                    let chat_url = format!("{}/chat/completions", url);
                    log::info!("Fallback to chat completions: {chat_url}");

                    // Create a fresh client for the fallback to avoid connection pool issues
                    let fallback_client = match Client::builder().build() {
                        Ok(c) => c,
                        Err(e) => {
                            log::error!("Failed to create fallback client: {e}");
                            return Ok(Response::builder()
                                .status(StatusCode::INTERNAL_SERVER_ERROR)
                                .body(Body::from(format!("Failed to create fallback client: {e}")))
                                .unwrap());
                        }
                    };

                    let mut fallback_req = fallback_client.post(&chat_url);

                    // Ensure Content-Type is set and prevent compression
                    fallback_req = fallback_req.header("Content-Type", "application/json");
                    fallback_req = fallback_req.header("Accept-Encoding", "identity");

                    for (name, value) in headers.iter() {
                        if name != hyper::header::HOST
                            && name != hyper::header::AUTHORIZATION
                            && name != "content-type"
                            && name != hyper::header::CONTENT_LENGTH
                            && name != hyper::header::ACCEPT_ENCODING
                        {
                            fallback_req = fallback_req.header(name, value);
                        }
                    }
                    if let Some(key) = fallback_api_key {
                        fallback_req = fallback_req.header("Authorization", format!("Bearer {key}"));
                    }

                    let fallback_body_str = openai_body.to_string();

                    let fallback_response = fallback_req.body(fallback_body_str).send().await;

                    if let Ok(res) = fallback_response {
                        let fallback_status = res.status();

                        if !fallback_status.is_success() {
                            // Return fallback error to client
                            let fallback_error = res.text().await.unwrap_or_else(|e| format!("Failed to read error: {}", e));

                            // Return the error to client
                            let mut error_response = Response::builder().status(fallback_status);
                            error_response = add_cors_headers_with_host_and_origin(
                                error_response,
                                host_header,
                                origin_header,
                                &config.trusted_hosts,
                            );
                            return Ok(error_response
                                .body(Body::from(fallback_error))
                                .unwrap());
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
                        );

                        let is_streaming = openai_body
                            .get("stream")
                            .and_then(|s| s.as_bool())
                            .unwrap_or(false);

                        let (sender, body) = hyper::Body::channel();
                        let dest_path = destination_path.clone();

                        tokio::spawn(async move {
                            if is_streaming {
                                let stream = res.bytes_stream();
                                transform_and_forward_stream(stream, sender, &dest_path).await;
                            } else {
                                let response_body = res.bytes().await;
                                forward_non_streaming(
                                    response_body,
                                    sender,
                                    &dest_path,
                                )
                                .await;
                            }
                        });

                        return Ok(builder.body(body).unwrap());
                    } else if let Err(ref err) = fallback_response {
                        log::error!("Chat completions fallback failed: {}", err);
                    }
                }

                // If fallback failed or wasn't attempted, return error to client
                let mut error_response = Response::builder().status(status);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    host_header,
                    origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from(error_body)).unwrap());
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

                let mut error_response = Response::builder().status(status);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    host_header,
                    origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from(error_body)).unwrap());
            }

            // Success case - stream the response
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
            );

            let mut stream = response.bytes_stream();
            let (mut sender, body) = hyper::Body::channel();

            tokio::spawn(async move {
                // Regular passthrough - when /messages succeeds directly,
                // the response is already in the correct format
                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(chunk) => {
                            if sender.send_data(chunk).await.is_err() {
                                log::debug!("Client disconnected during streaming");
                                break;
                            }
                        }
                        Err(e) => {
                            log::error!("Stream error: {e}");
                            break;
                        }
                    }
                }
                log::debug!("Streaming complete to client");
            });

            Ok(builder.body(body).unwrap())
        }
        Err(e) => {
            let error_msg = format!("Proxy request to model failed: {e}");
            log::error!("{error_msg}");
            let mut error_response = Response::builder().status(StatusCode::BAD_GATEWAY);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                host_header,
                origin_header,
                &config.trusted_hosts,
            );
            Ok(error_response.body(Body::from(error_msg)).unwrap())
        }
    }
}
