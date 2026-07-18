#[cfg(windows)]
use std::path::Prefix;
use std::path::{Component, Path, PathBuf};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
use std::ffi::OsStr;

#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

/// Normalizes file paths by handling path components, prefixes, and resolving relative paths
/// Based on: https://github.com/rust-lang/cargo/blob/rust-1.67.0/crates/cargo-util/src/paths.rs#L82-L107
pub fn normalize_path(path: &Path) -> PathBuf {
    let mut components = path.components().peekable();
    let mut ret = if let Some(c @ Component::Prefix(_prefix_component)) = components.peek().cloned()
    {
        #[cfg(windows)]
        // Remove only the Verbatim prefix, but keep the drive letter (e.g., C:\)
        match _prefix_component.kind() {
            Prefix::VerbatimDisk(disk) => {
                components.next(); // skip this prefix
                                   // Re-add the disk prefix (e.g., C:)
                let mut pb = PathBuf::new();
                pb.push(format!("{}:", disk as char));
                pb
            }
            Prefix::Verbatim(_) | Prefix::VerbatimUNC(_, _) => {
                components.next(); // skip this prefix
                PathBuf::new()
            }
            _ => {
                components.next();
                PathBuf::from(c.as_os_str())
            }
        }
        #[cfg(not(windows))]
        {
            components.next(); // skip this prefix
            PathBuf::from(c.as_os_str())
        }
    } else {
        PathBuf::new()
    };

    for component in components {
        match component {
            Component::Prefix(..) => unreachable!(),
            Component::RootDir => {
                ret.push(component.as_os_str());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if !ret.pop() {
                    ret.push(component.as_os_str());
                }
            }
            Component::Normal(c) => {
                ret.push(c);
            }
        }
    }
    ret
}

/// Removes file:/ and file:\ prefixes from file paths
pub fn normalize_file_path(path: &str) -> String {
    path.strip_prefix("file:/")
        .or_else(|| path.strip_prefix("file:\\"))
        .unwrap_or(path)
        .to_string()
}

/// Removes a path prefix only on a segment boundary.
///
/// `/v1` is stripped from `/v1/messages` → `/messages`, but not from
/// `/v10/messages` or `/v1messages` (those keep the original path).
pub fn remove_prefix(path: &str, prefix: &str) -> String {
    if prefix.is_empty() || !path.starts_with(prefix) {
        return path.to_string();
    }

    let rest = &path[prefix.len()..];
    // Require an exact match or a following `/` so longer first segments
    // (e.g. `/v10`, `/v1messages`) are not partially stripped.
    if !rest.is_empty() && !rest.starts_with('/') {
        return path.to_string();
    }

    if rest.is_empty() {
        "/".to_string()
    } else {
        rest.to_string()
    }
}

/// Get Windows short path to avoid issues with spaces and special characters
#[cfg(windows)]
pub fn get_short_path<P: AsRef<std::path::Path>>(path: P) -> Option<String> {
    let wide: Vec<u16> = OsStr::new(path.as_ref())
        .encode_wide()
        .chain(Some(0))
        .collect();

    let mut buffer = vec![0u16; 260];
    let len = unsafe { GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };

    if len > 0 {
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::remove_prefix;

    #[test]
    fn remove_prefix_strips_exact_segment_boundary() {
        assert_eq!(remove_prefix("/v1/messages", "/v1"), "/messages");
        assert_eq!(
            remove_prefix("/v1/messages/threads/123", "/v1"),
            "/messages/threads/123"
        );
        assert_eq!(remove_prefix("/api/v1/messages", "/api/v1"), "/messages");
        assert_eq!(remove_prefix("/v1", "/v1"), "/");
    }

    #[test]
    fn remove_prefix_does_not_strip_longer_first_segment() {
        // Regression: starts_with("/v1") must not rewrite /v10 or /v1messages.
        assert_eq!(remove_prefix("/v10/messages", "/v1"), "/v10/messages");
        assert_eq!(remove_prefix("/v1messages", "/v1"), "/v1messages");
        assert_eq!(remove_prefix("/messages", "/v1"), "/messages");
        assert_eq!(remove_prefix("/messages", ""), "/messages");
    }

    #[cfg(windows)]
    use super::get_short_path;

    #[cfg(windows)]
    #[test]
    fn test_get_short_path() {
        // Test with a real path that should exist on Windows
        use std::env;
        if let Ok(temp_dir) = env::var("TEMP") {
            let result = get_short_path(&temp_dir);
            // Should return some short path or None (both are valid)
            // We can't assert the exact value as it depends on the system
            println!("Short path result: {:?}", result);
        }
    }

    #[cfg(windows)]
    #[test]
    fn test_normalize_path_strips_verbatim_disk_prefix() {
        let base = super::normalize_path(std::path::Path::new(
            r"\\?\C:\Users\devop\AppData\Roaming\AX Studio\data",
        ));
        let candidate = super::normalize_path(std::path::Path::new(
            r"\\?\C:\Users\devop\AppData\Roaming\AX Studio\data\llamacpp\models",
        ));

        assert_eq!(
            base,
            std::path::PathBuf::from(r"C:\Users\devop\AppData\Roaming\AX Studio\data")
        );
        assert!(candidate.starts_with(&base));
    }
}
