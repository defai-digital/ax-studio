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
