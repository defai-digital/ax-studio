//! Backend service routing: forwards /retrieval/*, /agents/*, /vectors/* directly
//! to configured backend services, bypassing the provider_configs system.
use ax_studio_utils::is_cors_header;
use futures_util::StreamExt;
use hyper::{Body, Response, StatusCode};
use reqwest::Client;
use tauri::Manager;

use crate::core::state::AppState;
use super::proxy::ProxyConfig;
use super::security::add_cors_headers_with_host_and_origin;

/// Handle backend service routes (/retrieval/*, /agents/*, /vectors/*).
/// Returns `Some(Ok(response))` if matched and handled, `None` to fall through to model routing.
pub(super) async fn handle_service_route<R: tauri::Runtime>(
    destination_path: &str,
    method: hyper::Method,
    headers: &hyper::HeaderMap,
    body: Body,
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
    client: &Client,
    app_handle: &tauri::AppHandle<R>,
) -> Option<Result<Response<Body>, hyper::Error>> {
    if !destination_path.starts_with("/retrieval/")
        && !destination_path.starts_with("/agents/")
        && !destination_path.starts_with("/vectors/")
    {
        return None;
    }

    let service_base = {
        let state = app_handle.state::<AppState>();
        let service_config = state.ax_studio_service_config.lock().await;
        if destination_path.starts_with("/retrieval/") {
            service_config.retrieval_service_url.clone()
        } else if destination_path.starts_with("/agents/") {
            service_config.agents_service_url.clone()
        } else {
            service_config.akidb_url.clone()
        }
    };

    if service_base.is_empty() {
        let mut error_response = Response::builder().status(StatusCode::SERVICE_UNAVAILABLE);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            host_header,
            origin_header,
            &config.trusted_hosts,
        );
        return Some(Ok(error_response
            .body(Body::from("Ax-Studio service URL is not configured"))
            .unwrap()));
    }

    let target_url = format!(
        "{}{}",
        service_base.trim_end_matches('/'),
        destination_path
    );

    let body_bytes = match hyper::body::to_bytes(body).await {
        Ok(b) => b,
        Err(_) => {
            let mut error_response =
                Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                host_header,
                origin_header,
                &config.trusted_hosts,
            );
            return Some(Ok(error_response
                .body(Body::from("Failed to read request body"))
                .unwrap()));
        }
    };

    log::info!(
        "Ax-Studio service proxy: {} {} → {}",
        method,
        destination_path,
        target_url
    );

    let mut outbound = client.request(method.clone(), &target_url);
    for (name, value) in headers.iter() {
        // Strip Host to avoid sending the proxy's own host to the backend
        if name != hyper::header::HOST {
            outbound = outbound.header(name, value);
        }
    }

    match outbound.body(body_bytes).send().await {
        Ok(response) => {
            let status = response.status();
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
            let (mut sender, resp_body) = hyper::Body::channel();
            tokio::spawn(async move {
                while let Some(chunk) = stream.next().await {
                    match chunk {
                        Ok(data) => {
                            if sender.send_data(data).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            log::error!("Ax-Studio service stream error: {e}");
                            break;
                        }
                    }
                }
            });
            Some(Ok(builder.body(resp_body).unwrap()))
        }
        Err(e) => {
            log::error!("Ax-Studio service proxy error: {e}");
            let mut error_response = Response::builder().status(StatusCode::BAD_GATEWAY);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                host_header,
                origin_header,
                &config.trusted_hosts,
            );
            Some(Ok(error_response
                .body(Body::from(format!("Ax-Studio service error: {e}")))
                .unwrap()))
        }
    }
}
