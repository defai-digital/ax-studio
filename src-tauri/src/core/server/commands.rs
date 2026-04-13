use tauri::{AppHandle, Runtime, State};

use crate::core::server::proxy_server;
use crate::core::state::AppState;

#[derive(serde::Deserialize)]
pub struct StartServerConfig {
    pub host: String,
    pub port: u16,
    pub prefix: String,
    pub api_key: String,
    pub trusted_hosts: Vec<String>,
    #[serde(default)]
    pub cors_enabled: bool,
    pub proxy_timeout: u64,
}

/// The proxy only needs an API key when something other than the local app
/// can reach it: either CORS is on (browsers from any origin can call it) or
/// the server binds to a non-loopback host (exposed on the network). For the
/// default case (loopback + no CORS) the request handler in `proxy.rs` skips
/// auth entirely when `proxy_api_key.is_empty()`, so requiring a key here
/// would just block the in-app chat from starting on a fresh install.
fn requires_authentication(host: &str, cors_enabled: bool) -> bool {
    cors_enabled || !matches!(host, "127.0.0.1" | "localhost" | "::1")
}

#[tauri::command]
pub async fn start_server<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, AppState>,
    config: StartServerConfig,
) -> Result<u16, String> {
    let StartServerConfig {
        host,
        port,
        prefix,
        api_key,
        trusted_hosts,
        cors_enabled,
        proxy_timeout,
    } = config;

    if requires_authentication(&host, cors_enabled) && api_key.trim().is_empty() {
        return Err(
            "An API key is required when CORS is enabled or the server binds to a non-loopback host"
                .to_string(),
        );
    }

    let server_handle = state.server_handle.clone();

    let actual_port = proxy_server::start_server(
        server_handle,
        host,
        port,
        prefix,
        api_key,
        vec![trusted_hosts],
        cors_enabled,
        proxy_timeout,
        app_handle,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(actual_port)
}

#[cfg(test)]
mod tests {
    use super::{
        get_server_status, requires_authentication, start_server, stop_server, StartServerConfig,
    };
    use crate::core::state::{AppState, ProviderState, SharedMcpServers};
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;
    use tauri::{test::mock_app, Manager};
    use tokio::sync::Mutex;

    fn test_app_state() -> AppState {
        let mcp_servers: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
        AppState {
            app_token: None,
            mcp_servers,
            download_manager: Arc::new(Mutex::new(
                crate::core::downloads::models::DownloadManagerState::default(),
            )),
            mcp_active_servers: Arc::new(Mutex::new(HashMap::new())),
            server_handle: Arc::new(Mutex::new(None)),
            tool_call_cancellations: Arc::new(Mutex::new(HashMap::new())),
            akidb_sync_cancellation: Arc::new(Mutex::new(None)),
            mcp_settings: Arc::new(Mutex::new(crate::core::mcp::models::McpSettings::default())),
            mcp_shutdown_in_progress: Arc::new(Mutex::new(false)),
            mcp_monitoring_tasks: Arc::new(Mutex::new(HashMap::new())),
            background_cleanup_handle: Arc::new(Mutex::new(None)),
            mcp_server_pids: Arc::new(Mutex::new(HashMap::new())),
            provider_state: Arc::new(Mutex::new(ProviderState::default())),
            approved_save_paths: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    #[test]
    fn test_start_server_config_keeps_api_key() {
        let config = StartServerConfig {
            host: "127.0.0.1".to_string(),
            port: 3000,
            prefix: "/v1".to_string(),
            api_key: "test-key".to_string(),
            trusted_hosts: vec!["localhost".to_string()],
            cors_enabled: false,
            proxy_timeout: 30,
        };

        assert_eq!(config.api_key, "test-key");
    }

    #[test]
    fn test_requires_authentication_loopback_no_cors() {
        // Default desktop case: bind to loopback, CORS off → no auth required.
        // The proxy.rs request handler short-circuits the auth check when
        // proxy_api_key is empty, so an empty key is fine here.
        assert!(!requires_authentication("127.0.0.1", false));
        assert!(!requires_authentication("localhost", false));
        assert!(!requires_authentication("::1", false));
    }

    #[test]
    fn test_requires_authentication_cors_enabled() {
        // CORS enabled → browser-origin requests can hit us, key is required.
        assert!(requires_authentication("127.0.0.1", true));
        assert!(requires_authentication("localhost", true));
    }

    #[test]
    fn test_requires_authentication_non_loopback_host() {
        // Non-loopback host (network-exposed) → key is required.
        assert!(requires_authentication("0.0.0.0", false));
        assert!(requires_authentication("192.168.1.10", false));
    }

    #[tokio::test]
    async fn test_start_server_rejects_empty_api_key_when_cors_enabled() {
        let app = mock_app();
        app.manage(test_app_state());

        let result = start_server(
            app.handle().clone(),
            app.state::<AppState>(),
            StartServerConfig {
                host: "127.0.0.1".to_string(),
                port: 0,
                prefix: "/v1".to_string(),
                api_key: "   ".to_string(),
                trusted_hosts: vec!["localhost".to_string()],
                cors_enabled: true,
                proxy_timeout: 30,
            },
        )
        .await;

        assert_eq!(
            result.unwrap_err(),
            "An API key is required when CORS is enabled or the server binds to a non-loopback host"
        );
    }

    #[tokio::test]
    async fn test_get_server_status_and_stop_server_when_not_running() {
        let app = mock_app();
        app.manage(test_app_state());

        let status = get_server_status(app.state::<AppState>()).await.unwrap();
        assert!(!status);

        let stop_result = stop_server(app.state::<AppState>()).await;
        assert!(stop_result.is_ok());
    }
}

#[tauri::command]
pub async fn stop_server(state: State<'_, AppState>) -> Result<(), String> {
    let server_handle = state.server_handle.clone();

    proxy_server::stop_server(server_handle)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> Result<bool, String> {
    let server_handle = state.server_handle.clone();

    Ok(proxy_server::is_server_running(server_handle).await)
}
