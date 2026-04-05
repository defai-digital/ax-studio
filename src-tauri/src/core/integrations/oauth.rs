use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Request, Response, Server, StatusCode};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const PKCE_CODE_VERIFIER_BYTES: usize = 64;
const OAUTH_CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);
const GOOGLE_WORKSPACE_RUNTIME_HOME_DIR: &str = "ax-studio-google-workspace-runtime";

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
    let bytes: Vec<u8> = (0..PKCE_CODE_VERIFIER_BYTES)
        .map(|_| rng.gen::<u8>())
        .collect();
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
    initiate_google_oauth_with(
        client_id,
        client_secret,
        scopes,
        |auth_url| {
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_url(auth_url, None::<&str>)
                .map_err(|e| format!("Failed to open browser: {e}"))
        },
        |client_id, client_secret, code, redirect_uri, code_verifier| async move {
            exchange_code_for_tokens(
                &client_id,
                &client_secret,
                &code,
                &redirect_uri,
                &code_verifier,
            )
            .await
        },
        OAUTH_CALLBACK_TIMEOUT,
    )
    .await
}

async fn initiate_google_oauth_with<OpenBrowser, ExchangeTokens, ExchangeFuture>(
    client_id: &str,
    client_secret: &str,
    scopes: &str,
    open_browser: OpenBrowser,
    exchange_tokens: ExchangeTokens,
    timeout: Duration,
) -> Result<OAuthTokens, String>
where
    OpenBrowser: FnOnce(&str) -> Result<(), String>,
    ExchangeTokens: FnOnce(String, String, String, String, String) -> ExchangeFuture,
    ExchangeFuture: Future<Output = Result<OAuthTokens, String>>,
{
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
    if let Err(error) = open_browser(&auth_url) {
        let _ = shutdown_tx.send(());
        let _ = server_handle.await;
        return Err(error);
    }

    // Wait for the callback with a 5-minute timeout
    let code = match tokio::time::timeout(timeout, rx).await {
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
    exchange_tokens(
        client_id.to_string(),
        client_secret.to_string(),
        code,
        redirect_uri,
        code_verifier,
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

fn google_workspace_runtime_home() -> PathBuf {
    std::env::temp_dir().join(GOOGLE_WORKSPACE_RUNTIME_HOME_DIR)
}

fn google_workspace_runtime_config_dir() -> PathBuf {
    google_workspace_runtime_home().join(".google-mcp")
}

fn apply_secure_dir_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
    }
}

fn apply_secure_file_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

/// Convert OAuth output into the secure credential payload stored for Google Workspace.
pub fn google_workspace_credentials(
    client_id: &str,
    client_secret: &str,
    tokens: &OAuthTokens,
) -> Result<HashMap<String, String>, String> {
    let refresh_token = tokens
        .refresh_token
        .as_ref()
        .ok_or_else(|| "Missing refresh token from Google OAuth flow".to_string())?;

    let mut credentials = HashMap::new();
    credentials.insert("client_id".to_string(), client_id.to_string());
    credentials.insert("client_secret".to_string(), client_secret.to_string());
    credentials.insert("refresh_token".to_string(), refresh_token.clone());
    if let Some(expiry_timestamp) = tokens.expiry_timestamp {
        credentials.insert("expiry_timestamp".to_string(), expiry_timestamp.to_string());
    }
    Ok(credentials)
}

/// Validate the secure Google Workspace credential payload.
pub fn validate_google_workspace_credentials(
    credentials: &HashMap<String, String>,
) -> Result<String, String> {
    let has_client_id = credentials
        .get("client_id")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let has_client_secret = credentials
        .get("client_secret")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let has_refresh_token = credentials
        .get("refresh_token")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    if has_client_id && has_client_secret && has_refresh_token {
        Ok("Google Workspace authorized".to_string())
    } else {
        Err("Google Workspace credentials are incomplete. Please re-authorize.".to_string())
    }
}

/// Stage the temporary config files the Google Workspace MCP server expects.
///
/// Secrets remain in the OS secure store at rest and are only materialized under
/// a process-scoped temporary home directory immediately before the MCP server starts.
pub fn stage_google_workspace_runtime_config(
    credentials: &HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    validate_google_workspace_credentials(credentials)?;

    cleanup_google_workspace_config()?;

    let runtime_home = google_workspace_runtime_home();
    let config_dir = google_workspace_runtime_config_dir();
    let tokens_dir = config_dir.join("tokens");

    fs::create_dir_all(&tokens_dir)
        .map_err(|e| format!("Failed to create runtime config directory: {e}"))?;
    apply_secure_dir_permissions(&runtime_home);
    apply_secure_dir_permissions(&config_dir);
    apply_secure_dir_permissions(&tokens_dir);

    let client_id = credentials
        .get("client_id")
        .ok_or_else(|| "Missing client_id in Google Workspace credentials".to_string())?;
    let client_secret = credentials
        .get("client_secret")
        .ok_or_else(|| "Missing client_secret in Google Workspace credentials".to_string())?;
    let refresh_token = credentials
        .get("refresh_token")
        .ok_or_else(|| "Missing refresh_token in Google Workspace credentials".to_string())?;

    let credentials_path = config_dir.join("credentials.json");
    let accounts_path = config_dir.join("accounts.json");
    let token_path = tokens_dir.join("default.json");

    let installed_credentials = serde_json::json!({
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uris": ["http://localhost"]
        }
    });
    fs::write(
        &credentials_path,
        serde_json::to_string_pretty(&installed_credentials)
            .map_err(|e| format!("Failed to serialize runtime credentials: {e}"))?,
    )
    .map_err(|e| format!("Failed to write runtime credentials.json: {e}"))?;

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
        "credentialsPath": credentials_path.to_string_lossy().to_string()
    });
    fs::write(
        &accounts_path,
        serde_json::to_string_pretty(&accounts)
            .map_err(|e| format!("Failed to serialize runtime accounts: {e}"))?,
    )
    .map_err(|e| format!("Failed to write runtime accounts.json: {e}"))?;

    let token = serde_json::json!({
        "type": "authorized_user",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token
    });
    fs::write(
        &token_path,
        serde_json::to_string_pretty(&token)
            .map_err(|e| format!("Failed to serialize runtime token: {e}"))?,
    )
    .map_err(|e| format!("Failed to write runtime token file: {e}"))?;

    apply_secure_file_permissions(&credentials_path);
    apply_secure_file_permissions(&accounts_path);
    apply_secure_file_permissions(&token_path);

    let mut env = HashMap::new();
    let runtime_home_str = runtime_home.to_string_lossy().to_string();
    env.insert("HOME".to_string(), runtime_home_str.clone());
    env.insert("USERPROFILE".to_string(), runtime_home_str);
    Ok(env)
}

/// Bind to an ephemeral port (port 0) assigned by the OS and return the listener.
/// Returns the listener (still bound) and the assigned port.
pub(crate) async fn find_available_port() -> Result<(std::net::TcpListener, u16), String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    Ok((listener, port))
}

/// Clean up Google Workspace config files on disconnect.
///
/// This removes both the old legacy `~/.google-mcp` layout and the current
/// temporary runtime home used only while the Google Workspace MCP server runs.
pub fn cleanup_google_workspace_config() -> Result<(), String> {
    if let Some(home_dir) = dirs::home_dir() {
        let legacy_config_dir = home_dir.join(".google-mcp");
        if legacy_config_dir.exists() {
            fs::remove_dir_all(&legacy_config_dir)
                .map_err(|e| format!("Failed to remove legacy Google Workspace config: {e}"))?;
        }
    }

    let runtime_home = google_workspace_runtime_home();
    if runtime_home.exists() {
        fs::remove_dir_all(&runtime_home)
            .map_err(|e| format!("Failed to remove Google Workspace runtime config: {e}"))?;
    }

    Ok(())
}

// Loopback-only URL validator for OAuth sandbox redirects. Kept as a
// public helper with dedicated tests for use by future sandbox features
// even though no production caller exists today.
#[allow(dead_code)]
pub fn is_allowed_sandbox_url(url: &str) -> bool {
    let parsed = match url::Url::parse(url) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };

    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }

    match parsed.host() {
        Some(url::Host::Domain("localhost")) => true,
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cleanup_google_workspace_config, extract_oauth_result, google_workspace_credentials,
        google_workspace_runtime_config_dir, initiate_google_oauth_with, is_allowed_sandbox_url,
        stage_google_workspace_runtime_config, validate_google_workspace_credentials, OAuthTokens,
    };
    use std::collections::HashMap;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::time::Duration;

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

    #[test]
    fn test_google_workspace_credentials_capture_refresh_token() {
        let tokens = OAuthTokens {
            access_token: "access-token".to_string(),
            refresh_token: Some("refresh-token".to_string()),
            expiry_timestamp: Some(42),
        };

        let credentials =
            google_workspace_credentials("client-id", "client-secret", &tokens).unwrap();

        assert_eq!(credentials.get("client_id").unwrap(), "client-id");
        assert_eq!(credentials.get("client_secret").unwrap(), "client-secret");
        assert_eq!(credentials.get("refresh_token").unwrap(), "refresh-token");
        assert_eq!(credentials.get("expiry_timestamp").unwrap(), "42");
    }

    #[test]
    fn test_stage_google_workspace_runtime_config_writes_temp_runtime_files() {
        let _ = cleanup_google_workspace_config();
        let credentials = HashMap::from([
            ("client_id".to_string(), "client-id".to_string()),
            ("client_secret".to_string(), "client-secret".to_string()),
            ("refresh_token".to_string(), "refresh-token".to_string()),
        ]);

        let env = stage_google_workspace_runtime_config(&credentials).unwrap();
        let config_dir = google_workspace_runtime_config_dir();

        assert!(config_dir.join("credentials.json").exists());
        assert!(config_dir.join("accounts.json").exists());
        assert!(config_dir.join("tokens").join("default.json").exists());
        assert_eq!(env.get("HOME"), env.get("USERPROFILE"));
        assert_eq!(
            validate_google_workspace_credentials(&credentials).unwrap(),
            "Google Workspace authorized"
        );

        cleanup_google_workspace_config().unwrap();
        assert!(!config_dir.exists());
    }

    #[tokio::test]
    async fn test_find_available_port_returns_bound_listener() {
        let (listener, port) = super::find_available_port().await.unwrap();
        // The port should be ephemeral (high number, not in 12300-12400 range)
        assert!(port >= 1024);
        assert_ne!(port, 0);
        // Listener should be bound to 127.0.0.1:port
        let addr = listener.local_addr().unwrap();
        assert_eq!(
            addr.ip(),
            std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
        );
        assert_eq!(addr.port(), port);
    }

    #[tokio::test]
    async fn test_initiate_google_oauth_completes_callback_and_exchanges_tokens() {
        let tokens = initiate_google_oauth_with(
            "client-id",
            "client-secret",
            "scope-a scope-b",
            |auth_url| {
                let url = url::Url::parse(auth_url).unwrap();
                let redirect_uri = url
                    .query_pairs()
                    .find(|(key, _)| key == "redirect_uri")
                    .map(|(_, value)| value.to_string())
                    .unwrap();
                let state = url
                    .query_pairs()
                    .find(|(key, _)| key == "state")
                    .map(|(_, value)| value.to_string())
                    .unwrap();

                tokio::spawn(async move {
                    let callback_url = format!("{redirect_uri}?code=auth-code&state={state}");
                    let response = reqwest::get(callback_url).await.unwrap();
                    assert_eq!(response.status(), reqwest::StatusCode::OK);
                });

                Ok(())
            },
            |client_id, client_secret, code, redirect_uri, code_verifier| async move {
                assert_eq!(client_id, "client-id");
                assert_eq!(client_secret, "client-secret");
                assert_eq!(code, "auth-code");
                assert!(redirect_uri.starts_with("http://localhost:"));
                assert!(!code_verifier.is_empty());

                Ok(OAuthTokens {
                    access_token: "access-token".to_string(),
                    refresh_token: Some("refresh-token".to_string()),
                    expiry_timestamp: Some(1234),
                })
            },
            Duration::from_secs(5),
        )
        .await
        .unwrap();

        assert_eq!(tokens.access_token, "access-token");
        assert_eq!(tokens.refresh_token.as_deref(), Some("refresh-token"));
    }

    #[tokio::test]
    async fn test_initiate_google_oauth_returns_browser_open_error() {
        let exchange_called = Arc::new(AtomicBool::new(false));
        let exchange_called_for_closure = Arc::clone(&exchange_called);

        let error = initiate_google_oauth_with(
            "client-id",
            "client-secret",
            "scope-a",
            |_auth_url| Err("Failed to open browser: opener unavailable".to_string()),
            move |_client_id, _client_secret, _code, _redirect_uri, _code_verifier| {
                let exchange_called = Arc::clone(&exchange_called_for_closure);
                async move {
                    exchange_called.store(true, Ordering::SeqCst);
                    unreachable!("token exchange should not run when browser open fails")
                }
            },
            Duration::from_millis(100),
        )
        .await
        .unwrap_err();

        assert_eq!(error, "Failed to open browser: opener unavailable");
        assert!(!exchange_called.load(Ordering::SeqCst));
    }
}
