/**
 * HMAC client for secure update check requests
 * Provides request signing to verify request integrity and prevent tampering
 */
use hmac::{Hmac, Mac};
use rand::Rng;
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

/// Header names for request signing
pub struct HeaderNames;

impl HeaderNames {
    /// Seed value for nonce generation (part of signature computation)
    pub const NONCE_SEED: &'static str = "X-Client-Session";
    /// HMAC signature for request verification
    pub const SIGNATURE: &'static str = "X-Request-Token";
    /// Request timestamp (for replay protection)
    pub const TIMESTAMP: &'static str = "X-Request-Time";
    /// Random nonce (for replay protection)
    pub const NONCE: &'static str = "X-Request-Id";
    /// Current app version being checked
    pub const VERSION: &'static str = "X-Client-Version";
}

/// Generate a cryptographically secure nonce (64 hex characters = 32 bytes)
pub fn generate_nonce() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(bytes)
}

/// Get current Unix timestamp as string
pub fn get_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

/// Generate HMAC-SHA256 signature for request verification
/// Message format: "{nonce_seed}:{timestamp}:{nonce}"
pub fn generate_signature(
    secret_key: &str,
    nonce_seed: &str,
    timestamp: &str,
    nonce: &str,
) -> String {
    let message = format!("{}:{}:{}", nonce_seed, timestamp, nonce);

    let mut mac =
        HmacSha256::new_from_slice(secret_key.as_bytes()).expect("HMAC accepts any key size");
    mac.update(message.as_bytes());

    hex::encode(mac.finalize().into_bytes())
}

/// Request signing headers for update checks
#[derive(Debug, Clone)]
pub struct SignedRequestHeaders {
    pub nonce_seed: String,
    pub signature: String,
    pub timestamp: String,
    pub nonce: String,
    pub version: String,
}

impl SignedRequestHeaders {
    /// Generate signed headers for an update check request
    pub fn new(secret_key: &str, nonce_seed: &str, app_version: &str) -> Self {
        let timestamp = get_timestamp();
        let nonce = generate_nonce();
        let signature = generate_signature(secret_key, nonce_seed, &timestamp, &nonce);

        Self {
            nonce_seed: nonce_seed.to_string(),
            signature,
            timestamp,
            nonce,
            version: app_version.to_string(),
        }
    }

    /// Convert to HTTP header key-value pairs
    pub fn to_header_pairs(&self) -> Vec<(&'static str, String)> {
        vec![
            (HeaderNames::NONCE_SEED, self.nonce_seed.clone()),
            (HeaderNames::SIGNATURE, self.signature.clone()),
            (HeaderNames::TIMESTAMP, self.timestamp.clone()),
            (HeaderNames::NONCE, self.nonce.clone()),
            (HeaderNames::VERSION, self.version.clone()),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signature_generation() {
        // Test with known values
        let signature = generate_signature(
            "your-super-secret-key-change-in-production-minimum-32-chars",
            "test-seed-123",
            "1704067200",
            "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
        );

        // Signature should be 64 hex characters (SHA256)
        assert_eq!(signature.len(), 64);
    }

    #[test]
    fn test_signature_generation_is_deterministic() {
        let sig_a = generate_signature("key", "seed", "1704067200", "nonce");
        let sig_b = generate_signature("key", "seed", "1704067200", "nonce");
        assert_eq!(sig_a, sig_b);
        assert_eq!(sig_a.len(), 64);
    }

    #[test]
    fn test_signature_differs_with_different_inputs() {
        let sig_a = generate_signature("key", "seed", "1704067200", "nonce1");
        let sig_b = generate_signature("key", "seed", "1704067200", "nonce2");
        assert_ne!(sig_a, sig_b);
    }

    #[test]
    fn test_generate_signature_accepts_empty_key() {
        // RFC 2104: HMAC is defined for any key length including zero-length.
        // generate_signature must not panic regardless of key content —
        // the .expect() in the implementation is an infallible invariant.
        let signature = generate_signature("", "seed", "1704067200", "nonce");
        assert_eq!(signature.len(), 64);
    }

    #[test]
    fn test_nonce_generation() {
        let nonce = generate_nonce();
        // Nonce should be 64 hex characters (32 bytes)
        assert_eq!(nonce.len(), 64);
        assert!(nonce.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_signed_headers_generation() {
        let headers = SignedRequestHeaders::new("test-secret", "seed-123", "1.0.0");

        assert_eq!(headers.nonce_seed, "seed-123");
        assert_eq!(headers.version, "1.0.0");
        assert_eq!(headers.signature.len(), 64);
        assert_eq!(headers.nonce.len(), 64);
        assert!(!headers.timestamp.is_empty());
    }
}
