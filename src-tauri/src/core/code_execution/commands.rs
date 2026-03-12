use serde::{Deserialize, Serialize};

use super::sandbox;

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
// execute_python_code — runs Python directly on the host
// ---------------------------------------------------------------------------

/// Execute Python code using the system Python interpreter.
///
/// No Docker or sandbox required — code runs as a subprocess.
/// Hard timeout of 60 seconds — process is killed if it exceeds this.
#[tauri::command]
pub async fn execute_python_code(
    code: String,
    thread_id: Option<String>,
) -> Result<ExecutionResult, String> {
    let _ = thread_id; // reserved for future session support

    sandbox::execute_python(&code, 60).await
}

// ---------------------------------------------------------------------------
// check_sandbox_status — now just checks if Python is available
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    pub python_available: bool,
}

#[tauri::command]
pub async fn check_sandbox_status() -> Result<SandboxStatus, String> {
    let python_available = tokio::task::spawn_blocking(sandbox::is_python_available)
        .await
        .unwrap_or(false);

    Ok(SandboxStatus { python_available })
}

// ---------------------------------------------------------------------------
// reset_sandbox_session — kept as no-op for frontend compat
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn reset_sandbox_session(
    thread_id: Option<String>,
) -> Result<(), String> {
    let _ = thread_id;
    Ok(())
}
