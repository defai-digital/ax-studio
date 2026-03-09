use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Duration;

use super::commands::{ExecutionResult, OutputItem};

// ---------------------------------------------------------------------------
// Response types from agent-infra/sandbox Jupyter REST API
//
// Actual format (verified against running container):
// {
//   "success": true,
//   "data": {
//     "session_id": "...",
//     "outputs": [
//       // stream output:
//       { "output_type": "stream", "name": "stdout"/"stderr", "text": "..." }
//       // rich display:
//       { "output_type": "display_data", "data": {"image/png": "b64...", "text/html": "..."} }
//       // execute_result (expression value):
//       { "output_type": "execute_result", "data": {"text/plain": "..."} }
//       // error:
//       { "output_type": "error", "ename": "...", "evalue": "...", "traceback": [...] }
//     ]
//   }
// }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SandboxApiResponse {
    success: bool,
    message: Option<String>,
    data: Option<SandboxData>,
}

#[derive(Deserialize)]
struct SandboxData {
    session_id: String,
    outputs: Vec<SandboxOutput>,
}

/// Represents one Jupyter kernel output message.
#[derive(Deserialize)]
struct SandboxOutput {
    output_type: String,
    // stream fields
    name: Option<String>, // "stdout" | "stderr"
    text: Option<String>,
    // display_data / execute_result fields
    data: Option<serde_json::Value>, // {"image/png": "b64", "text/html": "...", ...}
    // error fields
    ename: Option<String>,
    evalue: Option<String>,
    traceback: Option<Vec<String>>,
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ExecuteRequest<'a> {
    code: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<&'a str>,
    timeout: u64,
}

// ---------------------------------------------------------------------------
// Public result type returned to the commands layer
// ---------------------------------------------------------------------------

pub struct SandboxExecutionResult {
    pub session_id: String,
    pub result: ExecutionResult,
}

// ---------------------------------------------------------------------------
// Docker availability check
// ---------------------------------------------------------------------------

/// Returns true if `docker info` exits successfully, meaning Docker daemon is up.
pub fn is_docker_running() -> bool {
    // Try common Docker binary locations on Windows first
    let candidates: Vec<&str> = if cfg!(target_os = "windows") {
        vec![
            "docker",
            r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
        ]
    } else {
        vec!["docker"]
    };

    for candidate in candidates {
        let result = Command::new(candidate)
            .args(["info", "--format", "{{.ServerVersion}}"])
            .output();
        if let Ok(out) = result {
            if out.status.success() {
                return true;
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Sandbox container health check
// ---------------------------------------------------------------------------

/// Returns true if the sandbox is accepting TCP connections AND responds to HTTP.
/// First does a TCP connect check (fast), then verifies with an HTTP GET.
pub async fn is_sandbox_ready(base_url: &str) -> bool {
    use std::net::TcpStream;

    // Parse "http://127.0.0.1:8080" → "127.0.0.1:8080"
    let host_port = base_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("127.0.0.1:8080")
        .to_string();

    let addr = if host_port.contains(':') {
        host_port
    } else {
        format!("{host_port}:8080")
    };

    let tcp_ok = tokio::task::spawn_blocking(move || {
        TcpStream::connect_timeout(
            &addr
                .parse()
                .unwrap_or_else(|_| "127.0.0.1:8080".parse().unwrap()),
            Duration::from_secs(3),
        )
        .is_ok()
    })
    .await
    .unwrap_or(false);

    if !tcp_ok {
        return false;
    }

    // Verify with HTTP GET to confirm the service is actually ready
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    client
        .get(format!("{}/health", base_url))
        .send()
        .await
        .map(|r| r.status().is_success() || r.status().as_u16() == 404)
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Start sandbox container
// ---------------------------------------------------------------------------

/// Attempt to start the ax-sandbox container.
/// Handles the "already running" case gracefully.
pub fn start_sandbox_container(port: u16) -> Result<(), String> {
    let docker = find_docker_binary().ok_or("Docker not found. Please install Docker Desktop.")?;

    // Try to start an existing stopped container first
    let start_result = Command::new(&docker).args(["start", "ax-sandbox"]).output();

    if let Ok(out) = start_result {
        if out.status.success() {
            return Ok(());
        }
    }

    // Container doesn't exist — create and run it
    let port_mapping = format!("{}:8080", port);
    let result = Command::new(&docker)
        .args([
            "run",
            "-d",
            "--name",
            "ax-sandbox",
            "-p",
            &port_mapping,
            "ghcr.io/agent-infra/sandbox:latest",
        ])
        .output()
        .map_err(|e| format!("Failed to run docker: {e}"))?;

    if result.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        // "already in use" means the container exists and is running — that's fine
        if stderr.contains("already in use") || stderr.contains("already running") {
            Ok(())
        } else {
            Err(format!("Failed to start sandbox container: {stderr}"))
        }
    }
}

// ---------------------------------------------------------------------------
// Stop sandbox container
// ---------------------------------------------------------------------------

pub fn stop_sandbox_container() -> Result<(), String> {
    let docker = match find_docker_binary() {
        Some(d) => d,
        None => return Ok(()), // Docker gone — nothing to stop
    };

    let _ = Command::new(&docker).args(["stop", "ax-sandbox"]).output();
    let _ = Command::new(&docker).args(["rm", "ax-sandbox"]).output();
    Ok(())
}

// ---------------------------------------------------------------------------
// Poll until the sandbox is accepting requests
// ---------------------------------------------------------------------------

/// Poll `is_sandbox_ready` up to `max_retries` times with 500 ms intervals.
pub async fn wait_for_sandbox(base_url: &str, max_retries: u32) -> Result<(), String> {
    for _ in 0..max_retries {
        if is_sandbox_ready(base_url).await {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err(format!(
        "Sandbox did not become ready after {} seconds. Check that Docker is running and the image is available.",
        max_retries / 2
    ))
}

// ---------------------------------------------------------------------------
// Execute code via the sandbox Jupyter REST API
// ---------------------------------------------------------------------------

pub async fn execute_via_sandbox(
    base_url: &str,
    session_id: Option<&str>,
    code: &str,
    timeout_secs: u64,
) -> Result<SandboxExecutionResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs + 10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let url = format!("{base_url}/v1/jupyter/execute");
    let body = ExecuteRequest {
        code,
        session_id,
        timeout: timeout_secs,
    };

    let response =
        client.post(&url).json(&body).send().await.map_err(|e| {
            format!("Failed to reach sandbox: {e}. Is the sandbox container running?")
        })?;

    let api_response: SandboxApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse sandbox response: {e}"))?;

    if !api_response.success {
        let msg = api_response
            .message
            .unwrap_or_else(|| "Sandbox returned an error".to_string());
        return Err(msg);
    }

    let data = api_response
        .data
        .ok_or("Sandbox returned success but no data")?;

    // Map Jupyter kernel output messages → our OutputItem / ExecutionResult fields
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut outputs: Vec<OutputItem> = Vec::new();
    let mut error: Option<String> = None;

    for out in data.outputs {
        match out.output_type.as_str() {
            // ── stream ──────────────────────────────────────────────────────
            "stream" => {
                let text = out.text.unwrap_or_default();
                match out.name.as_deref() {
                    Some("stderr") => stderr.push_str(&text),
                    _ => stdout.push_str(&text),
                }
            }

            // ── display_data / execute_result ────────────────────────────
            "display_data" | "execute_result" => {
                if let Some(mime_map) = out.data {
                    // Prefer image/png first, then html, then plain text
                    if let Some(png) = mime_map.get("image/png").and_then(|v| v.as_str()) {
                        outputs.push(OutputItem::Image {
                            data: png.trim().to_string(),
                        });
                    } else if let Some(html) = mime_map.get("text/html").and_then(|v| v.as_str()) {
                        outputs.push(OutputItem::Html {
                            data: html.to_string(),
                        });
                    } else if let Some(plain) = mime_map.get("text/plain").and_then(|v| v.as_str())
                    {
                        outputs.push(OutputItem::Text {
                            data: plain.to_string(),
                        });
                    }
                }
            }

            // ── error ────────────────────────────────────────────────────
            "error" => {
                let ename = out.ename.unwrap_or_default();
                let evalue = out.evalue.unwrap_or_default();
                let tb = out.traceback.unwrap_or_default();
                // Strip ANSI escape codes from traceback lines
                let clean_tb: Vec<String> = tb.iter().map(|l| strip_ansi(l)).collect();
                let msg = format!("{ename}: {evalue}\n{}", clean_tb.join("\n"));
                error = Some(msg);
            }

            _ => {} // ignore unknown output types
        }
    }

    Ok(SandboxExecutionResult {
        session_id: data.session_id,
        result: ExecutionResult {
            stdout,
            stderr,
            outputs,
            error,
        },
    })
}

// ---------------------------------------------------------------------------
// Sandbox status (for the check_sandbox_status command)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    pub docker_available: bool,
    pub sandbox_ready: bool,
    pub sandbox_url: String,
    pub debug_info: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Remove ANSI escape sequences (e.g. \x1b[31m, OSC \x1b]...\x07, single-char \x1bX) from a string.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some(&'[') => {
                    // CSI sequence: consume until a letter
                    chars.next();
                    for nc in chars.by_ref() {
                        if nc.is_ascii_alphabetic() {
                            break;
                        }
                    }
                }
                Some(&']') => {
                    // OSC sequence: consume until BEL (\x07) or ST (\x1b\\)
                    chars.next();
                    while let Some(nc) = chars.next() {
                        if nc == '\x07' {
                            break;
                        }
                        if nc == '\x1b' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                Some(nc) if nc.is_ascii_alphabetic() => {
                    // Single-char escape (e.g. \x1bM): consume the letter
                    chars.next();
                }
                _ => {
                    // Unknown escape, skip
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn find_docker_binary() -> Option<String> {
    let candidates: Vec<&str> = if cfg!(target_os = "windows") {
        vec![
            "docker",
            r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
        ]
    } else {
        vec!["docker"]
    };

    for candidate in candidates {
        let result = Command::new(candidate).arg("--version").output();
        if result.is_ok() {
            return Some(candidate.to_string());
        }
    }
    None
}
