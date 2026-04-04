//! HTTP server lifecycle for the Ax-Studio API proxy.
use crate::core::state::ServerHandle;
use hyper::service::{make_service_fn, service_fn};
use hyper::Server;
use reqwest::Client;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{watch, Mutex};

use super::proxy::{proxy_request, ProxyConfig};

pub async fn is_server_running(server_handle: Arc<Mutex<Option<ServerHandle>>>) -> bool {
    let handle_guard = server_handle.lock().await;
    handle_guard.is_some()
}

#[allow(clippy::too_many_arguments)]
pub async fn start_server<R: tauri::Runtime>(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    cors_enabled: bool,
    proxy_timeout: u64,
    app_handle: tauri::AppHandle<R>,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    start_server_internal(
        server_handle,
        host,
        port,
        prefix,
        proxy_api_key,
        trusted_hosts,
        cors_enabled,
        proxy_timeout,
        app_handle,
    )
    .await
}

async fn start_server_internal<R: tauri::Runtime>(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    cors_enabled: bool,
    proxy_timeout: u64,
    app_handle: tauri::AppHandle<R>,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;
    if handle_guard.is_some() {
        return Err("Server is already running".into());
    }

    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;

    let config = ProxyConfig {
        prefix,
        proxy_api_key,
        trusted_hosts,
        cors_enabled,
        host: host.clone(),
        port,
    };

    // Use user-configured timeout for overall request, cap connect timeout at 30s
    let connect_timeout_secs = proxy_timeout.min(30);
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(connect_timeout_secs))
        .timeout(std::time::Duration::from_secs(proxy_timeout))
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .build()?;

    let make_svc = make_service_fn(move |_conn| {
        let client = client.clone();
        let config = config.clone();
        let app_handle = app_handle.clone();

        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                proxy_request(req, client.clone(), config.clone(), app_handle.clone())
            }))
        }
    });

    let server = match Server::try_bind(&addr) {
        Ok(builder) => builder.serve(make_svc),
        Err(e) => {
            log::error!("Failed to bind to {addr}: {e}");
            return Err(Box::new(e));
        }
    };
    log::info!("Ax-Studio API server started on http://{addr}");

    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    let graceful = server.with_graceful_shutdown(async move {
        let _ = shutdown_rx.changed().await;
    });

    let server_task = tauri::async_runtime::spawn(async move {
        if let Err(e) = graceful.await {
            log::error!("Server error: {e}");
            return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>);
        }
        Ok(())
    });

    *handle_guard = Some(ServerHandle {
        task: server_task,
        shutdown_tx,
    });
    let actual_port = addr.port();
    log::info!("Ax-Studio API server started successfully on port {actual_port}");
    Ok(actual_port)
}

pub async fn stop_server(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;

    if let Some(handle) = handle_guard.take() {
        let _ = handle.shutdown_tx.send(true);
        match tokio::time::timeout(std::time::Duration::from_secs(2), handle.task).await {
            Ok(join_result) => {
                if let Err(e) = join_result {
                    log::warn!("Ax-Studio API server join failed during shutdown: {e}");
                }
            }
            Err(_) => {
                log::warn!("Graceful server shutdown timed out, aborting task");
            }
        }
        log::info!("Ax-Studio API server stopped");
    } else {
        log::debug!("Server was not running");
    }

    Ok(())
}
