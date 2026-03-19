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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_output_item_image_serialization() {
        let item = OutputItem::Image {
            data: "base64data".to_string(),
        };
        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["type"], "image");
        assert_eq!(json["data"], "base64data");
    }

    #[test]
    fn test_output_item_html_serialization() {
        let item = OutputItem::Html {
            data: "<table></table>".to_string(),
        };
        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["type"], "html");
        assert_eq!(json["data"], "<table></table>");
    }

    #[test]
    fn test_output_item_text_serialization() {
        let item = OutputItem::Text {
            data: "hello".to_string(),
        };
        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["type"], "text");
        assert_eq!(json["data"], "hello");
    }

    #[test]
    fn test_output_item_deserialization() {
        let json_str = r#"{"type": "image", "data": "abc123"}"#;
        let item: OutputItem = serde_json::from_str(json_str).unwrap();
        match item {
            OutputItem::Image { data } => assert_eq!(data, "abc123"),
            _ => panic!("Expected Image variant"),
        }
    }

    #[test]
    fn test_execution_result_success() {
        let result = ExecutionResult {
            stdout: "output".to_string(),
            stderr: "".to_string(),
            outputs: vec![],
            error: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["stdout"], "output");
        assert_eq!(json["stderr"], "");
        assert!(json["outputs"].as_array().unwrap().is_empty());
        assert!(json["error"].is_null());
    }

    #[test]
    fn test_execution_result_with_error() {
        let result = ExecutionResult {
            stdout: "".to_string(),
            stderr: "traceback".to_string(),
            outputs: vec![],
            error: Some("Process exited with code 1".to_string()),
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["error"], "Process exited with code 1");
        assert_eq!(json["stderr"], "traceback");
    }

    #[test]
    fn test_execution_result_with_outputs() {
        let result = ExecutionResult {
            stdout: "".to_string(),
            stderr: "".to_string(),
            outputs: vec![
                OutputItem::Text {
                    data: "line1".to_string(),
                },
                OutputItem::Image {
                    data: "img".to_string(),
                },
            ],
            error: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        let outputs = json["outputs"].as_array().unwrap();
        assert_eq!(outputs.len(), 2);
        assert_eq!(outputs[0]["type"], "text");
        assert_eq!(outputs[1]["type"], "image");
    }

    #[test]
    fn test_sandbox_status_serialization() {
        let status = SandboxStatus {
            python_available: true,
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["pythonAvailable"], true);
    }
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
