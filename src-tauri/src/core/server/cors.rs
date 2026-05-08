//! Shared CORS constants used by proxy/security response handling and request validation.

pub(crate) const CORS_ALLOWED_METHODS: [&str; 6] = [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "OPTIONS",
    "PATCH",
];

pub(crate) const CORS_ALLOWED_METHODS_HEADER: &str =
    "GET, POST, PUT, DELETE, OPTIONS, PATCH";

pub(crate) const CORS_RESPONSE_ALLOWED_HEADERS: [&str; 20] = [
    "authorization",
    "content-type",
    "host",
    "accept",
    "accept-language",
    "cache-control",
    "connection",
    "dnt",
    "if-modified-since",
    "keep-alive",
    "origin",
    "user-agent",
    "x-requested-with",
    "x-csrf-token",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
    "x-api-key",
    "x-ax-provider",
    "x-ax-request-role",
];

pub(crate) const CORS_RESPONSE_ALLOWED_HEADERS_HEADER: &str =
    "Authorization, Content-Type, Host, Accept, Accept-Language, Cache-Control, Connection, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host, authorization, content-type, x-api-key, x-ax-provider, x-ax-request-role";

pub(crate) const CORS_PREFLIGHT_ALLOWED_HEADERS: [&str; 28] = [
    "accept",
    "accept-language",
    "authorization",
    "cache-control",
    "connection",
    "content-type",
    "dnt",
    "host",
    "if-modified-since",
    "keep-alive",
    "origin",
    "user-agent",
    "x-api-key",
    "x-csrf-token",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-requested-with",
    "x-stainless-arch",
    "x-stainless-lang",
    "x-stainless-os",
    "x-stainless-package-version",
    "x-stainless-retry-count",
    "x-stainless-runtime",
    "x-stainless-runtime-version",
    "x-stainless-timeout",
    "x-ax-provider",
    "x-ax-request-role",
];
