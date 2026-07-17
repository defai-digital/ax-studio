//! Validation policy for the privileged download IPC boundary.

use super::models::{DownloadItem, ProxyConfig};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;
use url::Url;

pub(crate) const MAX_DOWNLOAD_ITEMS: usize = 256;
const MAX_DOWNLOAD_TASK_ID_LEN: usize = 128;
const MAX_DOWNLOAD_URL_LEN: usize = 16 * 1024;
const MAX_DOWNLOAD_PATH_LEN: usize = 4 * 1024;
pub(crate) const MAX_DOWNLOAD_HEADERS: usize = 64;
pub(crate) const MAX_DOWNLOAD_HEADER_BYTES: usize = 64 * 1024;
const MAX_PROXY_URL_LEN: usize = 4 * 1024;
const MAX_PROXY_CREDENTIAL_LEN: usize = 4 * 1024;
const MAX_NO_PROXY_ENTRIES: usize = 128;

const MANAGED_REQUEST_HEADERS: &[&str] = &[
    "connection",
    "content-length",
    "host",
    "proxy-authorization",
    "range",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

pub fn err_to_string<E: std::fmt::Display>(error: E) -> String {
    format!("Error: {error}")
}

pub(crate) fn redact_url_for_log(url: &str) -> String {
    let Ok(mut parsed) = Url::parse(url) else {
        return "<invalid URL>".to_string();
    };

    let had_sensitive_parts = !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some();
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);
    parsed.set_query(None);
    parsed.set_fragment(None);

    if had_sensitive_parts {
        format!("{}?[REDACTED]", parsed)
    } else {
        parsed.to_string()
    }
}

pub(crate) fn validate_download_url(url: &str) -> Result<Url, String> {
    if url.is_empty() || url.len() > MAX_DOWNLOAD_URL_LEN {
        return Err(format!(
            "Download URL must contain between 1 and {MAX_DOWNLOAD_URL_LEN} bytes"
        ));
    }

    let parsed = Url::parse(url).map_err(|_| "Download URL is invalid".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Download URL must not contain embedded credentials".to_string());
    }
    if ax_studio_utils::is_internal_url(url) {
        return Err(format!(
            "Download URL '{}' points to an internal/private or reserved address",
            redact_url_for_log(url)
        ));
    }
    Ok(parsed)
}

pub fn validate_download_task_id(task_id: &str) -> Result<(), String> {
    if task_id.is_empty() || task_id.len() > MAX_DOWNLOAD_TASK_ID_LEN {
        return Err(format!(
            "Download task ID must contain between 1 and {MAX_DOWNLOAD_TASK_ID_LEN} characters"
        ));
    }
    if !task_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(
            "Download task ID may contain only ASCII letters, digits, '-' and '_'".to_string(),
        );
    }
    Ok(())
}

fn validate_download_item(item: &DownloadItem) -> Result<(), String> {
    let parsed_url = validate_download_url(&item.url)?;

    if item.save_path.trim().is_empty() || item.save_path.len() > MAX_DOWNLOAD_PATH_LEN {
        return Err(format!(
            "Download save path must contain between 1 and {MAX_DOWNLOAD_PATH_LEN} bytes"
        ));
    }
    if item.save_path.chars().any(char::is_control) {
        return Err("Download save path must not contain control characters".to_string());
    }

    if let Some(hash) = &item.sha256 {
        if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Download SHA-256 must contain exactly 64 hexadecimal characters".into());
        }
    }

    if parsed_url.scheme() == "http" && item.sha256.is_none() {
        return Err(
            "SHA-256 verification is required for downloads over insecure HTTP".to_string(),
        );
    }

    if let Some(model_id) = &item.model_id {
        if model_id.len() > 512 || model_id.chars().any(char::is_control) {
            return Err("Download model ID is invalid".to_string());
        }
    }

    if let Some(proxy) = &item.proxy {
        validate_proxy_config(proxy)?;
        if proxy.ignore_ssl.unwrap_or(false) && item.sha256.is_none() {
            return Err(
                "SHA-256 verification is required when TLS certificate validation is disabled"
                    .to_string(),
            );
        }
    }

    Ok(())
}

pub fn validate_download_request(
    items: &[DownloadItem],
    task_id: &str,
    headers: &HashMap<String, String>,
) -> Result<(), String> {
    validate_download_task_id(task_id)?;
    if items.is_empty() {
        return Err("Download request must include at least one file".to_string());
    }
    if items.len() > MAX_DOWNLOAD_ITEMS {
        return Err(format!(
            "Download request exceeds the {MAX_DOWNLOAD_ITEMS}-file batch limit"
        ));
    }
    for item in items {
        validate_download_item(item)?;
    }
    _convert_headers(headers).map_err(err_to_string)?;
    Ok(())
}

pub fn validate_proxy_config(config: &ProxyConfig) -> Result<(), String> {
    if config.url.is_empty() || config.url.len() > MAX_PROXY_URL_LEN {
        return Err(format!(
            "Proxy URL must contain between 1 and {MAX_PROXY_URL_LEN} bytes"
        ));
    }
    let url = Url::parse(&config.url).map_err(|error| format!("Invalid proxy URL: {error}"))?;

    if url.host_str().is_none() {
        return Err("Proxy URL must include a host".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(
            "Proxy URL must not contain embedded credentials; use username/password fields"
                .to_string(),
        );
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err("Proxy URL must contain only a scheme, host, and optional port".to_string());
    }

    match url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Unsupported proxy scheme: {scheme}")),
    }

    if config
        .username
        .as_ref()
        .is_some_and(|value| value.len() > MAX_PROXY_CREDENTIAL_LEN)
        || config
            .password
            .as_ref()
            .is_some_and(|value| value.len() > MAX_PROXY_CREDENTIAL_LEN)
    {
        return Err(format!(
            "Proxy credentials exceed the {MAX_PROXY_CREDENTIAL_LEN}-byte limit"
        ));
    }
    if config.username.is_some() && config.password.is_none() {
        return Err("Username provided without password".to_string());
    }
    if config.password.is_some() && config.username.is_none() {
        return Err("Password provided without username".to_string());
    }

    if let Some(no_proxy) = &config.no_proxy {
        if no_proxy.len() > MAX_NO_PROXY_ENTRIES {
            return Err(format!(
                "no_proxy exceeds the {MAX_NO_PROXY_ENTRIES}-entry limit"
            ));
        }
        for entry in no_proxy {
            if entry.is_empty() {
                return Err("Empty no_proxy entry".to_string());
            }
            if entry.len() > 255 || entry.chars().any(char::is_control) {
                return Err("Invalid no_proxy entry".to_string());
            }
            if entry.starts_with("*.") && entry.len() < 3 {
                return Err(format!("Invalid wildcard pattern: {entry}"));
            }
            if entry.contains('*')
                && entry != "*"
                && !entry.starts_with("*.")
                && !(entry.ends_with(".*")
                    && entry[..entry.len() - 1]
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || byte == b'.'))
            {
                return Err(format!("Invalid wildcard pattern: {entry}"));
            }
        }
    }

    Ok(())
}

pub fn create_proxy_from_config(config: &ProxyConfig) -> Result<reqwest::Proxy, String> {
    validate_proxy_config(config)?;
    let mut proxy = reqwest::Proxy::all(&config.url).map_err(err_to_string)?;
    if let (Some(username), Some(password)) = (&config.username, &config.password) {
        proxy = proxy.basic_auth(username, password);
    }
    Ok(proxy)
}

pub fn should_bypass_proxy(url: &str, no_proxy: &[String]) -> bool {
    if no_proxy.is_empty() {
        return false;
    }

    let parsed_url = match Url::parse(url) {
        Ok(url) => url,
        Err(_) => return false,
    };
    let host = match parsed_url.host_str() {
        Some(host) => host.trim_end_matches('.').to_ascii_lowercase(),
        None => return false,
    };

    for entry in no_proxy {
        let entry = entry.trim_end_matches('.').to_ascii_lowercase();
        if entry == "*" {
            return true;
        }
        if let Some(domain) = entry.strip_prefix("*.") {
            if host.ends_with(&format!(".{domain}")) {
                return true;
            }
        } else if let Some(prefix) = entry.strip_suffix('*') {
            if host.starts_with(prefix) {
                return true;
            }
        } else if host == entry {
            return true;
        }
    }
    false
}

pub fn _convert_headers(
    headers: &HashMap<String, String>,
) -> Result<HeaderMap, Box<dyn std::error::Error>> {
    if headers.len() > MAX_DOWNLOAD_HEADERS {
        return Err(format!("Too many download headers (maximum {MAX_DOWNLOAD_HEADERS})").into());
    }

    let total_bytes = headers.iter().try_fold(0usize, |total, (name, value)| {
        total
            .checked_add(name.len())
            .and_then(|value_total| value_total.checked_add(value.len()))
            .ok_or("Download header size overflow")
    })?;
    if total_bytes > MAX_DOWNLOAD_HEADER_BYTES {
        return Err(
            format!("Download headers exceed the {MAX_DOWNLOAD_HEADER_BYTES}-byte limit").into(),
        );
    }

    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes())?;
        if MANAGED_REQUEST_HEADERS.contains(&name.as_str()) {
            return Err(format!(
                "Download header '{}' is managed by the HTTP client",
                name.as_str()
            )
            .into());
        }
        header_map.insert(name, HeaderValue::from_str(value)?);
    }
    Ok(header_map)
}
