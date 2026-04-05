//! Session identifier used for updater request signing and caching.
//!
//! Holds a process-lifetime session ID that is read by the downloads
//! subsystem (via [`get_session_id`]) to sign HMAC requests.

use std::sync::OnceLock;

/// Cached session ID to avoid repeated recomputation
static CACHED_SESSION_ID: OnceLock<String> = OnceLock::new();

/// Get a stable session ID. Returns a cached value if already computed,
/// otherwise falls back to a process-derived identifier.
///
/// Used without an AppHandle (e.g. from the download subsystem where an
/// app handle is not readily available).
pub fn get_session_id() -> String {
    if let Some(cached) = CACHED_SESSION_ID.get() {
        return cached.clone();
    }

    let id = get_session_id_fallback();
    let _ = CACHED_SESSION_ID.set(id.clone());
    id
}

/// Fallback session ID derived from hostname and process ID.
fn get_session_id_fallback() -> String {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    format!("axstudio-{}-{}", hostname, std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fallback_session() {
        let id = get_session_id_fallback();
        assert!(!id.is_empty());
    }
}
