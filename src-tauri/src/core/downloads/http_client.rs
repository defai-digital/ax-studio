//! HTTP transport for downloads: DNS pinning, redirect policy, and resume semantics.

use super::models::DownloadItem;
use super::policy::{
    create_proxy_from_config, err_to_string, redact_url_for_log, should_bypass_proxy,
    validate_download_url,
};
use crate::core::network_security::{validate_public_url_dns, PublicDnsResolver};
use futures_util::StreamExt;
use reqwest::header::HeaderMap;
use reqwest::{Method, Response, StatusCode};
use std::sync::Arc;
use std::time::Duration;
use url::Url;

const MAX_REDIRECTS: usize = 10;
const MAX_ERROR_BODY_BYTES: usize = 8 * 1024;

pub fn _get_client_for_item(
    item: &DownloadItem,
    _header_map: &HeaderMap,
) -> Result<reqwest::Client, String> {
    let proxy_is_active = item.proxy.as_ref().is_some_and(|proxy| {
        !should_bypass_proxy(&item.url, proxy.no_proxy.as_deref().unwrap_or(&[]))
    });
    let resolver = item
        .proxy
        .as_ref()
        .filter(|_| proxy_is_active)
        .and_then(|proxy| Url::parse(&proxy.url).ok())
        .and_then(|url| url.host_str().map(PublicDnsResolver::allowing_private_host))
        .unwrap_or_default();
    let mut client_builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .http2_keep_alive_timeout(Duration::from_secs(15))
        .dns_resolver(Arc::new(resolver));

    if let Some(proxy_config) = &item.proxy {
        if proxy_config.ignore_ssl.unwrap_or(false) {
            if item.sha256.is_none() {
                return Err(format!(
                    "SSL certificate verification disabled for download from {}. \
                    SHA256 hash validation is required for security but not provided. \
                    Downloads without hash verification can be tampered with.",
                    redact_url_for_log(&item.url)
                ));
            }
            client_builder = client_builder.danger_accept_invalid_certs(true);
            log::warn!(
                "SSL certificate verification disabled for download from {}. \
                Proceeding with SHA256 hash validation only.",
                redact_url_for_log(&item.url)
            );
        }

        if proxy_is_active {
            client_builder = client_builder.proxy(create_proxy_from_config(proxy_config)?);
            log::info!(
                "Using proxy {} for URL {}",
                redact_url_for_log(&proxy_config.url),
                redact_url_for_log(&item.url)
            );
        } else {
            log::info!("Bypassing proxy for URL {}", redact_url_for_log(&item.url));
        }
    }

    client_builder
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(err_to_string)
}

pub(crate) fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

async fn read_error_body_limited(response: Response) -> String {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            break;
        };
        let remaining = MAX_ERROR_BODY_BYTES.saturating_sub(body.len());
        if remaining == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if body.len() == MAX_ERROR_BODY_BYTES {
            break;
        }
    }
    let mut text = String::from_utf8_lossy(&body).trim().to_string();
    if body.len() == MAX_ERROR_BODY_BYTES {
        text.push('…');
    }
    text
}

async fn send_download_request(
    client: &reqwest::Client,
    method: Method,
    url: &str,
    header_map: &HeaderMap,
    range_start: Option<u64>,
    request_timeout: Duration,
) -> Result<(Response, Url), String> {
    let original_url = validate_download_url(url)?;
    let mut current_url = original_url.clone();

    for redirect_count in 0..=MAX_REDIRECTS {
        validate_download_url(current_url.as_str())?;
        validate_public_url_dns(&current_url).await?;

        let mut request = client.request(method.clone(), current_url.clone());
        if same_origin(&original_url, &current_url) {
            request = request.headers(header_map.clone());
        }
        if let Some(start) = range_start {
            request = request.header("Range", format!("bytes={start}-"));
        }

        let response = tokio::time::timeout(request_timeout, request.send())
            .await
            .map_err(|_| format!("Request timed out after {}s", request_timeout.as_secs()))?
            .map_err(|error| err_to_string(error.without_url()))?;

        if !matches!(
            response.status(),
            StatusCode::MOVED_PERMANENTLY
                | StatusCode::FOUND
                | StatusCode::SEE_OTHER
                | StatusCode::TEMPORARY_REDIRECT
                | StatusCode::PERMANENT_REDIRECT
        ) {
            return Ok((response, current_url));
        }
        if redirect_count == MAX_REDIRECTS {
            return Err(format!(
                "Download exceeded the {MAX_REDIRECTS}-redirect limit"
            ));
        }

        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .ok_or_else(|| "Download redirect is missing a Location header".to_string())?
            .to_str()
            .map_err(|_| "Download redirect Location is not valid UTF-8".to_string())?;
        let next_url = current_url
            .join(location)
            .map_err(|_| "Download redirect Location is invalid".to_string())?;
        if current_url.scheme() == "https" && next_url.scheme() != "https" {
            return Err("Refusing to follow an HTTPS download redirect to insecure HTTP".into());
        }
        validate_download_url(next_url.as_str())?;
        current_url = next_url;
    }
    Err("Download redirect handling failed unexpectedly".to_string())
}

pub async fn _get_file_size(
    client: &reqwest::Client,
    url: &str,
    header_map: &HeaderMap,
) -> Result<u64, Box<dyn std::error::Error>> {
    let (response, _) = send_download_request(
        client,
        Method::HEAD,
        url,
        header_map,
        None,
        Duration::from_secs(10),
    )
    .await?;
    if !response.status().is_success() {
        return Err(format!("Failed to get file size: HTTP status {}", response.status()).into());
    }
    match response.headers().get("content-length") {
        Some(value) => Ok(value.to_str()?.parse()?),
        None => Ok(0),
    }
}

pub async fn _get_maybe_resume_with_fallback(
    client: &reqwest::Client,
    url: &str,
    start_bytes: u64,
    header_map: &HeaderMap,
) -> Result<(reqwest::Response, String), String> {
    log::info!("Downloading from URL: {}", redact_url_for_log(url));
    get_maybe_resume(client, url, start_bytes, header_map).await
}

pub(crate) fn content_range_start(headers: &HeaderMap) -> Option<u64> {
    let value = headers.get(reqwest::header::CONTENT_RANGE)?.to_str().ok()?;
    let range = value.strip_prefix("bytes ")?.split_once('/')?.0;
    range.split_once('-')?.0.parse().ok()
}

async fn get_maybe_resume(
    client: &reqwest::Client,
    url: &str,
    start_bytes: u64,
    header_map: &HeaderMap,
) -> Result<(reqwest::Response, String), String> {
    let (response, actual_url) = send_download_request(
        client,
        Method::GET,
        url,
        header_map,
        (start_bytes > 0).then_some(start_bytes),
        Duration::from_secs(30),
    )
    .await?;

    if start_bytes > 0 {
        if response.status() != StatusCode::PARTIAL_CONTENT {
            let status = response.status();
            let body = read_error_body_limited(response).await;
            return Err(format!(
                "Failed to resume download: HTTP status {status}{}",
                if body.is_empty() {
                    String::new()
                } else {
                    format!(", {body}")
                }
            ));
        }
        if content_range_start(response.headers()) != Some(start_bytes) {
            return Err(format!(
                "Failed to resume download: server returned an invalid Content-Range for byte {start_bytes}"
            ));
        }
    } else if !response.status().is_success() {
        let status = response.status();
        let body = read_error_body_limited(response).await;
        return Err(format!(
            "Failed to download: HTTP status {status}{}",
            if body.is_empty() {
                String::new()
            } else {
                format!(", {body}")
            }
        ));
    }

    Ok((response, actual_url.to_string()))
}
