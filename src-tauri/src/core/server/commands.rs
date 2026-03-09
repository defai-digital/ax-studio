use tauri::{AppHandle, Runtime, State};

use crate::core::server::proxy;
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

    let actual_port = proxy::start_server(
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
    use super::requires_authentication;

    #[test]
    fn test_requires_authentication_for_cors_or_non_loopback() {
        assert!(!requires_authentication("127.0.0.1", false));
        assert!(!requires_authentication("localhost", false));
        assert!(requires_authentication("0.0.0.0", false));
        assert!(requires_authentication("127.0.0.1", true));
    }
}

#[tauri::command]
pub async fn stop_server(state: State<'_, AppState>) -> Result<(), String> {
    let server_handle = state.server_handle.clone();

    proxy::stop_server(server_handle)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> Result<bool, String> {
    let server_handle = state.server_handle.clone();

    Ok(proxy::is_server_running(server_handle).await)
}
