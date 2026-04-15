//! HTTP proxy request handler. Orchestrates CORS, auth, routing, and upstream forwarding.
//!
//! No new feature logic should be added directly here; add route handlers as focused functions
//! and call them from `proxy_request`.
use ax_studio_utils::{is_valid_host, remove_prefix};
use hyper::{Body, Request, Response, StatusCode};
use reqwest::Client;
use subtle::ConstantTimeEq;

use super::security::{add_cors_headers_with_host_and_origin, trusted_cors_origin};
use super::{gateway_routes, model_routes};

/// Finalize a response builder into a `Response<Body>`, never panicking.
///
/// `Response::builder().body(...)` can only fail if a previously chained
/// header call left the builder in an invalid state (e.g. a bad header
/// value). The previous code used `.unwrap()` everywhere, which would
/// crash the entire Tauri app on the hot path. This helper degrades
/// gracefully to a 500 fallback response so the server stays alive.
fn finalize_response(
    builder: hyper::http::response::Builder,
    body: Body,
) -> Response<Body> {
    match builder.body(body) {
        Ok(resp) => resp,
        Err(err) => {
            log::error!("Failed to build HTTP response: {err}");
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("Internal proxy error"))
                .unwrap_or_else(|_| Response::new(Body::from("Internal proxy error")))
        }
    }
}

pub(crate) fn is_hop_by_hop_header(name: &hyper::header::HeaderName) -> bool {
    matches!(
        name.as_str().to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

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

    // When CORS is disabled but the server is on loopback, still accept
    // preflight requests.  The Tauri webview uses globalThis.fetch (not the
    // Tauri HTTP plugin) for streaming SSE because the plugin's ReadableStream
    // doesn't support pipeThrough().  Native fetch triggers CORS preflight
    // for the tauri:// origin → localhost:1337 cross-origin request.
    // Blocking it would break chat streaming entirely.
    let is_loopback = matches!(config.host.as_str(), "127.0.0.1" | "localhost" | "::1");
    if !config.cors_enabled && !is_loopback {
        return Some(finalize_response(
            Response::builder().status(StatusCode::FORBIDDEN),
            Body::from("CORS is disabled"),
        ));
    }

    log::debug!(
        "Handling CORS preflight request from {:?} {:?}",
        req.headers().get(hyper::header::HOST),
        req.headers()
            .get(hyper::header::ACCESS_CONTROL_REQUEST_METHOD)
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
        return Some(finalize_response(
            Response::builder().status(StatusCode::METHOD_NOT_ALLOWED),
            Body::from("Method not allowed"),
        ));
    }

    let request_path = req.uri().path();
    let whitelisted_paths = ["/", "/openapi.json", "/favicon.ico"];
    let is_whitelisted_path = whitelisted_paths.contains(&request_path);

    let is_trusted = if is_whitelisted_path {
        log::debug!("CORS preflight: Bypassing host check for whitelisted path: {request_path}");
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
        return Some(finalize_response(
            Response::builder().status(StatusCode::FORBIDDEN),
            Body::from("Host not allowed"),
        ));
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
        "x-ax-provider",
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
        return Some(finalize_response(
            Response::builder().status(StatusCode::FORBIDDEN),
            Body::from("Headers not allowed"),
        ));
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

    if let Some(allow_origin) = trusted_cors_origin(origin, host, &config.trusted_hosts) {
        response = response
            .header("Access-Control-Allow-Origin", allow_origin)
            .header("Access-Control-Allow-Credentials", "true");
    } else if !origin.is_empty() {
        log::warn!("CORS preflight: Origin '{origin}' not allowed");
        return Some(finalize_response(
            Response::builder().status(StatusCode::FORBIDDEN),
            Body::from("Origin not allowed"),
        ));
    }

    log::debug!("CORS preflight response: host_trusted={is_trusted}, origin='{origin}'");
    Some(finalize_response(response, Body::empty()))
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
    // Allow loopback processes (e.g. fabric-ingest MCP server) to call the
    // embeddings endpoint without a Bearer token. The proxy only binds to
    // 127.0.0.1, so no external origin can reach this path.
    // Note: `path` here is the destination path with the /v1 prefix stripped.
    let is_loopback_embeddings = (path == "/embeddings" || path == "/v1/embeddings")
        && matches!(host_header, "127.0.0.1:1337" | "localhost:1337");
    let is_whitelisted_path = whitelisted_paths.contains(&path) || is_loopback_embeddings;

    if !is_whitelisted_path {
        if !host_header.is_empty() {
            if !is_valid_host(host_header, &config.trusted_hosts) {
                let mut error_response = Response::builder().status(StatusCode::FORBIDDEN);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    host_header,
                    origin_header,
                    &config.trusted_hosts,
                    config.cors_enabled,
                );
                return Some(finalize_response(
                    error_response,
                    Body::from("Invalid host header"),
                ));
            }
        } else {
            let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                host_header,
                origin_header,
                &config.trusted_hosts,
                config.cors_enabled,
            );
            return Some(finalize_response(
                error_response,
                Body::from("Missing host header"),
            ));
        }
    } else {
        log::debug!("Bypassing host validation for whitelisted path: {path}");
    }

    if !is_whitelisted_path && !config.proxy_api_key.is_empty() {
        // Use constant-time comparison for token validation to prevent timing attacks
        let auth_valid = headers
            .get(hyper::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| {
                token
                    .as_bytes()
                    .ct_eq(config.proxy_api_key.as_bytes())
                    .into()
            })
            .unwrap_or(false);

        let api_key_valid = headers
            .get("X-Api-Key")
            .and_then(|v| v.to_str().ok())
            .map(|key| key.as_bytes().ct_eq(config.proxy_api_key.as_bytes()).into())
            .unwrap_or(false);

        if !auth_valid && !api_key_valid {
            let mut error_response = Response::builder().status(StatusCode::UNAUTHORIZED);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                host_header,
                origin_header,
                &config.trusted_hosts,
                config.cors_enabled,
            );
            return Some(finalize_response(
                error_response,
                Body::from("Invalid or missing authorization token"),
            ));
        }
    } else if is_whitelisted_path {
        log::debug!("Bypassing authorization check for whitelisted path: {path}");
    } else {
        // proxy_api_key is empty and path is not whitelisted.
        // Bypass the proxy's own token check — this is safe because
        // commands.rs::requires_authentication() only allows the proxy to start
        // with an empty key when the bind host is loopback AND CORS is disabled,
        // so nothing off-machine can reach this branch. The upstream provider
        // key is still injected from provider_configs in dispatch_to_upstream;
        // this only skips the proxy's *own* token check, not provider auth.
        log::debug!(
            "Bypassing authorization check: proxy api key is unset (loopback-only mode), path: {path}"
        );
    }

    if path == "/configs" || path.starts_with("/configs/") || path.starts_with("/configs?") {
        let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            host_header,
            origin_header,
            &config.trusted_hosts,
            config.cors_enabled,
        );
        return Some(finalize_response(error_response, Body::from("Not Found")));
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

    // Static / meta routes (GET only — no body needed)
    match (method.clone(), destination_path.as_str()) {
        (hyper::Method::GET, "/models") => {
            return Ok(gateway_routes::handle_models_route(
                &host_header,
                &origin_header,
                &config,
                &app_handle,
            )
            .await);
        }
        (hyper::Method::GET, "/openapi.json") => {
            return Ok(gateway_routes::handle_openapi_route(&config));
        }
        (hyper::Method::GET, "/") => {
            return Ok(gateway_routes::handle_docs_root_route(
                &host_header,
                &origin_header,
                &config,
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
            let provider_hint = headers.get("x-ax-provider").and_then(|v| v.to_str().ok());
            let resolution = match model_routes::resolve_model_route(
                &destination_path,
                body,
                &host_header,
                &origin_header,
                &config,
                &app_handle,
                provider_hint,
            )
            .await
            {
                Ok(r) => r,
                Err(resp) => return Ok(resp),
            };
            return model_routes::dispatch_to_upstream(
                resolution,
                &destination_path,
                &headers,
                &host_header,
                &origin_header,
                &config,
                &client,
            )
            .await;
        }
        _ => {}
    }

    // Catch-all
    Ok(gateway_routes::handle_unknown_route(
        &destination_path,
        &method,
        &host_header,
        &origin_header,
        &config,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(cors_enabled: bool, api_key: &str) -> ProxyConfig {
        ProxyConfig {
            prefix: "/v1".to_string(),
            proxy_api_key: api_key.to_string(),
            trusted_hosts: vec![vec!["localhost".to_string(), "1337".to_string()]],
            cors_enabled,
            host: "localhost".to_string(),
            port: 1337,
        }
    }

    // --- handle_cors_preflight tests ---

    #[test]
    fn test_cors_preflight_non_options_returns_none() {
        let req = Request::builder()
            .method(hyper::Method::GET)
            .uri("/test")
            .body(Body::empty())
            .unwrap();
        let config = test_config(true, "");
        assert!(handle_cors_preflight(&req, &config).is_none());
    }

    #[test]
    fn test_cors_preflight_options_cors_disabled_returns_forbidden() {
        let req = Request::builder()
            .method(hyper::Method::OPTIONS)
            .uri("/test")
            .body(Body::empty())
            .unwrap();
        let config = test_config(false, "");
        let resp = handle_cors_preflight(&req, &config).unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_cors_preflight_whitelisted_path_succeeds() {
        let req = Request::builder()
            .method(hyper::Method::OPTIONS)
            .uri("/")
            .header(hyper::header::HOST, "localhost:1337")
            .body(Body::empty())
            .unwrap();
        let config = test_config(true, "");
        let resp = handle_cors_preflight(&req, &config).unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[test]
    fn test_cors_preflight_untrusted_host_returns_forbidden() {
        let req = Request::builder()
            .method(hyper::Method::OPTIONS)
            .uri("/v1/messages")
            .header(hyper::header::HOST, "evil.com")
            .body(Body::empty())
            .unwrap();
        let config = test_config(true, "");
        let resp = handle_cors_preflight(&req, &config).unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_cors_preflight_disallowed_method_returns_405() {
        let req = Request::builder()
            .method(hyper::Method::OPTIONS)
            .uri("/")
            .header(hyper::header::HOST, "localhost:1337")
            .header("Access-Control-Request-Method", "CONNECT")
            .body(Body::empty())
            .unwrap();
        let config = test_config(true, "");
        let resp = handle_cors_preflight(&req, &config).unwrap();
        assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[test]
    fn test_cors_preflight_disallowed_headers_returns_forbidden() {
        let req = Request::builder()
            .method(hyper::Method::OPTIONS)
            .uri("/")
            .header(hyper::header::HOST, "localhost:1337")
            .header("Access-Control-Request-Headers", "x-evil-header")
            .body(Body::empty())
            .unwrap();
        let config = test_config(true, "");
        let resp = handle_cors_preflight(&req, &config).unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_cors_preflight_allowed_headers_succeeds() {
        let req = Request::builder()
            .method(hyper::Method::OPTIONS)
            .uri("/")
            .header(hyper::header::HOST, "localhost:1337")
            .header(
                "Access-Control-Request-Headers",
                "content-type, authorization",
            )
            .body(Body::empty())
            .unwrap();
        let config = test_config(true, "");
        let resp = handle_cors_preflight(&req, &config).unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[test]
    fn test_cors_preflight_with_origin_sets_allow_origin() {
        let req = Request::builder()
            .method(hyper::Method::OPTIONS)
            .uri("/")
            .header(hyper::header::HOST, "localhost:1337")
            .header(hyper::header::ORIGIN, "http://localhost:3000")
            .body(Body::empty())
            .unwrap();
        let config = test_config(true, "");
        let resp = handle_cors_preflight(&req, &config).unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get("Access-Control-Allow-Origin")
                .unwrap()
                .to_str()
                .unwrap(),
            "http://localhost:3000"
        );
        assert_eq!(
            resp.headers()
                .get("Access-Control-Allow-Credentials")
                .unwrap()
                .to_str()
                .unwrap(),
            "true"
        );
    }

    #[test]
    fn test_cors_preflight_does_not_reflect_untrusted_origin() {
        let req = Request::builder()
            .method(hyper::Method::OPTIONS)
            .uri("/")
            .header(hyper::header::HOST, "localhost:1337")
            .header(hyper::header::ORIGIN, "https://evil.example")
            .body(Body::empty())
            .unwrap();
        let config = test_config(true, "");
        let resp = handle_cors_preflight(&req, &config).unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        assert!(resp
            .headers()
            .get("Access-Control-Allow-Origin")
            .is_none());
    }

    #[test]
    fn test_cors_preflight_without_origin_sets_minimal_headers() {
        let req = Request::builder()
            .method(hyper::Method::OPTIONS)
            .uri("/")
            .header(hyper::header::HOST, "localhost:1337")
            .body(Body::empty())
            .unwrap();
        let config = test_config(true, "");
        let resp = handle_cors_preflight(&req, &config).unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(resp
            .headers()
            .get("Access-Control-Allow-Origin")
            .is_none());
        assert!(resp
            .headers()
            .get("Access-Control-Allow-Credentials")
            .is_none());
    }

    // --- validate_request tests ---

    #[test]
    fn test_validate_request_whitelisted_path_bypasses_all() {
        let config = test_config(false, "secret-key");
        let headers = hyper::HeaderMap::new();
        let result = validate_request("/", "", "", &headers, &config);
        assert!(result.is_none());
    }

    #[test]
    fn test_validate_request_missing_host_returns_bad_request() {
        let config = test_config(false, "");
        let headers = hyper::HeaderMap::new();
        let result = validate_request("/chat/completions", "", "", &headers, &config);
        assert!(result.is_some());
        if let Some(resp) = result {
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        }
    }

    #[test]
    fn test_validate_request_untrusted_host_returns_forbidden() {
        let config = test_config(false, "");
        let headers = hyper::HeaderMap::new();
        let result = validate_request("/chat/completions", "evil.com", "", &headers, &config);
        assert!(result.is_some());
        if let Some(resp) = result {
            assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        }
    }

    #[test]
    fn test_validate_request_configs_path_returns_404() {
        let config = test_config(false, "my-secret");
        let mut headers = hyper::HeaderMap::new();
        headers.insert(hyper::header::HOST, "localhost:1337".parse().unwrap());
        headers.insert(
            hyper::header::AUTHORIZATION,
            "Bearer my-secret".parse().unwrap(),
        );
        let result = validate_request("/configs", "localhost:1337", "", &headers, &config);
        assert!(result.is_some());
        if let Some(resp) = result {
            assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        }
    }

    #[test]
    fn test_validate_request_configs_subpath_returns_404() {
        let config = test_config(false, "my-secret");
        let mut headers = hyper::HeaderMap::new();
        headers.insert(
            hyper::header::AUTHORIZATION,
            "Bearer my-secret".parse().unwrap(),
        );
        headers.insert(hyper::header::HOST, "localhost:1337".parse().unwrap());
        let result = validate_request("/configs/something", "localhost:1337", "", &headers, &config);
        assert!(result.is_some());
        if let Some(resp) = result {
            assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        }
    }

    #[test]
    fn test_validate_request_api_key_via_bearer() {
        let config = test_config(false, "my-secret");
        let mut headers = hyper::HeaderMap::new();
        headers.insert(
            hyper::header::AUTHORIZATION,
            "Bearer my-secret".parse().unwrap(),
        );
        let result = validate_request("/chat/completions", "localhost:1337", "", &headers, &config);
        assert!(result.is_none());
    }

    #[test]
    fn test_validate_request_api_key_via_x_api_key() {
        let config = test_config(false, "my-secret");
        let mut headers = hyper::HeaderMap::new();
        headers.insert("X-Api-Key", "my-secret".parse().unwrap());
        let result = validate_request("/chat/completions", "localhost:1337", "", &headers, &config);
        assert!(result.is_none());
    }

    #[test]
    fn test_validate_request_wrong_api_key_returns_unauthorized() {
        let config = test_config(false, "my-secret");
        let mut headers = hyper::HeaderMap::new();
        headers.insert(
            hyper::header::AUTHORIZATION,
            "Bearer wrong-key".parse().unwrap(),
        );
        let result = validate_request("/chat/completions", "localhost:1337", "", &headers, &config);
        assert!(result.is_some());
        if let Some(resp) = result {
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        }
    }

    #[test]
    fn test_validate_request_empty_api_key_skips_auth() {
        // When the proxy is running with an empty api_key (loopback-only mode,
        // enforced at startup by commands.rs::requires_authentication), the
        // request handler must bypass its own token check so the in-app chat
        // can call /chat/completions without sending a token header. The
        // upstream provider key is still injected from provider_configs.
        let config = test_config(false, "");
        let headers = hyper::HeaderMap::new();
        let result = validate_request("/chat/completions", "localhost:1337", "", &headers, &config);
        assert!(
            result.is_none(),
            "validate_request must bypass auth when proxy_api_key is empty"
        );
    }

    #[test]
    fn test_validate_request_empty_api_key_ignores_token_headers() {
        // With an empty proxy_api_key, the proxy ignores any client-supplied
        // bearer/x-api-key entirely — neither matching nor non-matching tokens
        // should change the bypass behavior.
        let config = test_config(false, "");
        let mut headers = hyper::HeaderMap::new();
        headers.insert(
            hyper::header::AUTHORIZATION,
            "Bearer some-arbitrary-key".parse().unwrap(),
        );
        let result = validate_request("/chat/completions", "localhost:1337", "", &headers, &config);
        assert!(
            result.is_none(),
            "validate_request must bypass auth when proxy_api_key is empty, even if a token is supplied"
        );
    }

    // --- get_destination_path tests (additional coverage beyond tests.rs) ---

    #[test]
    fn test_get_destination_path_preserves_query() {
        // This depends on the remove_prefix implementation
        let result = get_destination_path("/v1/models?limit=10", "/v1");
        assert!(result.contains("models"));
    }
}
