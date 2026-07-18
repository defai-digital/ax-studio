/// Checks if header name is a CORS-related header
pub fn is_cors_header(header_name: &str) -> bool {
    let header_lower = header_name.to_lowercase();
    header_lower.starts_with("access-control-")
}

/// Validates if host is in trusted hosts list.
/// Automatically trusts loopback and Tauri webview origins:
///   - localhost, 127.0.0.1 (standard loopback)
///   - tauri.localhost (Tauri webview origin on all platforms)
pub fn is_valid_host(host: &str, trusted_hosts: &[Vec<String>]) -> bool {
    if trusted_hosts
        .iter()
        .any(|hosts| hosts.contains(&"*".to_string()))
    {
        return true;
    }

    if host.is_empty() {
        return false;
    }

    let host_without_port = strip_host_port(host);
    // Include tauri.localhost as a default trusted host since the Tauri webview
    // uses it as the origin for requests to the local proxy server.
    // This is critical for Windows where the origin is http://tauri.localhost.
    // Include IPv6 loopback (::1) so Host: [::1]:port is treated like 127.0.0.1.
    let default_valid_hosts = ["localhost", "127.0.0.1", "::1", "tauri.localhost"];

    if default_valid_hosts
        .iter()
        .any(|&valid| host_without_port.to_lowercase() == valid.to_lowercase())
    {
        return true;
    }

    trusted_hosts.iter().flatten().any(|valid| {
        let host_lower = host.to_lowercase();
        let valid_lower = valid.to_lowercase();

        if host_lower == valid_lower {
            return true;
        }

        let valid_without_port = strip_host_port(valid);

        host_without_port.to_lowercase() == valid_without_port.to_lowercase()
    })
}

/// Strip an optional port from a Host header value.
/// Handles `host:port`, `[ipv6]:port`, and unbracketed IPv6 (`::1`).
fn strip_host_port(host: &str) -> &str {
    if host.starts_with('[') {
        return host
            .split(']')
            .next()
            .unwrap_or(host)
            .trim_start_matches('[');
    }

    // Unbracketed IPv6 has multiple colons; do not treat the first as a port separator.
    if host.matches(':').count() >= 2 {
        return host;
    }

    host.split(':').next().unwrap_or(host)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_localhost_is_valid() {
        assert!(is_valid_host("localhost", &[]));
        assert!(is_valid_host("localhost:1337", &[]));
        assert!(is_valid_host("127.0.0.1", &[]));
        assert!(is_valid_host("127.0.0.1:1337", &[]));
    }

    #[test]
    fn test_ipv6_loopback_is_valid() {
        // Host headers for IPv6 loopback arrive bracketed, often with a port.
        assert!(is_valid_host("[::1]", &[]));
        assert!(is_valid_host("[::1]:1337", &[]));
        assert!(is_valid_host("::1", &[]));
    }

    #[test]
    fn test_tauri_localhost_is_valid() {
        // Critical for Windows where Tauri webview uses http://tauri.localhost
        assert!(is_valid_host("tauri.localhost", &[]));
        assert!(is_valid_host("tauri.localhost:1337", &[]));
    }

    #[test]
    fn test_unknown_host_rejected() {
        assert!(!is_valid_host("evil.example", &[]));
        assert!(!is_valid_host("evil.example:8080", &[]));
    }

    #[test]
    fn test_custom_trusted_host() {
        let trusted = vec![vec!["custom.host".to_string()]];
        assert!(is_valid_host("custom.host", &trusted));
        assert!(is_valid_host("custom.host:8080", &trusted));
    }

    #[test]
    fn test_wildcard_trusts_all() {
        let trusted = vec![vec!["*".to_string()]];
        assert!(is_valid_host("anything.example", &trusted));
    }

    #[test]
    fn test_empty_host_rejected() {
        assert!(!is_valid_host("", &[]));
    }
}
