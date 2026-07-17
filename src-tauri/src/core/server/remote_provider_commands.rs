use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::state::{AppState, ProviderConfig, ProviderCustomHeader};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderHeaderView {
    pub header: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderConfigView {
    pub provider: String,
    pub has_api_key: bool,
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderHeaderView>,
    pub models: Vec<String>,
}

fn redact_provider_config(config: &ProviderConfig) -> ProviderConfigView {
    ProviderConfigView {
        provider: config.provider.clone(),
        has_api_key: config.api_key.as_ref().is_some_and(|key| !key.is_empty()),
        base_url: config.base_url.clone(),
        custom_headers: config
            .custom_headers
            .iter()
            .map(|header| ProviderHeaderView {
                header: header.header.clone(),
            })
            .collect(),
        models: config.models.clone(),
    }
}

/// Request to register/update a remote provider config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterProviderRequest {
    pub provider: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderCustomHeader>,
    pub models: Vec<String>,
}

const MAX_PROVIDER_BATCH_SIZE: usize = 64;
const PROVIDER_DNS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

fn normalize_provider_api_key(api_key: Option<String>) -> Option<String> {
    let api_key = api_key?;
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let prefix = parts.next().unwrap_or_default();
    let rest = parts.next();

    if prefix.eq_ignore_ascii_case("Bearer") {
        if let Some(rest) = rest.map(str::trim).filter(|key| !key.is_empty()) {
            return Some(rest.to_string());
        }
    }

    Some(trimmed.to_string())
}

async fn validate_provider_request(
    request: RegisterProviderRequest,
) -> Result<(String, ProviderConfig), String> {
    let provider = request.provider.trim().to_string();
    let base_url = request.base_url.and_then(|url| {
        let trimmed = url.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    });
    if let Some(ref base_url) = base_url {
        validate_provider_url(&provider, base_url).await?;
    }

    let config = ProviderConfig {
        provider: provider.clone(),
        api_key: normalize_provider_api_key(request.api_key),
        base_url,
        custom_headers: request.custom_headers,
        models: request.models,
    };
    config.validate()?;
    Ok((provider, config))
}

/// Register a remote provider configuration
#[tauri::command]
pub async fn register_provider_config(
    state: State<'_, AppState>,
    request: RegisterProviderRequest,
) -> Result<(), String> {
    let (provider_name, config) = validate_provider_request(request).await?;
    let mut provider_state = state.provider_state.lock().await;
    provider_state.configs.insert(provider_name.clone(), config);
    provider_state.sync_model_index();
    log::info!("Registered provider config: {provider_name}");
    Ok(())
}

/// Register multiple remote provider configurations in a single lock acquisition
#[tauri::command]
pub async fn register_provider_configs_batch(
    state: State<'_, AppState>,
    requests: Vec<RegisterProviderRequest>,
) -> Result<(), String> {
    if requests.len() > MAX_PROVIDER_BATCH_SIZE {
        return Err(format!(
            "Provider batch exceeds the {MAX_PROVIDER_BATCH_SIZE}-item limit"
        ));
    }

    // Validate the whole batch, including DNS checks, before acquiring shared
    // state. This avoids holding a mutex across network awaits and makes the
    // operation transactional: one invalid item cannot leave a partial batch.
    let mut configs = Vec::with_capacity(requests.len());
    for request in requests {
        configs.push(validate_provider_request(request).await?);
    }

    let mut provider_state = state.provider_state.lock().await;
    for (provider_name, config) in configs {
        log::info!(
            "Registered provider config (batch): {provider_name} has_key={} models_count={}",
            config.api_key.as_ref().is_some_and(|k| !k.is_empty()),
            config.models.len(),
        );
        provider_state.configs.insert(provider_name.clone(), config);
    }
    provider_state.sync_model_index();
    Ok(())
}

/// Unregister a provider configuration
#[tauri::command]
pub async fn unregister_provider_config(
    state: State<'_, AppState>,
    provider: String,
) -> Result<(), String> {
    if provider.trim().is_empty() || provider.len() > 128 || provider.chars().any(char::is_control)
    {
        return Err("Invalid provider name".to_string());
    }
    let mut provider_state = state.provider_state.lock().await;

    if provider_state.configs.remove(&provider).is_some() {
        provider_state.sync_model_index();
        log::info!("Unregistered provider config: {provider}");
        Ok(())
    } else {
        log::warn!("Provider config not found: {provider}");
        Ok(())
    }
}

/// List all registered provider configurations (without sensitive keys)
#[tauri::command]
pub async fn list_provider_configs(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConfigView>, String> {
    let provider_state = state.provider_state.lock().await;

    Ok(provider_state
        .configs
        .values()
        .map(redact_provider_config)
        .collect())
}

/// Abort an active remote stream by sending a cancellation signal.
#[tauri::command]
pub async fn abort_remote_stream(
    state: State<'_, AppState>,
    stream_id: String,
) -> Result<(), String> {
    if stream_id.is_empty() || stream_id.len() > 256 || stream_id.chars().any(char::is_control) {
        return Err("Invalid stream identifier".to_string());
    }
    let mut streams = state.active_streams.lock().await;
    if let Some(tx) = streams.remove(&stream_id) {
        let _ = tx.send(());
        log::info!("Stream {stream_id} abort signal sent");
    } else {
        log::debug!(
            "abort_remote_stream: stream {stream_id} not found (may have already finished)"
        );
    }
    Ok(())
}

fn provider_ip_is_forbidden(ip: std::net::IpAddr, allow_internal: bool) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            ip.is_unspecified()
                || ip.is_link_local()
                || ip.is_multicast()
                || (!allow_internal && ax_studio_utils::is_private_ip(ip.into()))
        }
        std::net::IpAddr::V6(ip) => {
            ip.is_unspecified()
                || (ip.segments()[0] & 0xffc0) == 0xfe80
                || ip.is_multicast()
                || (!allow_internal && ax_studio_utils::is_private_ip(ip.into()))
        }
    }
}

async fn validate_provider_url(provider: &str, url: &str) -> Result<(), String> {
    // Providers that legitimately point to a loopback/internal URL. `mlx` lands
    // here because the in-app provider talks to a local ax-engine-server (which
    // itself delegates to mlx_lm.server) at http://127.0.0.1:<port>/v1. Without
    // this entry, registration is silently rejected and chat fails with
    // "No remote provider configured for model_id ...".
    let allow_internal = matches!(
        provider,
        "llamacpp" | "ollama" | "lmstudio" | "mlx" | "ax-engine"
    );
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid provider URL '{url}': {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!(
            "Provider URL scheme must be http or https, got '{}'",
            parsed.scheme()
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Provider URL must not contain embedded credentials".to_string());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Provider URL must not contain a query string or fragment".to_string());
    }
    if !allow_internal && ax_studio_utils::is_internal_url(url) {
        return Err("Provider URL must not point to an internal or private address".to_string());
    }
    match parsed.host() {
        Some(url::Host::Ipv4(ip)) => {
            if provider_ip_is_forbidden(ip.into(), allow_internal) {
                return Err(format!(
                    "Provider URL must not point to a forbidden address (got {})",
                    ip
                ));
            }
        }
        Some(url::Host::Ipv6(ip)) => {
            if provider_ip_is_forbidden(ip.into(), allow_internal) {
                return Err(format!(
                    "Provider URL must not point to a forbidden address (got {})",
                    ip
                ));
            }
        }
        Some(url::Host::Domain(domain)) => {
            let port = parsed.port_or_known_default().ok_or_else(|| {
                format!(
                    "Provider URL is missing a port for scheme '{}'",
                    parsed.scheme()
                )
            })?;
            let mut addrs = tokio::time::timeout(
                PROVIDER_DNS_TIMEOUT,
                tokio::net::lookup_host((domain, port)),
            )
            .await
            .map_err(|_| format!("Timed out resolving provider URL host '{domain}'"))?
            .map_err(|e| format!("Failed to resolve provider URL host '{domain}': {e}"))?;
            let mut resolved_any = false;
            for addr in &mut addrs {
                resolved_any = true;
                if provider_ip_is_forbidden(addr.ip(), allow_internal) {
                    return Err("Provider URL must not resolve to a forbidden address".to_string());
                }
            }
            if !resolved_any {
                return Err(format!(
                    "Provider URL host '{domain}' did not resolve to any addresses"
                ));
            }
        }
        None => return Err(format!("Provider URL has no host: {url}")),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_provider_config_removes_secret_values() {
        let config = ProviderConfig {
            provider: "openai".to_string(),
            api_key: Some("secret-key".to_string()),
            base_url: Some("https://api.example.com".to_string()),
            custom_headers: vec![ProviderCustomHeader {
                header: "X-Custom".to_string(),
                value: "top-secret".to_string(),
            }],
            models: vec!["gpt-4.1".to_string()],
        };

        let redacted = redact_provider_config(&config);
        assert_eq!(redacted.provider, "openai");
        assert!(redacted.has_api_key);
        assert_eq!(
            redacted.base_url.as_deref(),
            Some("https://api.example.com")
        );
        assert_eq!(
            redacted.custom_headers,
            vec![ProviderHeaderView {
                header: "X-Custom".to_string(),
            }]
        );
        assert_eq!(redacted.models, vec!["gpt-4.1".to_string()]);
    }

    #[test]
    fn test_normalize_provider_api_key_strips_bearer_prefix_and_whitespace() {
        assert_eq!(
            normalize_provider_api_key(Some("  Bearer sk-or-test  ".to_string())).as_deref(),
            Some("sk-or-test")
        );
        assert_eq!(
            normalize_provider_api_key(Some("BEARER\tsk-test".to_string())).as_deref(),
            Some("sk-test")
        );
        assert_eq!(
            normalize_provider_api_key(Some("  sk-plain  ".to_string())).as_deref(),
            Some("sk-plain")
        );
        assert_eq!(normalize_provider_api_key(Some("   ".to_string())), None);
        assert_eq!(normalize_provider_api_key(None), None);
    }

    #[tokio::test]
    async fn provider_urls_reject_credentials_queries_and_remote_loopback() {
        assert!(
            validate_provider_url("openai", "https://user:pass@example.com/v1")
                .await
                .unwrap_err()
                .contains("credentials")
        );
        assert!(
            validate_provider_url("openai", "https://example.com/v1?token=secret")
                .await
                .unwrap_err()
                .contains("query string")
        );
        assert!(validate_provider_url("openai", "http://127.0.0.1:8080/v1")
            .await
            .is_err());
        assert!(validate_provider_url("ollama", "http://127.0.0.1:11434/v1")
            .await
            .is_ok());
    }
}
