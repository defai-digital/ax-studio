use rand::{rngs::StdRng, Rng, SeedableRng};
use std::collections::HashSet;
use std::net::IpAddr;

/// Check if a port is available for binding
pub fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Generate a random port that's not in the used_ports set and is available
pub fn generate_random_port(used_ports: &HashSet<u16>) -> Result<u16, String> {
    const MAX_ATTEMPTS: u32 = 20000;
    let mut attempts = 0;
    let mut rng = StdRng::from_entropy();

    while attempts < MAX_ATTEMPTS {
        let port = rng.gen_range(3000..4000);

        if used_ports.contains(&port) {
            attempts += 1;
            continue;
        }

        if is_port_available(port) {
            return Ok(port);
        }

        attempts += 1;
    }

    Err("Failed to find an available port for the model to load".into())
}

pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_loopback() || ipv4.is_private() || ipv4.is_link_local() || ipv4.is_unspecified()
        }
        IpAddr::V6(ipv6) => {
            if let Some(ipv4) = ipv6.to_ipv4_mapped() {
                return is_private_ip(IpAddr::V4(ipv4));
            }

            ipv6.is_loopback()
                || ipv6.is_unspecified()
                || ((ipv6.octets()[0] & 0xfe) == 0xfe && (ipv6.octets()[1] & 0xc0) == 0x80)
                || (ipv6.octets()[0] & 0xfe) == 0xfc
        }
    }
}

pub fn is_internal_url(url: &str) -> bool {
    let parsed = match url::Url::parse(url) {
        Ok(p) => p,
        Err(_) => return true,
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return true;
    }
    match parsed.host() {
        Some(url::Host::Domain("localhost")) => true,
        Some(url::Host::Ipv4(ip)) => is_private_ip(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => is_private_ip(IpAddr::V6(ip)),
        Some(url::Host::Domain(_)) => false,
        None => true,
    }
}
