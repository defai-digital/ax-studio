use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

type ProcessMap = Arc<Mutex<HashMap<String, Child>>>;

lazy_static::lazy_static! {
    static ref PROCESSES: ProcessMap = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(serde::Serialize, Clone)]
pub struct AgentEvent {
    pub session_id: String,
    pub kind: String, // "line" | "done" | "error"
    pub data: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct AxAgent {
    pub id: String,
    pub description: String,
    pub team: String,
    pub enabled: bool,
}

/// Check if `ax` CLI is installed and return its version string.
#[tauri::command]
pub async fn ax_check() -> Result<String, String> {
    fix_path_env::fix().ok();
    let output = Command::new("ax")
        .arg("--version")
        .output()
        .await
        .map_err(|_| "AutomatosX is not installed. Run: npm install -g @defai.digital/cli".to_string())?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    } else {
        Err("AutomatosX is not installed. Run: npm install -g @defai.digital/cli".to_string())
    }
}

/// List all available agents from `ax agent list`.
#[tauri::command]
pub async fn ax_list_agents() -> Result<Vec<AxAgent>, String> {
    fix_path_env::fix().ok();
    let output = Command::new("ax")
        .args(["agent", "list"])
        .output()
        .await
        .map_err(|e| format!("Failed to run ax: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut agents: Vec<AxAgent> = Vec::new();

    for line in stdout.lines().skip(2) { // skip header and separator
        let line = strip_ansi(line);
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() >= 4 {
            let id = parts[0].trim().to_string();
            let description = parts[1].trim().to_string();
            let team = parts[2].trim().to_string();
            let enabled = parts[3].trim().eq_ignore_ascii_case("yes");
            if !id.is_empty() {
                agents.push(AxAgent { id, description, team, enabled });
            }
        }
    }

    Ok(agents)
}

/// Run `ax agent run <agent_id> <task>` and stream stdout as Tauri events.
#[tauri::command]
pub async fn ax_run_agent(
    app: AppHandle,
    session_id: String,
    agent_id: String,
    task: String,
) -> Result<(), String> {
    fix_path_env::fix().ok();

    let input_json = format!(r#"{{"query":"{}"}}"#, task.replace('"', "\\\""));

    let mut child = Command::new("ax")
        .args([
            "agent", "run", &agent_id,
            "--provider", "opencode",
            "--input", &input_json,
            "--format", "json",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start AutomatosX: {e}. Is `ax` installed?"))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    {
        let mut map = PROCESSES.lock().unwrap();
        map.insert(session_id.clone(), child);
    }

    // Emit running status immediately
    let _ = app.emit("ax://agent", AgentEvent {
        session_id: session_id.clone(),
        kind: "line".to_string(),
        data: format!("Running agent: {} ...", agent_id),
    });

    // Collect stderr lines and emit as info lines
    let sid_err = session_id.clone();
    let app_err = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let clean = strip_ansi(&line);
            let trimmed = clean.trim().to_string();
            // Skip internal stub warnings — not useful for users
            if trimmed.is_empty()
                || trimmed.contains("stub checkpoint")
                || trimmed.contains("stub parallel")
            {
                continue;
            }
            let _ = app_err.emit("ax://agent", AgentEvent {
                session_id: sid_err.clone(),
                kind: "line".to_string(),
                data: trimmed,
            });
        }
    });

    // Collect all stdout, parse JSON result, emit the actual output
    let sid_done = session_id.clone();
    let app_done = app.clone();
    tokio::spawn(async move {
        let mut stdout_buf = String::new();
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            stdout_buf.push_str(&line);
            stdout_buf.push('\n');
        }

        // Wait for child to finish
        let mut child_opt = {
            let mut map = PROCESSES.lock().unwrap();
            map.remove(&sid_done)
        };
        if let Some(ref mut child) = child_opt {
            let _ = child.wait().await;
        }

        // Try to parse JSON output and extract the real AI response
        let output_text = parse_agent_output(&stdout_buf);

        let _ = app_done.emit("ax://agent", AgentEvent {
            session_id: sid_done.clone(),
            kind: "line".to_string(),
            data: output_text.clone(),
        });
        let _ = app_done.emit("ax://agent", AgentEvent {
            session_id: sid_done,
            kind: "done".to_string(),
            data: "Agent completed".to_string(),
        });
    });

    Ok(())
}

/// Kill a running ax process by session_id.
#[tauri::command]
pub async fn ax_stop(session_id: String) -> Result<(), String> {
    // Take child out of map before awaiting — MutexGuard is not Send.
    let child_opt = {
        let mut map = PROCESSES.lock().unwrap();
        map.remove(&session_id)
    };
    if let Some(mut child) = child_opt {
        child.kill().await.map_err(|e| format!("Failed to stop agent: {e}"))?;
    }
    Ok(())
}

/// Parse JSON output from `ax agent run --format json` and extract the AI response text.
/// The output is a map of step_name -> { content, provider, usage }.
/// We prefer: synthesize > analyze > scope > first available.
fn parse_agent_output(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "Agent returned no output.".to_string();
    }

    if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
        // data.output is the step map
        let output = val.pointer("/data/output").unwrap_or(&val);

        if let Some(obj) = output.as_object() {
            // Preferred step order
            for key in &["synthesize", "analyze", "scope"] {
                if let Some(content) = obj.get(*key).and_then(|s| s.get("content")).and_then(|c| c.as_str()) {
                    if !content.is_empty() {
                        return content.to_string();
                    }
                }
            }
            // Fall back to first step with content
            for (_, step) in obj {
                if let Some(content) = step.get("content").and_then(|c| c.as_str()) {
                    if !content.is_empty() {
                        return content.to_string();
                    }
                }
            }
        }

        // Try top-level string fields
        if let Some(s) = output.as_str() {
            return s.to_string();
        }
    }

    trimmed.to_string()
}

/// Strip ANSI escape codes from a string.
fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\x1b' && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            i += 2;
            while i < bytes.len() && !bytes[i].is_ascii_alphabetic() {
                i += 1;
            }
            i += 1;
        } else {
            result.push(s.chars().nth(i).unwrap_or(' '));
            i += 1;
        }
    }
    result
}
