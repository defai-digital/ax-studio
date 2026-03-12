use std::process::{Command, Output, Stdio};
use std::time::Duration;

use super::commands::ExecutionResult;

/// Find a working Python binary on the system.
fn find_python_binary() -> Option<String> {
    let candidates: Vec<&str> = if cfg!(target_os = "windows") {
        vec!["python", "python3", "py"]
    } else {
        vec!["python3", "python"]
    };

    for candidate in candidates {
        let result = Command::new(candidate).arg("--version").output();
        if let Ok(out) = result {
            if out.status.success() {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

/// Check whether Python is available on the host.
pub fn is_python_available() -> bool {
    find_python_binary().is_some()
}

/// Kill a process and all its descendants. Best-effort — errors are silently ignored.
///
/// On Unix the Python process is spawned as a process group leader (see
/// `execute_python`), so sending SIGKILL to the negative PID kills the entire
/// group — including any child/grandchild processes Python may have spawned.
/// On Windows the `/T` flag tells `taskkill` to kill the process tree.
fn kill_process_tree(pid: u32) {
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        // Negative PID = send signal to entire process group
        let _ = kill(Pid::from_raw(-(pid as i32)), Signal::SIGKILL);
    }
    #[cfg(windows)]
    {
        // /T = kill process tree, /F = force
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
}

/// Build an ExecutionResult from a completed process Output.
fn build_result(output: Output) -> ExecutionResult {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let error = if !output.status.success() {
        Some(if stderr.is_empty() {
            format!(
                "Process exited with code {}",
                output.status.code().unwrap_or(-1)
            )
        } else {
            stderr.clone()
        })
    } else {
        None
    };

    ExecutionResult {
        stdout,
        stderr,
        outputs: vec![],
        error,
    }
}

/// Execute Python code on the host with a hard timeout.
///
/// Spawns `python3 -u -c <code>`, waits up to `timeout_secs` for completion,
/// then kills the process if it hasn't finished.
pub async fn execute_python(code: &str, timeout_secs: u64) -> Result<ExecutionResult, String> {
    let python =
        find_python_binary().ok_or("Python not found. Please install Python and add it to PATH.")?;

    let mut cmd = Command::new(&python);
    cmd.args(["-u", "-c", code])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Make Python a process group leader so that kill_process_tree() can
    // kill the entire group (Python + any subprocesses it spawned).
    // Same pattern as tauri-plugin-llamacpp/src/commands.rs.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: setpgid is async-signal-safe and permitted between fork/exec.
        unsafe {
            cmd.pre_exec(|| {
                nix::unistd::setpgid(nix::unistd::Pid::from_raw(0), nix::unistd::Pid::from_raw(0))
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
            });
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Python: {e}"))?;

    let pid = child.id();
    let timeout = Duration::from_secs(timeout_secs);

    // child.wait_with_output() is blocking, so run it on the blocking thread pool.
    // Wrap the whole thing in a timeout so we can kill the process if it hangs.
    let result = tokio::time::timeout(
        timeout,
        tokio::task::spawn_blocking(move || child.wait_with_output()),
    )
    .await;

    match result {
        // Completed within timeout
        Ok(Ok(Ok(output))) => Ok(build_result(output)),
        // Process I/O error
        Ok(Ok(Err(e))) => Err(format!("Process error: {e}")),
        // spawn_blocking join error
        Ok(Err(e)) => Err(format!("Task join error: {e}")),
        // Timeout expired — kill the process
        Err(_) => {
            kill_process_tree(pid);
            Err(format!(
                "Execution timed out after {timeout_secs} seconds. The process was terminated."
            ))
        }
    }
}
