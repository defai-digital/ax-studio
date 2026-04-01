use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Request, Response, Server, StatusCode};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::IpAddr;

use std::sync::Arc;
use tokio::sync::oneshot;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

/// OAuth tokens returned after a successful authorization flow.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expiry_timestamp: Option<u64>,
}

/// Generate a cryptographically random PKCE code verifier (base64url, 43-128 chars).
fn generate_code_verifier() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..64).map(|_| rng.gen::<u8>()).collect();
    base64url_encode(&bytes)
}

fn generate_state_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen::<u8>()).collect();
    base64url_encode(&bytes)
}

/// Compute the PKCE code challenge (SHA256 of verifier, base64url-encoded).
fn compute_code_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    base64url_encode(&hash)
}

/// Base64url-encode without padding (RFC 7636).
fn base64url_encode(input: &[u8]) -> String {
    use base64_encode_no_dep::encode;
    encode(input)
}

/// Minimal base64url encoder (no external dependency needed beyond what we have).
mod base64_encode_no_dep {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    pub fn encode(input: &[u8]) -> String {
        let mut result = String::new();
        let mut i = 0;
        while i < input.len() {
            let b0 = input[i] as u32;
            let b1 = if i + 1 < input.len() {
                input[i + 1] as u32
            } else {
                0
            };
            let b2 = if i + 2 < input.len() {
                input[i + 2] as u32
            } else {
                0
            };
            let triple = (b0 << 16) | (b1 << 8) | b2;

            result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
            result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);

            if i + 1 < input.len() {
                result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
            }
            if i + 2 < input.len() {
                result.push(CHARS[(triple & 0x3F) as usize] as char);
            }

            i += 3;
        }
        result
    }
}

/// Run the full Google OAuth2 Authorization Code flow with PKCE.
///
/// 1. Start a temporary localhost HTTP server to receive the callback
/// 2. Open the Google authorization URL in the user's browser
/// 3. Wait for the authorization code via callback
/// 4. Exchange the code for tokens
/// 5. Return the tokens
pub async fn initiate_google_oauth(
    app: &tauri::AppHandle,
    client_id: &str,
    client_secret: &str,
    scopes: &str,
) -> Result<OAuthTokens, String> {
    // Generate PKCE pair
    let code_verifier = generate_code_verifier();
    let code_challenge = compute_code_challenge(&code_verifier);
    let expected_state = generate_state_token();

    // Find an available port (returns bound listener to avoid TOCTOU race)
    let (listener, port) = find_available_port().await?;
    let redirect_uri = format!("http://localhost:{port}/callback");

    // Build authorization URL with proper URL encoding
    let params = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", scopes)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &expected_state)
        .finish();
    let auth_url = format!("{GOOGLE_AUTH_URL}?{params}");

    // Channel to receive the authorization code from the callback handler
    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let tx = Arc::new(tokio::sync::Mutex::new(Some(tx)));

    // Build the hyper service
    let make_svc = make_service_fn(move |_| {
        let tx = Arc::clone(&tx);
        let expected_state = expected_state.clone();
        async move {
            Ok::<_, hyper::Error>(service_fn(move |req: Request<Body>| {
                let tx = Arc::clone(&tx);
                let expected_state = expected_state.clone();
                async move { handle_oauth_callback(req, tx, expected_state).await }
            }))
        }
    });

    let server = Server::from_tcp(listener)
        .map_err(|e| format!("Failed to create server from listener: {e}"))?
        .serve(make_svc);

    // Set up graceful shutdown
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let graceful = server.with_graceful_shutdown(async {
        let _ = shutdown_rx.await;
    });

    // Spawn the server
    let server_handle = tokio::spawn(graceful);

    // Open the authorization URL in the user's browser
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {e}"))?;

    // Wait for the callback with a 5-minute timeout
    let code = match tokio::time::timeout(tokio::time::Duration::from_secs(300), rx).await {
        Ok(Ok(result)) => result?,
        Ok(Err(_)) => return Err("OAuth callback channel closed unexpectedly".to_string()),
        Err(_) => {
            let _ = shutdown_tx.send(());
            return Err("OAuth flow timed out after 5 minutes".to_string());
        }
    };

    // Shut down the server
    let _ = shutdown_tx.send(());
    let _ = server_handle.await;

    // Exchange authorization code for tokens
    exchange_code_for_tokens(
        client_id,
        client_secret,
        &code,
        &redirect_uri,
        &code_verifier,
    )
    .await
}

/// Handle the OAuth callback request from Google.
async fn handle_oauth_callback(
    req: Request<Body>,
    tx: Arc<tokio::sync::Mutex<Option<oneshot::Sender<Result<String, String>>>>>,
    expected_state: String,
) -> Result<Response<Body>, hyper::Error> {
    let uri = req.uri().to_string();

    if !uri.starts_with("/callback") {
        return Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not found"))
            .unwrap());
    }

    // Parse query parameters
    let query = req.uri().query().unwrap_or("");
    let params: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    let result = extract_oauth_result(&params, &expected_state);

    // Send the result through the channel
    if let Some(sender) = tx.lock().await.take() {
        let _ = sender.send(result);
    }

    // Return a user-friendly HTML response
    let html = r#"<!DOCTYPE html>
<html><head><title>Authorization Complete</title></head>
<body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8f9fa;">
<div style="text-align: center; padding: 2rem;">
<h2 style="color: #1a73e8;">Authorization Successful</h2>
<p>You can close this tab and return to AX Studio.</p>
</div></body></html>"#;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/html")
        .body(Body::from(html))
        .unwrap())
}

fn extract_oauth_result(
    params: &HashMap<String, String>,
    expected_state: &str,
) -> Result<String, String> {
    let returned_state = params
        .get("state")
        .ok_or_else(|| "Missing OAuth state parameter".to_string())?;
    if returned_state != expected_state {
        return Err("OAuth state mismatch".to_string());
    }

    if let Some(code) = params.get("code") {
        Ok(code.clone())
    } else if let Some(error) = params.get("error") {
        Err(format!("Google authorization denied: {error}"))
    } else {
        Err("No authorization code received".to_string())
    }
}

/// Exchange the authorization code for access and refresh tokens.
async fn exchange_code_for_tokens(
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<OAuthTokens, String> {
    let client = reqwest::Client::new();

    let params = [
        ("code", code),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", code_verifier),
    ];

    let resp = client
        .post(GOOGLE_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(format!("Token exchange failed: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {e}"))?;

    let access_token = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("No access_token in response")?
        .to_string();

    let refresh_token = body
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if refresh_token.is_none() {
        return Err(
            "No refresh_token in token response. Ensure 'access_type=offline' and 'prompt=consent' are set."
                .to_string(),
        );
    }

    let expires_in = body.get("expires_in").and_then(|v| v.as_u64());

    let expiry_timestamp = expires_in.map(|secs| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
            + secs * 1000
    });

    Ok(OAuthTokens {
        access_token,
        refresh_token,
        expiry_timestamp,
    })
}

/// Write the credential and token files that the Google Workspace MCP server expects.
pub fn write_google_workspace_config(
    client_id: &str,
    client_secret: &str,
    tokens: &OAuthTokens,
) -> Result<(), String> {
    // Security warning: OAuth tokens written as plaintext to filesystem
    log::warn!(
        "⚠️ SECURITY: OAuth tokens for Google Workspace written as plaintext JSON to ~/.google-mcp/. \
        Consider using OS keychain or encrypted storage for production deployments."
    );
    // Security warning: OAuth tokens written as plaintext to filesystem
    log::warn!(
        "⚠️ SECURITY: OAuth tokens for Google Workspace written as plaintext JSON to ~/.google-mcp/. \
        Consider using OS keychain or encrypted storage for production deployments."
    );
    let config_dir = dirs::home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".google-mcp");

    let tokens_dir = config_dir.join("tokens");
    std::fs::create_dir_all(&tokens_dir)
        .map_err(|e| format!("Failed to create config directory: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let dir_mode = std::fs::Permissions::from_mode(0o700);
        let _ = std::fs::set_permissions(&config_dir, dir_mode.clone());
        let _ = std::fs::set_permissions(&tokens_dir, dir_mode);
    }

    // Write credentials.json (top-level)
    let credentials = serde_json::json!({
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uris": ["http://localhost"]
        }
    });
    std::fs::write(
        config_dir.join("credentials.json"),
        serde_json::to_string_pretty(&credentials)
            .map_err(|e| format!("Failed to serialize credentials: {e}"))?,
    )
    .map_err(|e| format!("Failed to write credentials.json: {e}"))?;

    // Write accounts.json (registers the default account)
    let token_path = tokens_dir.join("default.json");
    let now = chrono::Utc::now().to_rfc3339();
    let accounts = serde_json::json!({
        "accounts": {
            "default": {
                "name": "default",
                "email": "default",
                "tokenPath": token_path.to_string_lossy(),
                "addedAt": now
            }
        },
        "credentialsPath": config_dir.join("credentials.json").to_string_lossy().to_string()
    });
    std::fs::write(
        config_dir.join("accounts.json"),
        serde_json::to_string_pretty(&accounts)
            .map_err(|e| format!("Failed to serialize accounts: {e}"))?,
    )
    .map_err(|e| format!("Failed to write accounts.json: {e}"))?;

    // Write tokens/default.json in the format google-workspace-mcp expects
    let token = serde_json::json!({
        "type": "authorized_user",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": tokens.refresh_token
    });
    std::fs::write(
        &token_path,
        serde_json::to_string_pretty(&token)
            .map_err(|e| format!("Failed to serialize token: {e}"))?,
    )
    .map_err(|e| format!("Failed to write token file: {e}"))?;

    // Restrict file permissions on Unix (credentials contain secrets)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::Permissions::from_mode(0o600);
        let _ = std::fs::set_permissions(config_dir.join("credentials.json"), mode.clone());
        let _ = std::fs::set_permissions(config_dir.join("accounts.json"), mode.clone());
        let _ = std::fs::set_permissions(&token_path, mode);
    }

    Ok(())
}

/// Find an available TCP port in the range 12300-12400 and return the listener.
/// Returns the listener (still bound) and the port to avoid TOCTOU race.
async fn find_available_port() -> Result<(std::net::TcpListener, u16), String> {
    for port in 12300..12400 {
        if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", port)) {
            return Ok((listener, port));
        }
    }
    Err("No available port found in range 12300-12400".to_string())
}

/// Check if Google Workspace config files exist with a valid refresh token.
pub fn validate_google_workspace_config() -> Result<String, String> {
    let config_dir = dirs::home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".google-mcp");

    // Check accounts.json exists and has accounts
    let accounts_path = config_dir.join("accounts.json");
    if !accounts_path.exists() {
        return Err("No accounts configured. Please authorize with Google first.".to_string());
    }

    let token_path = config_dir.join("tokens").join("default.json");
    if !token_path.exists() {
        return Err("No token file found. Please authorize with Google first.".to_string());
    }

    let content = std::fs::read_to_string(&token_path)
        .map_err(|e| format!("Failed to read token file: {e}"))?;

    let token: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse token file: {e}"))?;

    if token
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .is_some()
    {
        Ok("Google Workspace authorized".to_string())
    } else {
        Err("Token file exists but missing refresh_token. Please re-authorize.".to_string())
    }
}

/// Clean up Google Workspace config files on disconnect.
pub fn cleanup_google_workspace_config() -> Result<(), String> {
    let config_dir = dirs::home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".google-mcp");

    if config_dir.exists() {
        std::fs::remove_dir_all(&config_dir)
            .map_err(|e| format!("Failed to remove config directory: {e}"))?;
    }
    Ok(())
}

pub fn is_allowed_sandbox_url(url: &str) -> bool {
    let parsed = match url::Url::parse(url) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };

    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }

    match parsed.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{extract_oauth_result, is_allowed_sandbox_url};
    use std::collections::HashMap;

    #[test]
    fn test_extract_oauth_result_accepts_matching_state() {
        let params = HashMap::from([
            ("state".to_string(), "expected".to_string()),
            ("code".to_string(), "auth-code".to_string()),
        ]);

        let result = extract_oauth_result(&params, "expected").unwrap();
        assert_eq!(result, "auth-code");
    }

    #[test]
    fn test_extract_oauth_result_rejects_missing_state() {
        let params = HashMap::from([("code".to_string(), "auth-code".to_string())]);

        let result = extract_oauth_result(&params, "expected");
        assert_eq!(result.unwrap_err(), "Missing OAuth state parameter");
    }

    #[test]
    fn test_extract_oauth_result_rejects_mismatched_state() {
        let params = HashMap::from([
            ("state".to_string(), "wrong".to_string()),
            ("code".to_string(), "auth-code".to_string()),
        ]);

        let result = extract_oauth_result(&params, "expected");
        assert_eq!(result.unwrap_err(), "OAuth state mismatch");
    }

    #[test]
    fn test_is_allowed_sandbox_url_only_accepts_loopback_hosts() {
        assert!(is_allowed_sandbox_url("http://127.0.0.1:8080"));
        assert!(is_allowed_sandbox_url("https://localhost:8443"));
        assert!(is_allowed_sandbox_url("http://[::1]:8080"));
        assert!(!is_allowed_sandbox_url("http://example.com:8080"));
        assert!(!is_allowed_sandbox_url("file:///tmp/test"));
    }
}
