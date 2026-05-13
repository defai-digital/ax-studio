/**
 * Tauri commands for custom updater with HMAC request signing
 *
 * Convention: First endpoint in tauri.conf.json uses HMAC signing, rest are fallbacks
 */
use super::custom_updater::{CustomUpdater, UpdateInfo};
use tauri::{command, AppHandle};

/// Check for updates using endpoints from tauri.conf.json
/// First endpoint uses HMAC request signing, remaining endpoints are fallbacks
#[command]
pub async fn check_for_app_updates(
    app: AppHandle,
    nonce_seed: String,
) -> Result<Option<UpdateInfo>, String> {
    if nonce_seed.is_empty() {
        return Err("nonce_seed must not be empty".to_string());
    }
    if nonce_seed.len() > 256 {
        return Err("nonce_seed exceeds maximum allowed length".to_string());
    }

    let endpoints = get_updater_endpoints(&app);

    if endpoints.is_empty() {
        log::warn!("No updater endpoints configured in tauri.conf.json; skipping update check");
        return Ok(None);
    }

    let updater = CustomUpdater::new().map_err(|e| e.to_string())?;

    let current_version = app.package_info().version.to_string();

    let update_info = updater
        .check_for_updates(endpoints, &nonce_seed, &current_version)
        .await
        .map_err(|e| e.to_string())?;

    // Only return update info if the version is actually newer
    if let Some(ref info) = update_info {
        if updater.is_update_available(&current_version, &info.version) {
            log::info!(
                "Update available: current {} -> latest {}",
                current_version,
                info.version
            );
            return Ok(update_info);
        } else {
            log::info!(
                "No update needed: current {} is up to date with latest {}",
                current_version,
                info.version
            );
            return Ok(None);
        }
    }

    Ok(None)
}

/// Get updater endpoints from tauri config
fn get_updater_endpoints(app: &AppHandle) -> Vec<String> {
    // Try to get endpoints from tauri config
    // The config structure is: plugins.updater.endpoints
    let config = app.config();

    if let Some(plugins) = &config.plugins.0.get("updater") {
        if let Some(endpoints) = plugins.get("endpoints") {
            if let Some(arr) = endpoints.as_array() {
                return arr
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect();
            }
        }
    }

    // Return empty if no endpoints found
    Vec::new()
}

