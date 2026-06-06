//! CORS and security helpers for the Ax-Studio proxy server.

pub fn add_cors_headers_with_host_and_origin(
    builder: hyper::http::response::Builder,
    _host: &str,
    origin: &str,
    _trusted_hosts: &[Vec<String>],
    cors_enabled: bool,
) -> hyper::http::response::Builder {
    if !cors_enabled {
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
            "localhost",
            "http://example.com",
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
        assert!(resp.headers().get("Access-Control-Allow-Methods").is_some());
        assert!(resp.headers().get("Access-Control-Allow-Headers").is_some());
        assert_eq!(
            resp.headers().get("Vary").unwrap().to_str().unwrap(),
            "Origin"
        );
    }

    #[test]
    fn test_cors_enabled_empty_origin_uses_wildcard() {
        let builder = hyper::http::Response::builder();
        let result = add_cors_headers_with_host_and_origin(builder, "localhost", "", &[], true);
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
    }
}
