use rand::Rng;
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
    let mut rng = rand::rng();

    while attempts < MAX_ATTEMPTS {
        let port = rng.random_range(3000..4000);

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
            let [first, second, third, _fourth] = ipv4.octets();
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                || ipv4.is_unspecified()
                // "This network" (RFC 1122); URL parsers can also map
                // IPv4-compatible IPv6 such as ::1 into this range.
                || first == 0
                // Shared address space (RFC 6598).
                || (first == 100 && (64..=127).contains(&second))
                // Protocol assignments, documentation, and benchmarking ranges.
                || (first == 192 && second == 0 && third == 0)
                || (first == 192 && second == 0 && third == 2)
                || (first == 198 && (second == 18 || second == 19))
                || (first == 198 && second == 51 && third == 100)
                || (first == 203 && second == 0 && third == 113)
                // Multicast, reserved, and limited broadcast space.
                || first >= 224
        }
        IpAddr::V6(ipv6) => {
            // Check native IPv6 special addresses before `to_ipv4`: the broad
            // compatible-address conversion maps ::1 to 0.0.0.1.
            if ipv6.is_loopback() || ipv6.is_unspecified() {
                return true;
            }

            if let Some(ipv4) = ipv6.to_ipv4() {
                return is_private_ip(IpAddr::V4(ipv4));
            }

            ((ipv6.octets()[0] & 0xfe) == 0xfe && (ipv6.octets()[1] & 0xc0) == 0x80)
                || (ipv6.octets()[0] & 0xfe) == 0xfc
                // Deprecated site-local range fec0::/10.
                || (ipv6.octets()[0] == 0xfe && (ipv6.octets()[1] & 0xc0) == 0xc0)
                || ipv6.octets()[0] == 0xff
                // Documentation prefix 2001:db8::/32 is never globally routable.
                || ipv6.segments()[0] == 0x2001 && ipv6.segments()[1] == 0x0db8
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
        Some(url::Host::Domain(domain)) => {
            let domain = domain.trim_end_matches('.').to_ascii_lowercase();
            domain == "localhost"
                || domain.ends_with(".localhost")
                || domain == "local"
                || domain.ends_with(".local")
                || domain == "internal"
                || domain.ends_with(".internal")
        }
        Some(url::Host::Ipv4(ip)) => is_private_ip(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => is_private_ip(IpAddr::V6(ip)),
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn rejects_non_global_ipv4_ranges() {
        for ip in [
            Ipv4Addr::new(0, 0, 0, 1),
            Ipv4Addr::new(100, 64, 0, 1),
            Ipv4Addr::new(192, 0, 2, 1),
            Ipv4Addr::new(198, 18, 0, 1),
            Ipv4Addr::new(198, 51, 100, 1),
            Ipv4Addr::new(203, 0, 113, 1),
            Ipv4Addr::new(224, 0, 0, 1),
            Ipv4Addr::new(255, 255, 255, 255),
        ] {
            assert!(is_private_ip(IpAddr::V4(ip)), "{ip} should be blocked");
        }
        assert!(!is_private_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }

    #[test]
    fn rejects_non_global_ipv6_ranges() {
        assert!(is_private_ip(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(is_private_ip(IpAddr::V6(Ipv6Addr::new(
            0x2001, 0x0db8, 0, 0, 0, 0, 0, 1,
        ))));
        assert!(is_private_ip(IpAddr::V6(Ipv6Addr::new(
            0xff02, 0, 0, 0, 0, 0, 0, 1,
        ))));
        assert!(is_internal_url("http://[::192.168.1.1]"));
        assert!(is_private_ip(IpAddr::V6(Ipv6Addr::new(
            0xfec0, 0, 0, 0, 0, 0, 0, 1,
        ))));
        assert!(!is_private_ip(IpAddr::V6(Ipv6Addr::new(
            0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111,
        ))));
    }

    #[test]
    fn rejects_special_use_local_domains() {
        for url in [
            "http://localhost.",
            "https://api.localhost",
            "https://local",
            "https://printer.local",
            "https://internal",
            "https://metadata.service.internal",
        ] {
            assert!(is_internal_url(url), "{url} should be blocked");
        }
        assert!(!is_internal_url("https://example.com"));
    }
}
