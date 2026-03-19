//! CORS and security helpers for the Ax-Studio proxy server.
use std::sync::atomic::{AtomicBool, Ordering};

pub static SERVER_CORS_ENABLED: AtomicBool = AtomicBool::new(false);

pub fn add_cors_headers_with_host_and_origin(
    builder: hyper::http::response::Builder,
    _host: &str,
    origin: &str,
    _trusted_hosts: &[Vec<String>],
) -> hyper::http::response::Builder {
    if !SERVER_CORS_ENABLED.load(Ordering::Relaxed) {
        return builder;
    }

    let mut builder = builder;
    let allow_origin_header = if !origin.is_empty() {
        origin.to_string()
    } else {
        "*".to_string()
    };

    builder = builder
        .header("Access-Control-Allow-Origin", allow_origin_header.clone())
        .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
        .header("Access-Control-Allow-Headers", "Authorization, Content-Type, Host, Accept, Accept-Language, Cache-Control, Connection, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host, authorization, content-type, x-api-key")
        .header("Vary", "Origin");

    if allow_origin_header != "*" {
        builder = builder.header("Access-Control-Allow-Credentials", "true");
    }

    builder
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cors_disabled_returns_builder_unchanged() {
        SERVER_CORS_ENABLED.store(false, Ordering::Relaxed);
        let builder = hyper::http::Response::builder();
        let result =
            add_cors_headers_with_host_and_origin(builder, "localhost", "http://example.com", &[]);
        let resp = result.body(hyper::Body::empty()).unwrap();
        assert!(resp.headers().get("Access-Control-Allow-Origin").is_none());
    }

    #[test]
    fn test_cors_enabled_with_origin() {
        SERVER_CORS_ENABLED.store(true, Ordering::Relaxed);
        let builder = hyper::http::Response::builder();
        let result = add_cors_headers_with_host_and_origin(
            builder,
            "localhost",
            "http://example.com",
            &[],
        );
        let resp = result.body(hyper::Body::empty()).unwrap();
        assert_eq!(
            resp.headers()
                .get("Access-Control-Allow-Origin")
                .unwrap()
                .to_str()
                .unwrap(),
            "http://example.com"
        );
        assert_eq!(
            resp.headers()
                .get("Access-Control-Allow-Credentials")
                .unwrap()
                .to_str()
                .unwrap(),
            "true"
        );
        assert!(resp
            .headers()
            .get("Access-Control-Allow-Methods")
            .is_some());
        assert!(resp
            .headers()
            .get("Access-Control-Allow-Headers")
            .is_some());
        assert_eq!(
            resp.headers().get("Vary").unwrap().to_str().unwrap(),
            "Origin"
        );
        // Reset global state
        SERVER_CORS_ENABLED.store(false, Ordering::Relaxed);
    }

    #[test]
    fn test_cors_enabled_empty_origin_uses_wildcard() {
        SERVER_CORS_ENABLED.store(true, Ordering::Relaxed);
        let builder = hyper::http::Response::builder();
        let result = add_cors_headers_with_host_and_origin(builder, "localhost", "", &[]);
        let resp = result.body(hyper::Body::empty()).unwrap();
        assert_eq!(
            resp.headers()
                .get("Access-Control-Allow-Origin")
                .unwrap()
                .to_str()
                .unwrap(),
            "*"
        );
        // Wildcard origin should NOT have credentials header
        assert!(resp
            .headers()
            .get("Access-Control-Allow-Credentials")
            .is_none());
        SERVER_CORS_ENABLED.store(false, Ordering::Relaxed);
    }
}
