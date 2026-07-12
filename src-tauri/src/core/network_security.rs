//! Shared outbound-network trust-boundary enforcement.
//!
//! Literal URL checks are necessary but insufficient: an attacker-controlled
//! hostname can resolve to a private address, or change answers between a
//! preflight lookup and the actual connection. `PublicDnsResolver` validates
//! the exact addresses handed to reqwest, closing that check/use gap for direct
//! connections. Callers that intentionally use a private proxy may allow only
//! that proxy hostname while separately validating destination URLs.

use hyper::client::connect::dns::Name;
use reqwest::dns::{Addrs, Resolve, Resolving};
use std::collections::HashSet;
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use url::{Host, Url};

const DNS_TIMEOUT: Duration = Duration::from_secs(5);

fn normalized_host(host: &str) -> String {
    host.trim_end_matches('.').to_ascii_lowercase()
}

fn validate_resolved_addresses(
    host: &str,
    addresses: &[SocketAddr],
    allow_private: bool,
) -> io::Result<()> {
    if addresses.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("DNS returned no addresses for {host}"),
        ));
    }

    if !allow_private
        && addresses
            .iter()
            .any(|address| ax_studio_utils::is_private_ip(address.ip()))
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{host} resolves to an internal/private or reserved address"),
        ));
    }

    Ok(())
}

async fn lookup_validated(host: &str, allow_private: bool) -> io::Result<Vec<SocketAddr>> {
    let lookup = tokio::net::lookup_host((host, 0));
    let addresses = tokio::time::timeout(DNS_TIMEOUT, lookup)
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "DNS resolution timed out"))??
        .collect::<Vec<_>>();
    validate_resolved_addresses(host, &addresses, allow_private)?;
    Ok(addresses)
}

#[derive(Clone, Debug, Default)]
pub struct PublicDnsResolver {
    allowed_private_hosts: Arc<HashSet<String>>,
    loopback_only_hosts: Arc<HashSet<String>>,
}

impl PublicDnsResolver {
    pub fn allowing_private_host(host: &str) -> Self {
        Self {
            allowed_private_hosts: Arc::new(HashSet::from([normalized_host(host)])),
            loopback_only_hosts: Arc::new(HashSet::new()),
        }
    }

    pub fn allowing_loopback_host(host: &str) -> Self {
        Self {
            allowed_private_hosts: Arc::new(HashSet::new()),
            loopback_only_hosts: Arc::new(HashSet::from([normalized_host(host)])),
        }
    }

    fn allows_private_host(&self, host: &str) -> bool {
        self.allowed_private_hosts.contains(&normalized_host(host))
    }

    fn requires_loopback_host(&self, host: &str) -> bool {
        self.loopback_only_hosts.contains(&normalized_host(host))
    }
}

impl Resolve for PublicDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        let allow_private = self.allows_private_host(&host);
        let require_loopback = self.requires_loopback_host(&host);
        Box::pin(async move {
            let addresses = lookup_validated(&host, allow_private || require_loopback)
                .await
                .map_err(|error| -> Box<dyn std::error::Error + Send + Sync> { Box::new(error) })?;
            if require_loopback && addresses.iter().any(|address| !address.ip().is_loopback()) {
                return Err(Box::new(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("{host} resolved to a non-loopback address"),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}

/// Resolve a parsed outbound URL now and reject any mixed/private answer.
///
/// The custom reqwest resolver still performs the authoritative connect-time
/// validation. This preflight is also required when a configured HTTP proxy
/// performs destination DNS resolution on the application's behalf.
pub async fn validate_public_url_dns(url: &Url) -> Result<(), String> {
    match url.host() {
        Some(Host::Domain(host)) => lookup_validated(host, false)
            .await
            .map(|_| ())
            .map_err(|error| format!("Unsafe outbound host '{host}': {error}")),
        Some(Host::Ipv4(ip)) => {
            if ax_studio_utils::is_private_ip(ip.into()) {
                Err("Outbound URL points to an internal/private or reserved address".to_string())
            } else {
                Ok(())
            }
        }
        Some(Host::Ipv6(ip)) => {
            if ax_studio_utils::is_private_ip(ip.into()) {
                Err("Outbound URL points to an internal/private or reserved address".to_string())
            } else {
                Ok(())
            }
        }
        None => Err("Outbound URL has no host".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    fn addr(ip: IpAddr) -> SocketAddr {
        SocketAddr::new(ip, 0)
    }

    #[test]
    fn rejects_empty_private_and_mixed_dns_answers() {
        assert!(validate_resolved_addresses("empty.example", &[], false).is_err());
        assert!(validate_resolved_addresses(
            "private.example",
            &[addr(Ipv4Addr::new(10, 0, 0, 1).into())],
            false,
        )
        .is_err());
        assert!(validate_resolved_addresses(
            "mixed.example",
            &[
                addr(Ipv4Addr::new(8, 8, 8, 8).into()),
                addr(Ipv4Addr::new(127, 0, 0, 1).into()),
            ],
            false,
        )
        .is_err());
    }

    #[test]
    fn accepts_public_answers_and_explicit_private_proxy_hosts() {
        assert!(validate_resolved_addresses(
            "public.example",
            &[
                addr(Ipv4Addr::new(8, 8, 8, 8).into()),
                addr(Ipv6Addr::new(0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111).into()),
            ],
            false,
        )
        .is_ok());
        assert!(validate_resolved_addresses(
            "proxy.internal",
            &[addr(Ipv4Addr::new(10, 0, 0, 2).into())],
            true,
        )
        .is_ok());
    }

    #[test]
    fn private_proxy_allowlist_is_exact_and_case_insensitive() {
        let resolver = PublicDnsResolver::allowing_private_host("Proxy.Internal.");
        assert!(resolver.allows_private_host("proxy.internal"));
        assert!(!resolver.allows_private_host("evil.proxy.internal"));

        let loopback = PublicDnsResolver::allowing_loopback_host("LOCALHOST.");
        assert!(loopback.requires_loopback_host("localhost"));
        assert!(!loopback.requires_loopback_host("evil.localhost"));
    }
}
