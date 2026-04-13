use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::state::{AppState, ProviderConfig};

/// Custom header for provider requests
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCustomHeader {
    pub header: String,
    pub value: String,
}

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

/// Register a remote provider configuration
#[tauri::command]
pub async fn register_provider_config(
    state: State<'_, AppState>,
    request: RegisterProviderRequest,
) -> Result<(), String> {
    let mut provider_state = state.provider_state.lock().await;

    let config = ProviderConfig {
        provider: request.provider.clone(),
        api_key: request.api_key,
        base_url: request.base_url,
        custom_headers: request
            .custom_headers
            .into_iter()
            .map(|h| crate::core::state::ProviderCustomHeader {
                header: h.header,
                value: h.value,
            })
            .collect(),
        models: request.models, // Models will be added when they are configured
    };

    let provider_name = request.provider.clone();
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
    let mut provider_state = state.provider_state.lock().await;

    for request in requests {
        let provider_name = request.provider.clone();
        let config = ProviderConfig {
            provider: request.provider,
            api_key: request.api_key,
            base_url: request.base_url,
            custom_headers: request
                .custom_headers
                .into_iter()
                .map(|h| crate::core::state::ProviderCustomHeader {
                    header: h.header,
                    value: h.value,
                })
                .collect(),
            models: request.models,
        };
        log::info!(
            "Registered provider config (batch): {provider_name} base_url={:?} has_key={} models_count={}",
            config.base_url.as_deref().map(|u| if u.len() > 40 { &u[..40] } else { u }),
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

/// Get provider configuration by name
#[tauri::command]
pub async fn get_provider_config(
    state: State<'_, AppState>,
    provider: String,
) -> Result<Option<ProviderConfigView>, String> {
    let provider_state = state.provider_state.lock().await;

    Ok(provider_state
        .configs
        .get(&provider)
        .map(redact_provider_config))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_provider_config_removes_secret_values() {
        let config = ProviderConfig {
            provider: "openai".to_string(),
            api_key: Some("secret-key".to_string()),
            base_url: Some("https://api.example.com".to_string()),
            custom_headers: vec![crate::core::state::ProviderCustomHeader {
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
}
