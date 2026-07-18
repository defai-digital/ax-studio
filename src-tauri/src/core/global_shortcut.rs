//! Global wake hotkey handling (tech spec DESKTOP-NATIVE §2.A).
//!
//! The shortcut itself is registered/unregistered from the frontend via the
//! plugin's JS API (settings page remap + startup re-registration). The Rust
//! side only owns the plugin handler: toggle the main window visibility and
//! emit `global-wake` so the frontend can navigate home and focus the composer.

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutEvent, ShortcutState};

/// Event emitted when the hotkey wakes the app; the frontend listens for it
/// to navigate to `/` and focus the composer textarea.
pub const GLOBAL_WAKE_EVENT: &str = "global-wake";

/// Default combo — kept in sync with the frontend's persisted default.
/// Registration happens JS-side, so nothing in Rust reads this yet.
#[allow(dead_code)]
pub const DEFAULT_SHORTCUT: &str = "CmdOrCtrl+Shift+Space";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WakeAction {
    Hide,
    Wake,
}

/// Toggle decision: a visible, non-minimized window hides; hidden or
/// minimized windows run the wake sequence.
pub fn wake_action(is_visible: bool, is_minimized: bool) -> WakeAction {
    if is_visible && !is_minimized {
        WakeAction::Hide
    } else {
        WakeAction::Wake
    }
}

/// Plugin `with_handler` callback. Gated on `ShortcutState::Pressed` so a
/// single keypress does not fire the toggle twice (press + release).
pub fn handle_shortcut(app: &AppHandle, _shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let is_visible = window.is_visible().unwrap_or(false);
    let is_minimized = window.is_minimized().unwrap_or(false);
    match wake_action(is_visible, is_minimized) {
        WakeAction::Hide => {
            let _ = window.hide();
        }
        WakeAction::Wake => {
            // Same wake sequence as the tray click handler in setup.rs.
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit(GLOBAL_WAKE_EVENT, ());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visible_window_hides() {
        assert_eq!(wake_action(true, false), WakeAction::Hide);
    }

    #[test]
    fn hidden_or_minimized_window_wakes() {
        assert_eq!(wake_action(false, false), WakeAction::Wake);
        assert_eq!(wake_action(false, true), WakeAction::Wake);
        assert_eq!(wake_action(true, true), WakeAction::Wake);
    }

    #[test]
    fn event_name_and_default_shortcut_are_stable() {
        // The frontend listens for `global-wake` and persists this default;
        // renaming either is a breaking change across the Rust/TS boundary.
        assert_eq!(GLOBAL_WAKE_EVENT, "global-wake");
        assert_eq!(DEFAULT_SHORTCUT, "CmdOrCtrl+Shift+Space");
    }
}
