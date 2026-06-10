/**
 * Custom Updater for Ax-Studio with HMAC request signing
 *
 * This module provides a custom update checker that:
 * 1. Reads endpoints from tauri.conf.json (plugins.updater.endpoints)
 * 2. First endpoint is treated as PRIMARY - uses HMAC request signing
 * 3. Remaining endpoints are FALLBACK - no signing needed
 *
 * Convention: The first endpoint in the list should be the signed endpoint
 * (e.g., https://updates.axstudio.ai/update-check)
 */
use super::hmac_client::SignedRequestHeaders;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

/// Timeout for HTTP requests
const REQUEST_TIMEOUT_SECS: u64 = 30;

/// Returns the HMAC signing key baked in at compile time, or None for dev/unsigned builds.
/// The signed primary endpoint is skipped gracefully when this returns None — see callers.
/// Set AX_STUDIO_SIGNING_KEY at build time for release; never hard-code a fallback value.
fn signing_key() -> Option<&'static str> {
    option_env!("AX_STUDIO_SIGNING_KEY").and_then(|key| {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

#[derive(Debug, Error)]
pub enum UpdateError {
    #[error("HTTP request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),

    #[error("Failed to parse update response: {0}")]
    ParseError(String),

    #[error("All endpoints failed")]
    AllEndpointsFailed,

    #[error("Invalid response from server: {0}")]
    InvalidResponse(String),

    #[error("No endpoints configured")]
    NoEndpointsConfigured,

    #[error("AX_STUDIO_SIGNING_KEY is not configured")]
    MissingSigningKey,
}

/// Update information returned by the update check endpoint
/// Compatible with Tauri's updater format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub pub_date: Option<String>,
    #[serde(default)]
    pub platforms: Option<serde_json::Value>,
    /// URL to download the update
    #[serde(default)]
    pub url: Option<String>,
    /// Signature for verifying the update
    #[serde(default)]
    pub signature: Option<String>,
}

/// Custom updater client
pub struct CustomUpdater {
    client: Client,
    secret_key: Option<String>,
}

impl CustomUpdater {
    /// Create a new custom updater
    pub fn new() -> Result<Self, UpdateError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()?;

        let secret_key = signing_key().map(str::to_string);
        if secret_key.is_none() {
            log::warn!(
                "AX_STUDIO_SIGNING_KEY is not configured; signed updater endpoint will be skipped"
            );
        }

        Ok(Self { client, secret_key })
    }

    /// Build User-Agent header: Ax-Studio/{version} ({os}; {arch})
    fn build_user_agent(app_version: &str) -> String {
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;
        format!("Ax-Studio/{} ({}; {})", app_version, os, arch)
    }

    /// Check for updates using endpoints list
    /// First endpoint uses HMAC signing, rest are fallbacks without signing
    pub async fn check_for_updates(
        &self,
        endpoints: Vec<String>,
        nonce_seed: &str,
        current_version: &str,
    ) -> Result<Option<UpdateInfo>, UpdateError> {
        if endpoints.is_empty() {
            return Err(UpdateError::NoEndpointsConfigured);
        }

        log::info!(
            "Checking for updates (current version: {}, {} endpoints configured)",
            current_version,
            endpoints.len()
        );

        let mut last_error: Option<UpdateError> = None;

        for (index, endpoint) in endpoints.iter().enumerate() {
            let is_primary = index == 0;

            let result = if is_primary {
                if self.secret_key.is_none() {
                    log::warn!(
                        "Skipping signed primary update endpoint because AX_STUDIO_SIGNING_KEY is not configured"
                    );
                    last_error = Some(UpdateError::MissingSigningKey);
                    continue;
                }

                // First endpoint: use HMAC signing
                log::info!("Trying primary endpoint with signing: {}", endpoint);
                self.check_with_signing(endpoint, nonce_seed, current_version)
                    .await
            } else {
                // Fallback endpoints: no signing
                log::info!("Trying fallback endpoint: {}", endpoint);
                self.check_without_signing(endpoint, current_version).await
            };

            match result {
                Ok(info) => {
                    log::info!(
                        "Successfully fetched update info from endpoint {}: version {}",
                        endpoint,
                        info.version
                    );
                    return Ok(Some(info));
                }
                Err(e) => {
                    log::warn!("Endpoint {} failed: {}", endpoint, e);
                    last_error = Some(e);
                    // Continue to next endpoint
                }
            }
        }

        // All endpoints failed
        log::error!("All {} endpoints failed", endpoints.len());
        Err(last_error.unwrap_or(UpdateError::AllEndpointsFailed))
    }

    /// Check endpoint with HMAC request signing
    async fn check_with_signing(
        &self,
        endpoint: &str,
        nonce_seed: &str,
        app_version: &str,
    ) -> Result<UpdateInfo, UpdateError> {
        let Some(secret_key) = self.secret_key.as_deref() else {
            return Err(UpdateError::MissingSigningKey);
        };

        // Generate signed request headers
        let headers = SignedRequestHeaders::new(secret_key, nonce_seed, app_version);

        // Build request with security headers
        let mut request = self.client.get(endpoint);

        for (key, value) in headers.to_header_pairs() {
            request = request.header(key, value);
        }

        request = request
            .header("Accept", "application/json")
            .header("User-Agent", Self::build_user_agent(app_version));

        // Send request
        let response = request.send().await?;

        // Check response status
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(UpdateError::InvalidResponse(format!(
                "Status {}: {}",
                status, body
            )));
        }

        // Parse response
        let update_info: UpdateInfo = response
            .json()
            .await
            .map_err(|e| UpdateError::ParseError(e.to_string()))?;

        if let Some(ref sig) = update_info.signature {
            if sig.is_empty() {
                log::warn!("Update endpoint returned an empty signature — update will be rejected by Tauri's verifier");
            }
        } else {
            log::warn!("Update endpoint returned no signature field — update will be rejected by Tauri's verifier");
        }

        Ok(update_info)
    }

    /// Check endpoint without signing (for fallback endpoints)
    async fn check_without_signing(
        &self,
        endpoint: &str,
        app_version: &str,
    ) -> Result<UpdateInfo, UpdateError> {
        let response = self
            .client
            .get(endpoint)
            .header("Accept", "application/json")
            .header("User-Agent", Self::build_user_agent(app_version))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(UpdateError::InvalidResponse(format!(
                "Status {}: {}",
                status, body
            )));
        }

        let update_info: UpdateInfo = response
            .json()
            .await
            .map_err(|e| UpdateError::ParseError(e.to_string()))?;

        if let Some(ref sig) = update_info.signature {
            if sig.is_empty() {
                log::warn!("Fallback update endpoint returned an empty signature — update will be rejected by Tauri's verifier");
            }
        } else {
            log::warn!("Fallback update endpoint returned no signature field — update will be rejected by Tauri's verifier");
        }

        Ok(update_info)
    }

    /// Compare versions to check if update is available
    pub fn is_update_available(&self, current: &str, latest: &str) -> bool {
        Self::is_newer_version(current, latest)
    }

    fn is_newer_version(current: &str, latest: &str) -> bool {
        let current = current.trim_start_matches('v');
        let latest = latest.trim_start_matches('v');

        let Ok(current_ver) = semver::Version::parse(current) else {
            log::warn!("Cannot parse current version '{current}', skipping update check");
            return false;
        };
        let Ok(latest_ver) = semver::Version::parse(latest) else {
            log::warn!("Cannot parse latest version '{latest}', skipping update check");
            return false;
        };

        latest_ver > current_ver
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_comparison() {
        assert!(CustomUpdater::is_newer_version("1.0.0", "1.0.1"));
        assert!(CustomUpdater::is_newer_version("1.0.0", "1.1.0"));
        assert!(CustomUpdater::is_newer_version("1.0.0", "2.0.0"));
        assert!(!CustomUpdater::is_newer_version("1.0.0", "1.0.0"));
        assert!(!CustomUpdater::is_newer_version("1.0.1", "1.0.0"));
        assert!(CustomUpdater::is_newer_version("v1.0.0", "v1.0.1"));
        assert!(CustomUpdater::is_newer_version("1.0.0", "2.0.0-beta"));
        assert!(CustomUpdater::is_newer_version("2.0.0-beta", "2.0.0"));
        assert!(CustomUpdater::is_newer_version("1.9.0", "2.0.0-rc.1"));
    }
}
