//! Meta route handlers: /models and fallback 404.
use hyper::{Body, Response, StatusCode};
use serde_json;
use tauri::Manager;

use super::proxy::ProxyConfig;
use super::security::add_cors_headers_with_host_and_origin;
use crate::core::state::AppState;

/// Handle GET /models — aggregates all configured provider models.
pub(super) async fn handle_models_route<R: tauri::Runtime>(
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
    app_handle: &tauri::AppHandle<R>,
) -> Response<Body> {
    log::debug!("Handling GET /v1/models request");

    // Get remote provider models
    let state = app_handle.state::<AppState>();
    let provider_state = state.provider_state.lock().await;
    let remote_models: Vec<_> = provider_state
        .configs
        .values()
        .flat_map(|provider_cfg| provider_cfg.models.clone())
        .map(|model_id| {
            serde_json::json!({
                "id": model_id,
                "object": "model",
                "created": 1,
                "owned_by": "remote"
            })
        })
        .collect();

    let response_json = serde_json::json!({
        "object": "list",
        "data": remote_models
    });

    let body_str = serde_json::to_string(&response_json).unwrap_or_else(|_| "{}".to_string());

    let mut response_builder = Response::builder()
        .status(StatusCode::OK)
        .header(hyper::header::CONTENT_TYPE, "application/json");

    response_builder = add_cors_headers_with_host_and_origin(
        response_builder,
        host_header,
        origin_header,
        &config.trusted_hosts,
        config.cors_enabled,
    );

    log::debug!("Returning {} remote models", remote_models.len());

    response_builder.body(Body::from(body_str)).unwrap()
}


#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> ProxyConfig {
        ProxyConfig {
            prefix: "/v1".to_string(),
            proxy_api_key: String::new(),
            trusted_hosts: vec![],
            cors_enabled: false,
            host: "127.0.0.1".to_string(),
            port: 1337,
        }
    }

    #[test]
    fn test_handle_unknown_route_returns_404() {
        let config = test_config();
        let resp = handle_unknown_route(
            "/nonexistent",
            &hyper::Method::POST,
            "localhost",
            "",
            &config,
        );
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}

/// Handle unrecognized routes — returns 404.
pub(super) fn handle_unknown_route(
    destination_path: &str,
    method: &hyper::Method,
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
) -> Response<Body> {
    log::warn!("Unhandled method/path for dynamic routing: {method} {destination_path}");
    let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
    error_response = add_cors_headers_with_host_and_origin(
        error_response,
        host_header,
        origin_header,
        &config.trusted_hosts,
        config.cors_enabled,
    );
    error_response.body(Body::from("Not Found")).unwrap()
}
