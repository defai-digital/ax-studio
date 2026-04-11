//! CORS and security helpers for the Ax-Studio proxy server.

use ax_studio_utils::is_valid_host;

pub(crate) fn trusted_cors_origin(
    origin: &str,
    host: &str,
    trusted_hosts: &[Vec<String>],
) -> Option<String> {
    if origin.is_empty() {
        return None;
    }

    let parsed_origin = url::Url::parse(origin).ok()?;
    if !matches!(parsed_origin.scheme(), "http" | "https") {
        return None;
    }

    let origin_host = parsed_origin.host_str()?;
    let origin_host_with_port = match parsed_origin.port() {
        Some(port) => format!("{origin_host}:{port}"),
        None => origin_host.to_string(),
    };

    if !host.is_empty() && !is_valid_host(host, trusted_hosts) {
        return None;
    }

    if !is_valid_host(&origin_host_with_port, trusted_hosts) {
        return None;
    }

    Some(origin.to_string())
}

pub fn add_cors_headers_with_host_and_origin(
    builder: hyper::http::response::Builder,
    host: &str,
    origin: &str,
    trusted_hosts: &[Vec<String>],
    cors_enabled: bool,
) -> hyper::http::response::Builder {
    if !cors_enabled {
        return builder;
    }

    let mut builder = builder;
    let allow_origin_header = trusted_cors_origin(origin, host, trusted_hosts);

    if let Some(allow_origin_header) = allow_origin_header {
        builder = builder
            .header("Access-Control-Allow-Origin", allow_origin_header.clone())
            .header("Access-Control-Allow-Credentials", "true")
    }

    builder = builder
        .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
        .header("Access-Control-Allow-Headers", "Authorization, Content-Type, Host, Accept, Accept-Language, Cache-Control, Connection, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host, authorization, content-type, x-api-key")
        .header("Vary", "Origin");

    builder
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cors_disabled_returns_builder_unchanged() {
        let builder = hyper::http::Response::builder();
        let result = add_cors_headers_with_host_and_origin(
            builder,
            "localhost",
            "http://example.com",
            &[],
            false,
        );
        let resp = result.body(hyper::Body::empty()).unwrap();
        assert!(resp.headers().get("Access-Control-Allow-Origin").is_none());
    }

    #[test]
    fn test_cors_enabled_with_origin() {
        let builder = hyper::http::Response::builder();
        let result = add_cors_headers_with_host_and_origin(
            builder,
            "localhost:8080",
            "http://localhost:3000",
            &[],
            true,
        );
        let resp = result.body(hyper::Body::empty()).unwrap();
        assert_eq!(
            resp.headers()
                .get("Access-Control-Allow-Origin")
                .unwrap()
                .to_str()
                .unwrap(),
            "http://localhost:3000"
        );
        assert_eq!(
            resp.headers()
                .get("Access-Control-Allow-Credentials")
                .unwrap()
                .to_str()
                .unwrap(),
            "true"
        );
        assert!(resp.headers().get("Access-Control-Allow-Methods").is_some());
        assert!(resp.headers().get("Access-Control-Allow-Headers").is_some());
        assert_eq!(
            resp.headers().get("Vary").unwrap().to_str().unwrap(),
            "Origin"
        );
    }

    #[test]
    fn test_cors_enabled_empty_origin_adds_no_access_control_origin_header() {
        let builder = hyper::http::Response::builder();
        let result = add_cors_headers_with_host_and_origin(builder, "localhost", "", &[], true);
        let resp = result.body(hyper::Body::empty()).unwrap();
        assert!(resp.headers().get("Access-Control-Allow-Origin").is_none());
        // Wildcard origin should NOT have credentials header
        assert!(resp
            .headers()
            .get("Access-Control-Allow-Credentials")
            .is_none());
    }

    #[test]
    fn test_cors_rejects_untrusted_origin_reflection() {
        let builder = hyper::http::Response::builder();
        let result = add_cors_headers_with_host_and_origin(
            builder,
            "localhost:8080",
            "https://evil.example",
            &[vec!["localhost".to_string()]],
            true,
        );
        let resp = result.body(hyper::Body::empty()).unwrap();
        assert!(resp.headers().get("Access-Control-Allow-Origin").is_none());
        assert!(resp
            .headers()
            .get("Access-Control-Allow-Credentials")
            .is_none());
    }
}
