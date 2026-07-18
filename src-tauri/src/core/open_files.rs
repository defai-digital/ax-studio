//! OS file-open requests — macOS Dock drops / "Open" (`RunEvent::Opened`)
//! and Windows "Open with" (process argv) — routed to the frontend so the
//! files land as attachments on a new chat.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::core::state::AppState;

/// Tauri event the frontend listens for when files arrive while it is running.
pub const DOCK_FILE_DROP_EVENT: &str = "dock-file-drop";

/// Cold-start buffer for file-open requests that arrive before the frontend
/// has mounted. The frontend drains it once via `take_pending_open_files`,
/// which also flips `frontend_ready` — later requests go straight to the
/// `dock-file-drop` event instead.
#[derive(Default)]
pub struct PendingOpenFiles {
    paths: Mutex<Vec<String>>,
    frontend_ready: AtomicBool,
}

impl PendingOpenFiles {
    fn push(&self, paths: Vec<String>) {
        let mut guard = self
            .paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.extend(paths);
    }

    /// Take-once semantics: returns everything buffered so far and marks the
    /// frontend ready, so subsequent open requests are emitted as events.
    fn take(&self) -> Vec<String> {
        self.frontend_ready.store(true, Ordering::SeqCst);
        let mut guard = self
            .paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::take(&mut *guard)
    }
}

/// Convert `RunEvent::Opened` URLs into filesystem paths, dropping anything
/// that is not a local file URL.
pub fn paths_from_opened_urls(urls: Vec<url::Url>) -> Vec<String> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Extract existing file paths from process argv (Windows "Open with"):
/// skips the binary name (argv[0]) and any flag-like argument, and keeps
/// only arguments that point at an existing file.
pub fn extract_file_paths_from_argv(argv: &[String]) -> Vec<String> {
    argv.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| Path::new(arg).is_file())
        .cloned()
        .collect()
}

/// Route freshly opened paths: emit to the frontend when it is up and the
/// main window exists, otherwise buffer for `take_pending_open_files`.
pub fn handle_opened_paths(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let state = app.state::<AppState>();
    let frontend_ready = state
        .pending_open_files
        .frontend_ready
        .load(Ordering::SeqCst);
    match (frontend_ready, app.get_webview_window("main")) {
        (true, Some(window)) => {
            if let Err(e) = window.emit(DOCK_FILE_DROP_EVENT, &paths) {
                log::error!("Failed to emit {DOCK_FILE_DROP_EVENT}: {e}");
            }
        }
        _ => {
            log::info!(
                "Buffering {} open-file path(s) until the frontend is ready",
                paths.len()
            );
            state.pending_open_files.push(paths);
        }
    }
}

/// Drains the cold-start buffer (take-once) and marks the frontend ready so
/// subsequent OS open requests arrive via the `dock-file-drop` event.
#[tauri::command]
pub fn take_pending_open_files(state: tauri::State<'_, AppState>) -> Vec<String> {
    state.pending_open_files.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_from_opened_urls_keeps_only_local_files() {
        let urls = vec![
            url::Url::parse("file:///Users/alice/Documents/report.pdf").unwrap(),
            url::Url::parse("https://example.com/not-a-file.pdf").unwrap(),
            url::Url::parse("ax-studio://deeplink").unwrap(),
        ];
        let paths = paths_from_opened_urls(urls);
        assert_eq!(paths, vec!["/Users/alice/Documents/report.pdf"]);
    }

    #[test]
    fn paths_from_opened_urls_handles_spaces_and_unicode() {
        let urls =
            vec![url::Url::parse("file:///Users/alice/My%20Documents/n%C3%A9%20file.txt").unwrap()];
        let paths = paths_from_opened_urls(urls);
        assert_eq!(paths, vec!["/Users/alice/My Documents/né file.txt"]);
    }

    #[test]
    fn extract_file_paths_from_argv_skips_binary_name_and_flags() {
        let dir = std::env::temp_dir().join("ax-studio-open-files-test");
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("notes.txt");
        std::fs::write(&target, "hello").unwrap();
        let target_str = target.to_string_lossy().into_owned();

        let argv = vec![
            "/Applications/AX Studio.app/Contents/MacOS/ax-studio".to_string(),
            "--verbose".to_string(),
            "-x".to_string(),
            target_str.clone(),
            "/definitely/does/not/exist.pdf".to_string(),
        ];

        assert_eq!(extract_file_paths_from_argv(&argv), vec![target_str]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn extract_file_paths_from_argv_empty_and_flag_only() {
        assert!(extract_file_paths_from_argv(&[]).is_empty());
        let argv = vec!["ax-studio".to_string(), "--single-instance".to_string()];
        assert!(extract_file_paths_from_argv(&argv).is_empty());
    }

    #[test]
    fn pending_open_files_take_is_take_once_and_marks_ready() {
        let pending = PendingOpenFiles::default();
        assert!(!pending.frontend_ready.load(Ordering::SeqCst));

        pending.push(vec!["/tmp/a.pdf".to_string()]);
        pending.push(vec!["/tmp/b.png".to_string(), "/tmp/c.txt".to_string()]);

        let taken = pending.take();
        assert_eq!(taken, vec!["/tmp/a.pdf", "/tmp/b.png", "/tmp/c.txt"]);
        assert!(pending.frontend_ready.load(Ordering::SeqCst));

        // Second take returns nothing — the buffer was drained.
        assert!(pending.take().is_empty());
    }
}
