//! HTTP proxy request handler. Orchestrates CORS, auth, routing, and upstream forwarding.
//!
//! No new feature logic should be added directly here; add route handlers as focused functions
//! and call them from `proxy_request`.
use ax_studio_utils::{is_valid_host, remove_prefix};
use hyper::{Body, Request, Response, StatusCode};
use reqwest::Client;

use super::security::add_cors_headers_with_host_and_origin;
use super::{gateway_routes, model_routes, service_routing};

/// Configuration for the proxy server
#[derive(Clone)]
pub struct ProxyConfig {
    pub prefix: String,
    pub proxy_api_key: String,
    pub trusted_hosts: Vec<Vec<String>>,
    pub cors_enabled: bool,
    pub host: String,
    pub port: u16,
}

/// Determines the final destination path based on the original request path
pub fn get_destination_path(original_path: &str, prefix: &str) -> String {
    remove_prefix(original_path, prefix)
}

/// Handle CORS preflight (OPTIONS) requests.
/// Returns `Some(response)` when handled (caller should return immediately), `None` to continue.
fn handle_cors_preflight(req: &Request<Body>, config: &ProxyConfig) -> Option<Response<Body>> {
    if req.method() != hyper::Method::OPTIONS {
        return None;
    }

    if !config.cors_enabled {
        return Some(
            Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("CORS is disabled"))
                .unwrap(),
        );
    }

    log::debug!(
        "Handling CORS preflight request from {:?} {:?}",
        req.headers().get(hyper::header::HOST),
        req.headers().get(hyper::header::ACCESS_CONTROL_REQUEST_METHOD)
    );

    let host = req
        .headers()
        .get(hyper::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let origin = req
        .headers()
        .get(hyper::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let requested_method = req
        .headers()
        .get("Access-Control-Request-Method")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let allowed_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"];
    let method_allowed = requested_method.is_empty()
        || allowed_methods
            .iter()
            .any(|&method| method.eq_ignore_ascii_case(requested_method));

    if !method_allowed {
        log::warn!("CORS preflight: Method '{requested_method}' not allowed");
        return Some(
            Response::builder()
                .status(StatusCode::METHOD_NOT_ALLOWED)
                .body(Body::from("Method not allowed"))
                .unwrap(),
        );
    }

    let request_path = req.uri().path();
    let whitelisted_paths = ["/", "/openapi.json", "/favicon.ico"];
    let is_whitelisted_path = whitelisted_paths.contains(&request_path);

    let is_trusted = if is_whitelisted_path {
        log::debug!(
            "CORS preflight: Bypassing host check for whitelisted path: {request_path}"
        );
        true
    } else if !host.is_empty() {
        log::debug!(
            "CORS preflight: Host is '{host}', trusted hosts: {:?}",
            &config.trusted_hosts
        );
        is_valid_host(host, &config.trusted_hosts)
    } else {
        log::warn!("CORS preflight: No Host header present");
        false
    };

    if !is_trusted {
        log::warn!("CORS preflight: Host '{host}' not trusted for path '{request_path}'");
        return Some(
            Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("Host not allowed"))
                .unwrap(),
        );
    }

    let requested_headers = req
        .headers()
        .get("Access-Control-Request-Headers")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let allowed_headers = [
        "accept",
        "accept-language",
        "authorization",
        "cache-control",
        "connection",
        "content-type",
        "dnt",
        "host",
        "if-modified-since",
        "keep-alive",
        "origin",
        "user-agent",
        "x-api-key",
        "x-csrf-token",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-requested-with",
        "x-stainless-arch",
        "x-stainless-lang",
        "x-stainless-os",
        "x-stainless-package-version",
        "x-stainless-retry-count",
        "x-stainless-runtime",
        "x-stainless-runtime-version",
        "x-stainless-timeout",
    ];

    let headers_valid = if requested_headers.is_empty() {
        true
    } else {
        requested_headers
            .split(',')
            .map(|h| h.trim())
            .all(|header| {
                allowed_headers
                    .iter()
                    .any(|&allowed| allowed.eq_ignore_ascii_case(header))
            })
    };

    if !headers_valid {
        log::warn!("CORS preflight: Some requested headers not allowed: {requested_headers}");
        return Some(
            Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("Headers not allowed"))
                .unwrap(),
        );
    }

    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header("Access-Control-Allow-Methods", allowed_methods.join(", "))
        .header("Access-Control-Allow-Headers", allowed_headers.join(", "))
        .header("Access-Control-Max-Age", "86400")
        .header(
            "Vary",
            "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
        );

    if !origin.is_empty() {
        response = response
            .header("Access-Control-Allow-Origin", origin)
            .header("Access-Control-Allow-Credentials", "true");
    } else {
        response = response.header("Access-Control-Allow-Origin", "*");
    }

    log::debug!("CORS preflight response: host_trusted={is_trusted}, origin='{origin}'");
    Some(response.body(Body::empty()).unwrap())
}

/// Validate host header, API key, and blocked paths.
/// Returns `Some(response)` on validation failure (caller should return immediately), `None` to continue.
fn validate_request(
    path: &str,
    host_header: &str,
    origin_header: &str,
    headers: &hyper::HeaderMap,
    config: &ProxyConfig,
) -> Option<Response<Body>> {
    let whitelisted_paths = [
        "/",
        "/openapi.json",
        "/favicon.ico",
        "/docs/swagger-ui.css",
        "/docs/swagger-ui-bundle.js",
        "/docs/swagger-ui-standalone-preset.js",
    ];
    let is_whitelisted_path = whitelisted_paths.contains(&path);

    if !is_whitelisted_path {
        if !host_header.is_empty() {
            if !is_valid_host(host_header, &config.trusted_hosts) {
                let mut error_response = Response::builder().status(StatusCode::FORBIDDEN);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    host_header,
                    origin_header,
                    &config.trusted_hosts,
                );
                return Some(
                    error_response
                        .body(Body::from("Invalid host header"))
                        .unwrap(),
                );
            }
        } else {
            let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                host_header,
                origin_header,
                &config.trusted_hosts,
            );
            return Some(
                error_response
                    .body(Body::from("Missing host header"))
                    .unwrap(),
            );
        }
    } else {
        log::debug!("Bypassing host validation for whitelisted path: {path}");
    }

    if !is_whitelisted_path && !config.proxy_api_key.is_empty() {
        let auth_valid = headers
            .get(hyper::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == config.proxy_api_key)
            .unwrap_or(false);

        let api_key_valid = headers
            .get("X-Api-Key")
            .and_then(|v| v.to_str().ok())
            .map(|key| key == config.proxy_api_key)
            .unwrap_or(false);

        if !auth_valid && !api_key_valid {
            let mut error_response = Response::builder().status(StatusCode::UNAUTHORIZED);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                host_header,
                origin_header,
                &config.trusted_hosts,
            );
            return Some(
                error_response
                    .body(Body::from("Invalid or missing authorization token"))
                    .unwrap(),
            );
        }
    } else if is_whitelisted_path {
        log::debug!("Bypassing authorization check for whitelisted path: {path}");
    }

    if path.contains("/configs") {
        let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            host_header,
            origin_header,
            &config.trusted_hosts,
        );
        return Some(error_response.body(Body::from("Not Found")).unwrap());
    }

    None
}

/// Handles the proxy request logic
pub(super) async fn proxy_request<R: tauri::Runtime>(
    req: Request<Body>,
    client: Client,
    config: ProxyConfig,
    app_handle: tauri::AppHandle<R>,
) -> Result<Response<Body>, hyper::Error> {
    // CORS preflight
    if let Some(resp) = handle_cors_preflight(&req, &config) {
        return Ok(resp);
    }

    let (parts, body) = req.into_parts();

    let origin_header = parts
        .headers
        .get(hyper::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let host_header = parts
        .headers
        .get(hyper::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let headers = parts.headers.clone();
    let path = get_destination_path(parts.uri.path(), &config.prefix);
    let method = parts.method.clone();

    // Host / auth / config validation
    if let Some(resp) = validate_request(&path, &host_header, &origin_header, &headers, &config) {
        return Ok(resp);
    }

    let destination_path = path.clone();

    // Backend service routing (/retrieval/*, /agents/*, /vectors/*)
    // Check path before moving body — only forward body to service handler when path matches.
    if destination_path.starts_with("/retrieval/")
        || destination_path.starts_with("/agents/")
        || destination_path.starts_with("/vectors/")
    {
        return service_routing::handle_service_route(
            &destination_path, method.clone(), &headers, body,
            &host_header, &origin_header, &config, &client, &app_handle,
        ).await.unwrap_or_else(|| unreachable!("path check guarantees Some"));
    }

    // Static / meta routes (GET only — no body needed)
    match (method.clone(), destination_path.as_str()) {
        (hyper::Method::GET, "/models") => {
            return Ok(gateway_routes::handle_models_route(
                &host_header, &origin_header, &config, &app_handle,
            ).await);
        }
        (hyper::Method::GET, "/openapi.json") => {
            return Ok(gateway_routes::handle_openapi_route(&config));
        }
        (hyper::Method::GET, "/") => {
            return Ok(gateway_routes::handle_docs_root_route(
                &host_header, &origin_header, &config,
            ));
        }
        (hyper::Method::GET, path) => {
            if let Some(resp) = gateway_routes::handle_static_asset(path) {
                return Ok(resp);
            }
        }
        _ => {}
    }

    // Model provider routing (POST /messages, POST /chat/completions, etc.)
    match (method.clone(), destination_path.as_str()) {
        (hyper::Method::POST, "/messages")
        | (hyper::Method::POST, "/chat/completions")
        | (hyper::Method::POST, "/completions")
        | (hyper::Method::POST, "/embeddings")
        | (hyper::Method::POST, "/messages/count_tokens") => {
            let resolution = match model_routes::resolve_model_route(
                &destination_path, body,
                &host_header, &origin_header, &config, &app_handle,
            ).await {
                Ok(r) => r,
                Err(resp) => return Ok(resp),
            };
            return model_routes::dispatch_to_upstream(
                resolution, &destination_path, &headers,
                &host_header, &origin_header, &config, &client,
            ).await;
        }
        _ => {}
    }

    // Catch-all
    Ok(gateway_routes::handle_unknown_route(
        &destination_path, &method, &host_header, &origin_header, &config,
    ))
}
