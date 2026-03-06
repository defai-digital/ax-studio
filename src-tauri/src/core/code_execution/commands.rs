use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::state::AppState;
use super::sandbox::{
    self, SandboxStatus,
    execute_via_sandbox, is_docker_running, is_sandbox_ready,
    start_sandbox_container, stop_sandbox_container, wait_for_sandbox,
};

// ---------------------------------------------------------------------------
// Public output types (consumed by the frontend — do not change shape)
// ---------------------------------------------------------------------------

/// A single output item from code execution.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutputItem {
    /// Base64-encoded PNG image (e.g. matplotlib figure).
    Image { data: String },
    /// HTML fragment (e.g. pandas DataFrame, plotly chart).
    Html { data: String },
    /// Plain text.
    Text { data: String },
}

/// Result returned to the frontend after executing Python code.
#[derive(Debug, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub stdout: String,
    pub stderr: String,
    pub outputs: Vec<OutputItem>,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// execute_python_code — main command (replaces subprocess harness)
// ---------------------------------------------------------------------------

/// Execute Python code inside the agent-infra/sandbox Docker container.
///
/// `thread_id` scopes the Jupyter kernel session to a conversation thread so
/// variables persist across multiple "Run" clicks within the same thread.
#[tauri::command]
pub async fn execute_python_code(
    state: State<'_, AppState>,
    code: String,
    thread_id: Option<String>,
) -> Result<ExecutionResult, String> {
    let base_url = state.sandbox_url.lock().await.clone();

    // Ensure the sandbox is reachable before attempting execution
    if !is_sandbox_ready(&base_url).await {
        return Err(
            "Sandbox not running. Please start the Docker sandbox from the Run button.".to_string(),
        );
    }

    // Look up an existing session for this thread (for stateful execution)
    let session_id: Option<String> = {
        let sessions = state.sandbox_sessions.lock().await;
        thread_id
            .as_deref()
            .and_then(|id| sessions.get(id).cloned())
    };

    let exec_result = execute_via_sandbox(
        &base_url,
        session_id.as_deref(),
        &code,
        60,
    )
    .await?;

    // Persist the (possibly new) session id for this thread
    if let Some(ref tid) = thread_id {
        let mut sessions = state.sandbox_sessions.lock().await;
        sessions.insert(tid.clone(), exec_result.session_id.clone());
    }

    Ok(exec_result.result)
}

// ---------------------------------------------------------------------------
// check_sandbox_status
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_sandbox_status(
    state: State<'_, AppState>,
) -> Result<SandboxStatus, String> {
    let base_url = state.sandbox_url.lock().await.clone();

    // Run both checks concurrently — docker check is blocking so we offload it
    // to a thread to avoid stalling the async executor (common issue on Windows)
    let base_url_clone = base_url.clone();
    let (docker_result, sandbox_ready) = tokio::join!(
        tokio::task::spawn_blocking(is_docker_running),
        is_sandbox_ready(&base_url_clone),
    );
    let docker_available = docker_result.unwrap_or(false);

    let debug_info = format!(
        "sandbox_url={} sandbox_ready={} docker_available={}",
        base_url, sandbox_ready, docker_available
    );
    log::info!("[CEE] check_sandbox_status: {debug_info}");

    Ok(SandboxStatus {
        docker_available,
        sandbox_ready,
        sandbox_url: base_url,
        debug_info,
    })
}

// ---------------------------------------------------------------------------
// start_sandbox
// ---------------------------------------------------------------------------

/// Start the ax-sandbox Docker container and wait until it is ready.
/// Returns Ok(()) once the sandbox is accepting requests.
#[tauri::command]
pub async fn start_sandbox(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let base_url = state.sandbox_url.lock().await.clone();

    // Already running? Nothing to do.
    if is_sandbox_ready(&base_url).await {
        return Ok(());
    }

    // Extract port from sandbox URL
    let port: u16 = base_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .rsplit(':')
        .next()
        .and_then(|p| p.split('/').next())
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    // Start the container (blocking — offload to thread pool)
    tokio::task::spawn_blocking(move || start_sandbox_container(port))
        .await
        .map_err(|e| format!("Failed to spawn container start task: {e}"))??;

    // Poll until the REST API is up (up to 30 seconds)
    wait_for_sandbox(&base_url, 60).await
}

// ---------------------------------------------------------------------------
// stop_sandbox
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn stop_sandbox(
    state: State<'_, AppState>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(stop_sandbox_container)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    // Clear all sandbox sessions since the container is gone
    let mut sessions = state.sandbox_sessions.lock().await;
    sessions.clear();
    Ok(())
}

// ---------------------------------------------------------------------------
// reset_sandbox_session
// ---------------------------------------------------------------------------

/// Drop the stored Jupyter session id for a thread.
/// The next `execute_python_code` call will start a fresh kernel session.
#[tauri::command]
pub async fn reset_sandbox_session(
    state: State<'_, AppState>,
    thread_id: Option<String>,
) -> Result<(), String> {
    let mut sessions = state.sandbox_sessions.lock().await;
    if let Some(tid) = thread_id {
        sessions.remove(&tid);
    } else {
        sessions.clear();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// update_sandbox_url
// ---------------------------------------------------------------------------

/// Override the sandbox base URL (e.g. to use a remote sandbox or a non-8080 port).
#[tauri::command]
pub async fn update_sandbox_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<(), String> {
    let mut sandbox_url = state.sandbox_url.lock().await;
    *sandbox_url = url;
    Ok(())
}

// Re-export SandboxStatus so lib.rs callers don't need to reach into sandbox module
pub use sandbox::SandboxStatus as SandboxStatusType;
