//! Detect how the running desktop app was installed.
//!
//! Homebrew cask installs live under Caskroom (or are symlinked from
//! /Applications into Caskroom). In-app binary replacement desyncs brew, so
//! the UI should prefer `brew upgrade --cask ax-studio` for those installs.
//! When detection is uncertain, return `standalone` so the in-app updater
//! remains available (fail open for manual/DMG installs).

use std::path::{Path, PathBuf};

/// Install channel reported to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallChannel {
    Homebrew,
    Standalone,
    Unknown,
}

impl InstallChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Homebrew => "homebrew",
            Self::Standalone => "standalone",
            Self::Unknown => "unknown",
        }
    }
}

/// Resolve the channel from an executable path (typically `current_exe`).
///
/// Heuristics (macOS-focused; other OSes return Standalone):
/// 1. Real path contains `/Caskroom/ax-studio/` (any case for volume roots).
/// 2. Path walks through `Caskroom` + cask name `ax-studio`.
/// 3. Otherwise standalone.
pub fn detect_install_channel_from_exe(exe: &Path) -> InstallChannel {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = exe;
        return InstallChannel::Standalone;
    }

    #[cfg(target_os = "macos")]
    {
        detect_macos_channel(exe)
    }
}

#[cfg(target_os = "macos")]
fn detect_macos_channel(exe: &Path) -> InstallChannel {
    let candidates = path_candidates(exe);
    for path in candidates {
        if path_looks_like_homebrew_cask(&path) {
            return InstallChannel::Homebrew;
        }
    }
    InstallChannel::Standalone
}

/// Collect the original path, canonical path, and parent chain for matching.
fn path_candidates(exe: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.push(exe.to_path_buf());
    if let Ok(canonical) = exe.canonicalize() {
        if canonical != exe {
            out.push(canonical);
        }
    }
    out
}

/// True when the path is under a Homebrew Caskroom install of ax-studio.
pub fn path_looks_like_homebrew_cask(path: &Path) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();

    // Typical layouts:
    //   /opt/homebrew/Caskroom/ax-studio/2.2.0/AX Studio.app/Contents/MacOS/ax-studio
    //   /usr/local/Caskroom/ax-studio/...
    //   /Applications/AX Studio.app -> symlink into Caskroom (canonical covers this)
    if lower.contains("/caskroom/ax-studio/") {
        return true;
    }

    // Segment walk: .../Caskroom/ax-studio/<version>/...
    let components: Vec<_> = path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();
    for window in components.windows(2) {
        if window[0].eq_ignore_ascii_case("Caskroom")
            && window[1].eq_ignore_ascii_case("ax-studio")
        {
            return true;
        }
    }

    false
}

/// Detect from the running process executable.
pub fn detect_install_channel() -> InstallChannel {
    match std::env::current_exe() {
        Ok(exe) => detect_install_channel_from_exe(&exe),
        Err(err) => {
            log::warn!("Failed to resolve current_exe for install channel: {err}");
            InstallChannel::Unknown
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn caskroom_opt_homebrew_is_homebrew() {
        let path = PathBuf::from(
            "/opt/homebrew/Caskroom/ax-studio/2.2.0/AX Studio.app/Contents/MacOS/ax-studio",
        );
        assert!(path_looks_like_homebrew_cask(&path));
        #[cfg(target_os = "macos")]
        assert_eq!(
            detect_install_channel_from_exe(&path),
            InstallChannel::Homebrew
        );
    }

    #[test]
    fn caskroom_usr_local_is_homebrew() {
        let path = PathBuf::from(
            "/usr/local/Caskroom/ax-studio/1.0.0/AX Studio.app/Contents/MacOS/ax-studio",
        );
        assert!(path_looks_like_homebrew_cask(&path));
    }

    #[test]
    fn applications_standalone_is_not_homebrew() {
        let path =
            PathBuf::from("/Applications/AX Studio.app/Contents/MacOS/ax-studio");
        assert!(!path_looks_like_homebrew_cask(&path));
        #[cfg(target_os = "macos")]
        assert_eq!(
            detect_install_channel_from_exe(&path),
            InstallChannel::Standalone
        );
    }

    #[test]
    fn unrelated_caskroom_package_is_not_ax_studio() {
        let path = PathBuf::from(
            "/opt/homebrew/Caskroom/other-app/1.0.0/Other.app/Contents/MacOS/other",
        );
        assert!(!path_looks_like_homebrew_cask(&path));
    }

    #[test]
    fn channel_as_str() {
        assert_eq!(InstallChannel::Homebrew.as_str(), "homebrew");
        assert_eq!(InstallChannel::Standalone.as_str(), "standalone");
        assert_eq!(InstallChannel::Unknown.as_str(), "unknown");
    }
}
