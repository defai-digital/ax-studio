use std::collections::HashMap;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use super::constants::{integration_env_keys, integration_validation_url};
use super::oauth;

const STORE_NAME: &str = "integrations.json";

fn cred_key(integration: &str) -> String {
    format!("credentials.{integration}")
}

/// Save credential(s) for an integration into the secure store.
#[tauri::command]
pub async fn save_integration_token(
    app: AppHandle,
    integration: String,
    credentials: HashMap<String, String>,
) -> Result<(), String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.set(&cred_key(&integration), serde_json::json!(credentials));
    Ok(())
}

/// Delete all credentials for an integration.
#[tauri::command]
pub async fn delete_integration_token(app: AppHandle, integration: String) -> Result<(), String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.delete(&cred_key(&integration));

    // Clean up config files for OAuth integrations
    if integration == "google-workspace" {
        if let Err(e) = oauth::cleanup_google_workspace_config() {
            log::warn!("Failed to clean up Google Workspace config: {e}");
        }
    }

    Ok(())
}

/// Check if credentials exist for a given integration (returns bool, never the token).
#[tauri::command]
pub async fn get_integration_status(app: AppHandle, integration: String) -> Result<bool, String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    Ok(store.get(&cred_key(&integration)).is_some())
}

/// Return a map of integration_id → has_credentials for all known integrations.
#[tauri::command]
pub async fn get_all_integration_statuses(app: AppHandle) -> Result<HashMap<String, bool>, String> {
    let env_keys = integration_env_keys();
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open store: {e}"))?;

    let mut statuses = HashMap::new();
    for integration in env_keys.keys() {
        let has_creds = store.get(&cred_key(integration)).is_some();
        statuses.insert(integration.to_string(), has_creds);
    }
    Ok(statuses)
}

/// Read credentials from the store for a given integration (internal helper for MCP injection).
pub fn read_credentials<R: Runtime>(
    app: &AppHandle<R>,
    integration: &str,
) -> Result<HashMap<String, String>, String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open store: {e}"))?;

    let value = store
        .get(&cred_key(integration))
        .ok_or_else(|| format!("No credentials stored for {integration}"))?;

    let creds: HashMap<String, String> = serde_json::from_value(value)
        .map_err(|e| format!("Failed to parse credentials for {integration}: {e}"))?;

    Ok(creds)
}

/// Start an OAuth2 flow for integrations that require it (e.g. Google Workspace).
#[tauri::command]
pub async fn start_oauth_flow(
    app: AppHandle,
    integration: String,
    credentials: HashMap<String, String>,
) -> Result<String, String> {
    match integration.as_str() {
        "google-workspace" => {
            let client_id = credentials
                .get("client_id")
                .ok_or("Missing client_id")?
                .trim();
            let client_secret = credentials
                .get("client_secret")
                .ok_or("Missing client_secret")?
                .trim();
            let scopes = super::constants::google_workspace_scopes();

            let tokens =
                oauth::initiate_google_oauth(&app, client_id, client_secret, scopes).await?;

            // Write config files for the MCP server
            oauth::write_google_workspace_config(client_id, client_secret, &tokens)?;

            let store = app
                .store(STORE_NAME)
                .map_err(|e| format!("Failed to open store: {e}"))?;
            store.delete(&cred_key("google-workspace"));

            Ok("Google Workspace authorized successfully".to_string())
        }
        _ => Err(format!(
            "OAuth flow not supported for integration: {integration}"
        )),
    }
}

/// Validate credentials by calling the integration's API.
#[tauri::command]
pub async fn validate_integration_token(
    integration: String,
    credentials: HashMap<String, String>,
) -> Result<String, String> {
    match integration.as_str() {
        "linear" => validate_linear(&credentials).await,
        "notion" => validate_notion(&credentials).await,
        "slack" => validate_slack(&credentials).await,
        "jira" => validate_jira(&credentials).await,
        "gitlab" => validate_gitlab(&credentials).await,
        "sentry" => validate_sentry(&credentials).await,
        "todoist" => validate_todoist(&credentials).await,
        "postgres" => validate_postgres(&credentials).await,
        "google-workspace" => validate_google_workspace().await,
        _ => Err(format!("Unknown integration: {integration}")),
    }
}

async fn validate_linear(credentials: &HashMap<String, String>) -> Result<String, String> {
    let token = credentials
        .get("LINEAR_API_KEY")
        .ok_or("Missing LINEAR_API_KEY")?;
    let url = integration_validation_url("linear").unwrap();

    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .header("Authorization", token)
        .header("Content-Type", "application/json")
        .body(r#"{"query":"{ viewer { id name } }"}"#)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if resp.status().is_success() {
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        let name = body
            .pointer("/data/viewer/name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        Ok(format!("Authenticated as {name}"))
    } else {
        Err(format!(
            "Authentication failed (HTTP {}). Check your API key.",
            resp.status()
        ))
    }
}

async fn validate_notion(credentials: &HashMap<String, String>) -> Result<String, String> {
    let token = credentials
        .get("NOTION_TOKEN")
        .ok_or("Missing NOTION_TOKEN")?;
    let url = integration_validation_url("notion").unwrap();

    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Notion-Version", "2022-06-28")
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if resp.status().is_success() {
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        let name = body
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        Ok(format!("Authenticated as {name}"))
    } else {
        Err(format!(
            "Authentication failed (HTTP {}). Check your API key.",
            resp.status()
        ))
    }
}

async fn validate_slack(credentials: &HashMap<String, String>) -> Result<String, String> {
    let token = credentials
        .get("SLACK_BOT_TOKEN")
        .ok_or("Missing SLACK_BOT_TOKEN")?;

    let client = reqwest::Client::new();
    let resp = client
        .post("https://slack.com/api/auth.test")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if resp.status().is_success() {
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        if body.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            let team = body
                .get("team")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let user = body
                .get("user")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            Ok(format!("Authenticated as {user} in {team}"))
        } else {
            let error = body
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            Err(format!("Slack auth failed: {error}"))
        }
    } else {
        Err(format!(
            "Authentication failed (HTTP {}). Check your bot token.",
            resp.status()
        ))
    }
}

async fn validate_jira(credentials: &HashMap<String, String>) -> Result<String, String> {
    let token = credentials
        .get("ATLASSIAN_API_TOKEN")
        .ok_or("Missing ATLASSIAN_API_TOKEN")?;
    let email = credentials
        .get("ATLASSIAN_USER_EMAIL")
        .ok_or("Missing ATLASSIAN_USER_EMAIL")?;
    let site_name = credentials
        .get("ATLASSIAN_SITE_NAME")
        .ok_or("Missing ATLASSIAN_SITE_NAME")?;

    let site = site_name.trim().trim_end_matches('/');
    let api_url = format!("https://{site}.atlassian.net/rest/api/3/myself");

    let client = reqwest::Client::new();
    let resp = client
        .get(&api_url)
        .basic_auth(email, Some(token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if resp.status().is_success() {
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        let display_name = body
            .get("displayName")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        Ok(format!("Authenticated as {display_name}"))
    } else {
        Err(format!(
            "Authentication failed (HTTP {}). Check your credentials and Jira URL.",
            resp.status()
        ))
    }
}

async fn validate_gitlab(credentials: &HashMap<String, String>) -> Result<String, String> {
    let token = credentials
        .get("GITLAB_PERSONAL_ACCESS_TOKEN")
        .ok_or("Missing GITLAB_PERSONAL_ACCESS_TOKEN")?;
    let api_url = credentials
        .get("GITLAB_API_URL")
        .map(|s| s.trim_end_matches('/').to_string())
        .unwrap_or_else(|| "https://gitlab.com/api/v4".to_string());

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{api_url}/user"))
        .header("PRIVATE-TOKEN", token)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if resp.status().is_success() {
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        let username = body
            .get("username")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        Ok(format!("Authenticated as {username}"))
    } else {
        Err(format!(
            "Authentication failed (HTTP {}). Check your token.",
            resp.status()
        ))
    }
}

async fn validate_sentry(credentials: &HashMap<String, String>) -> Result<String, String> {
    let token = credentials
        .get("SENTRY_ACCESS_TOKEN")
        .ok_or("Missing SENTRY_ACCESS_TOKEN")?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://sentry.io/api/0/")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if resp.status().is_success() {
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        let username = body
            .pointer("/user/username")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        Ok(format!("Authenticated as {username}"))
    } else {
        Err(format!(
            "Authentication failed (HTTP {}). Check your auth token.",
            resp.status()
        ))
    }
}

async fn validate_todoist(credentials: &HashMap<String, String>) -> Result<String, String> {
    let token = credentials
        .get("TODOIST_API_TOKEN")
        .ok_or("Missing TODOIST_API_TOKEN")?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.todoist.com/rest/v2/projects")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if resp.status().is_success() {
        Ok("Token valid — connected to Todoist".to_string())
    } else {
        Err(format!(
            "Authentication failed (HTTP {}). Check your API token.",
            resp.status()
        ))
    }
}

async fn validate_postgres(credentials: &HashMap<String, String>) -> Result<String, String> {
    let conn_str = credentials
        .get("POSTGRES_CONNECTION_STRING")
        .ok_or("Missing POSTGRES_CONNECTION_STRING")?;

    // Basic format validation — actual connection test happens when MCP server starts
    if conn_str.starts_with("postgresql://") || conn_str.starts_with("postgres://") {
        Ok("Connection string format valid".to_string())
    } else {
        Err("Invalid connection string. Must start with postgresql:// or postgres://".to_string())
    }
}

async fn validate_google_workspace() -> Result<String, String> {
    oauth::validate_google_workspace_config()
}
