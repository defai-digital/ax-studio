/**
 * Session Management Module
 *
 * Manages a session identifier for request signing and caching.
 */
use std::sync::OnceLock;

/// Cached session ID to avoid repeated recomputation
static CACHED_SESSION_ID: OnceLock<String> = OnceLock::new();

/// Get session ID without app handle
/// This is useful when app handle is not available (e.g., in download context)
pub fn get_session_id() -> String {
    if let Some(cached) = CACHED_SESSION_ID.get() {
        return cached.clone();
    }

    get_session_id_fallback()
}

/// Fallback session ID using process ID
fn get_session_id_fallback() -> String {
    // Use a combination of hostname and process id as fallback
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
