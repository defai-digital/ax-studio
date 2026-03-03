use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::Command;
use std::time::Duration;

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

/// The JSON structure the Python harness writes to stdout.
#[derive(Debug, Deserialize)]
struct HarnessOutput {
    stdout: String,
    stderr: String,
    outputs: Vec<serde_json::Value>,
    error: Option<String>,
}

/// Python harness script that wraps user code.
/// It is written to a separate temp file.  The user code file path is
/// injected at the placeholder `__CODE_FILE__`.
const HARNESS_TEMPLATE: &str = r#"
import sys
import os
import io
import json
import base64
import traceback

# -------------------------------------------------------------------
# 1. Force matplotlib non-interactive backend before any import
# -------------------------------------------------------------------
os.environ.setdefault("MPLBACKEND", "Agg")

# -------------------------------------------------------------------
# 2. Capture stdout / stderr
# -------------------------------------------------------------------
_stdout_buf = io.StringIO()
_stderr_buf = io.StringIO()
_outputs = []   # list of dicts: {type, data}

# -------------------------------------------------------------------
# 3. Monkey-patch plt.show() so figures are captured automatically
# -------------------------------------------------------------------
def _capture_figures():
    try:
        import matplotlib.pyplot as plt
        for fn in plt.get_fignums():
            fig = plt.figure(fn)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
            buf.seek(0)
            _outputs.append({
                "type": "image",
                "data": base64.b64encode(buf.read()).decode(),
            })
        plt.close("all")
    except Exception:
        pass

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    _orig_show = plt.show
    def _patched_show(*args, **kwargs):
        _capture_figures()
    plt.show = _patched_show
except ImportError:
    pass

# -------------------------------------------------------------------
# 4. Redirect stdout / stderr
# -------------------------------------------------------------------
_real_stdout = sys.stdout
_real_stderr = sys.stderr
sys.stdout = _stdout_buf
sys.stderr = _stderr_buf

# -------------------------------------------------------------------
# 5. Execute user code
# -------------------------------------------------------------------
_exec_globals = {"__name__": "__main__", "__file__": "__code_file__"}
_exec_error = None

try:
    with open("__CODE_FILE__", "r", encoding="utf-8") as _f:
        _user_code = _f.read()
    exec(compile(_user_code, "__code_file__", "exec"), _exec_globals)
except Exception:
    _exec_error = traceback.format_exc()
    _stderr_buf.write(_exec_error)

# -------------------------------------------------------------------
# 6. Capture any remaining open figures
# -------------------------------------------------------------------
_capture_figures()

# -------------------------------------------------------------------
# 7. Check for HTML outputs (pandas DataFrames, etc.)
# -------------------------------------------------------------------
try:
    import pandas as pd
    for _var in _exec_globals.values():
        if isinstance(_var, pd.DataFrame):
            _outputs.append({
                "type": "html",
                "data": _var.to_html(classes="dataframe", border=0, max_rows=50),
            })
except ImportError:
    pass

# -------------------------------------------------------------------
# 8. Restore stdout / stderr and emit JSON result
# -------------------------------------------------------------------
sys.stdout = _real_stdout
sys.stderr = _real_stderr

_result = {
    "stdout": _stdout_buf.getvalue(),
    "stderr": _stderr_buf.getvalue(),
    "outputs": _outputs,
    "error": _exec_error,
}
print(json.dumps(_result))
"#;

/// Locate the Python executable on the current platform.
fn find_python() -> Option<String> {
    let candidates = if cfg!(target_os = "windows") {
        vec!["python", "python3", "py"]
    } else {
        vec!["python3", "python"]
    };

    for candidate in candidates {
        let result = Command::new(candidate).arg("--version").output();
        if result.is_ok() {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Execute arbitrary Python code and return structured output.
#[tauri::command]
pub async fn execute_python_code(code: String) -> Result<ExecutionResult, String> {
    // Locate Python
    let python = find_python().ok_or_else(|| {
        "Python not found. Please install Python 3 and make sure it is in your PATH.".to_string()
    })?;

    // Create a temporary directory for this execution
    let tmp_dir = std::env::temp_dir().join(format!(
        "ax_cee_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos()
    ));
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let code_file = tmp_dir.join("user_code.py");
    let harness_file = tmp_dir.join("harness.py");

    // Write user code
    {
        let mut f = std::fs::File::create(&code_file)
            .map_err(|e| format!("Failed to write code file: {e}"))?;
        f.write_all(code.as_bytes())
            .map_err(|e| format!("Failed to write code: {e}"))?;
    }

    // Write harness with the code file path injected
    let code_path_str = code_file.to_string_lossy().replace('\\', "\\\\");
    let harness = HARNESS_TEMPLATE.replace("__CODE_FILE__", &code_path_str);
    {
        let mut f = std::fs::File::create(&harness_file)
            .map_err(|e| format!("Failed to write harness file: {e}"))?;
        f.write_all(harness.as_bytes())
            .map_err(|e| format!("Failed to write harness: {e}"))?;
    }

    // Run Python with a 30-second timeout
    let output = run_with_timeout(&python, &harness_file.to_string_lossy(), Duration::from_secs(30))?;

    // Clean up temp files
    let _ = std::fs::remove_dir_all(&tmp_dir);

    // Parse harness JSON output from stdout
    let raw_stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let raw_stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // The harness writes JSON on a single line; find it
    let json_line = raw_stdout
        .lines()
        .find(|l| l.trim_start().starts_with('{'))
        .unwrap_or("");

    if json_line.is_empty() {
        // Harness itself may have failed (syntax error, missing deps)
        let err_msg = if !raw_stderr.is_empty() {
            raw_stderr.clone()
        } else {
            raw_stdout.clone()
        };
        return Ok(ExecutionResult {
            stdout: String::new(),
            stderr: err_msg.clone(),
            outputs: vec![],
            error: Some(err_msg),
        });
    }

    let harness_output: HarnessOutput =
        serde_json::from_str(json_line).map_err(|e| format!("Failed to parse harness output: {e}\nRaw: {json_line}"))?;

    // Convert harness outputs to typed OutputItems
    let outputs = harness_output
        .outputs
        .into_iter()
        .filter_map(|item| {
            let type_str = item.get("type")?.as_str()?;
            let data = item.get("data")?.as_str()?.to_string();
            match type_str {
                "image" => Some(OutputItem::Image { data }),
                "html" => Some(OutputItem::Html { data }),
                "text" => Some(OutputItem::Text { data }),
                _ => None,
            }
        })
        .collect();

    Ok(ExecutionResult {
        stdout: harness_output.stdout,
        stderr: harness_output.stderr,
        outputs,
        error: harness_output.error,
    })
}

/// Run Python with the given script file and a wall-clock timeout.
fn run_with_timeout(python: &str, script_path: &str, timeout: Duration) -> Result<std::process::Output, String> {
    use std::sync::mpsc;
    use std::thread;

    let python = python.to_string();
    let script_path = script_path.to_string();

    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let result = Command::new(&python)
            .arg(&script_path)
            .output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(format!("Failed to run Python: {e}")),
        Err(_) => Err(format!(
            "Code execution timed out after {} seconds.",
            timeout.as_secs()
        )),
    }
}
