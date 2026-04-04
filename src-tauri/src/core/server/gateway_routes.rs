//! Static and meta route handlers: /models, /openapi.json, docs, swagger assets.
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

/// Handle GET /openapi.json — serves OpenAPI spec with dynamic server URL.
pub(super) fn handle_openapi_route(config: &ProxyConfig) -> Response<Body> {
    let static_body = include_str!("../../../static/openapi.json"); // relative to src-tauri/src/
                                                                    // Parse the static OpenAPI JSON and update the server URL with actual host and port
    match serde_json::from_str::<serde_json::Value>(static_body) {
        Ok(mut openapi_spec) => {
            // Update the servers array with the actual host and port
            if let Some(servers) = openapi_spec
                .get_mut("servers")
                .and_then(|s| s.as_array_mut())
            {
                for server in servers {
                    if let Some(server_obj) = server.as_object_mut() {
                        if let Some(url) = server_obj.get_mut("url") {
                            let base_url =
                                format!("http://{}:{}{}", config.host, config.port, config.prefix);
                            *url = serde_json::Value::String(base_url);
                        }
                    }
                }
            }
            let body =
                serde_json::to_string(&openapi_spec).unwrap_or_else(|_| static_body.to_string());
            Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()
        }
        Err(_) => {
            // If parsing fails, return the static file as fallback
            Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/json")
                .body(Body::from(static_body))
                .unwrap()
        }
    }
}

/// Handle GET / — serves Swagger UI HTML.
pub(super) fn handle_docs_root_route(
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
) -> Response<Body> {
    let html = r#"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>API Docs</title>
  <link rel="stylesheet" type="text/css" href="/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script>
  window.onload = () => {
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
    });
  };
  </script>
</body>
</html>
    "#;

    let mut response_builder = Response::builder()
        .status(StatusCode::OK)
        .header(hyper::header::CONTENT_TYPE, "text/html");

    response_builder = add_cors_headers_with_host_and_origin(
        response_builder,
        host_header,
        origin_header,
        &config.trusted_hosts,
        config.cors_enabled,
    );

    response_builder.body(Body::from(html)).unwrap()
}

/// Handle static swagger asset routes. Returns `Some(response)` if matched.
pub(super) fn handle_static_asset(path: &str) -> Option<Response<Body>> {
    match path {
        "/docs/swagger-ui.css" => {
            let css = include_str!("../../../static/swagger-ui/swagger-ui.css");
            Some(
                Response::builder()
                    .status(StatusCode::OK)
                    .header(hyper::header::CONTENT_TYPE, "text/css")
                    .body(Body::from(css))
                    .unwrap(),
            )
        }
        "/docs/swagger-ui-bundle.js" => {
            let js = include_str!("../../../static/swagger-ui/swagger-ui-bundle.js");
            Some(
                Response::builder()
                    .status(StatusCode::OK)
                    .header(hyper::header::CONTENT_TYPE, "application/javascript")
                    .body(Body::from(js))
                    .unwrap(),
            )
        }
        "/favicon.ico" => {
            let icon = include_bytes!("../../../static/swagger-ui/favicon.ico");
            Some(
                Response::builder()
                    .status(StatusCode::OK)
                    .header(hyper::header::CONTENT_TYPE, "image/x-icon")
                    .body(Body::from(icon.as_ref()))
                    .unwrap(),
            )
        }
        _ => None,
    }
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
    fn test_handle_static_asset_css() {
        let resp = handle_static_asset("/docs/swagger-ui.css");
        assert!(resp.is_some());
        let resp = resp.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get(hyper::header::CONTENT_TYPE)
                .unwrap()
                .to_str()
                .unwrap(),
            "text/css"
        );
    }

    #[test]
    fn test_handle_static_asset_js() {
        let resp = handle_static_asset("/docs/swagger-ui-bundle.js");
        assert!(resp.is_some());
        let resp = resp.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get(hyper::header::CONTENT_TYPE)
                .unwrap()
                .to_str()
                .unwrap(),
            "application/javascript"
        );
    }

    #[test]
    fn test_handle_static_asset_favicon() {
        let resp = handle_static_asset("/favicon.ico");
        assert!(resp.is_some());
        assert_eq!(resp.unwrap().status(), StatusCode::OK);
    }

    #[test]
    fn test_handle_static_asset_unknown_returns_none() {
        assert!(handle_static_asset("/unknown/path").is_none());
        assert!(handle_static_asset("/docs/other.js").is_none());
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

    #[test]
    fn test_handle_unknown_route_whitelisted_get_still_404() {
        let config = test_config();
        let resp = handle_unknown_route("/", &hyper::Method::GET, "localhost", "", &config);
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_handle_docs_root_route_returns_html() {
        let config = test_config();
        let resp = handle_docs_root_route("localhost", "", &config);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get(hyper::header::CONTENT_TYPE)
                .unwrap()
                .to_str()
                .unwrap(),
            "text/html"
        );
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
    let whitelisted_paths = [
        "/",
        "/openapi.json",
        "/favicon.ico",
        "/docs/swagger-ui.css",
        "/docs/swagger-ui-bundle.js",
        "/docs/swagger-ui-standalone-preset.js",
    ];
    let is_explicitly_whitelisted_get =
        *method == hyper::Method::GET && whitelisted_paths.contains(&destination_path);
    if is_explicitly_whitelisted_get {
        log::debug!("Handled whitelisted GET path: {destination_path}");
        let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            host_header,
            origin_header,
            &config.trusted_hosts,
            config.cors_enabled,
        );
        error_response.body(Body::from("Not Found")).unwrap()
    } else {
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
}
