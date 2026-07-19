//! Configure MLX to load its default Metal library from the signed app bundle.

use std::{
    ffi::CString,
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
};

extern "C" {
    fn ax_studio_mlx_set_metallib_path(path: *const std::ffi::c_char) -> std::ffi::c_int;
}

fn metallib_path_for_executable(executable: &Path) -> Option<PathBuf> {
    let macos_directory = executable.parent()?;
    if macos_directory.file_name()? != "MacOS" {
        // Tauri's development asset hook copies mlx.metallib beside the debug
        // executable, while libmlx itself is loaded from target/Frameworks.
        // MLX cannot infer that sibling location from the dylib, so configure
        // it explicitly just as we do for the signed application bundle.
        return Some(macos_directory.join("mlx.metallib"));
    }

    let contents_directory = macos_directory.parent()?;
    if contents_directory.file_name()? != "Contents" {
        return None;
    }

    let app_directory = contents_directory.parent()?;
    if app_directory.extension()? != "app" {
        return None;
    }

    Some(contents_directory.join("Resources").join("mlx.metallib"))
}

/// Point MLX at the prepared metallib before the worker can perform an MLX
/// operation. Release builds use the signed app resource; Tauri development
/// builds use the copy beside the debug executable.
pub fn configure_bundled_metallib() -> Result<Option<PathBuf>, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("failed to resolve the AX Studio executable: {error}"))?;
    let Some(metallib_path) = metallib_path_for_executable(&executable) else {
        return Ok(None);
    };

    if !metallib_path.is_file() {
        return Err(format!(
            "bundled MLX Metal library is missing: {}",
            metallib_path.display()
        ));
    }

    let native_path = CString::new(metallib_path.as_os_str().as_bytes())
        .map_err(|_| "bundled MLX Metal library path contains a NUL byte".to_string())?;
    // SAFETY: `native_path` is NUL-terminated and remains alive for the call.
    // The C++ bridge copies it into MLX's process-global std::string.
    let status = unsafe { ax_studio_mlx_set_metallib_path(native_path.as_ptr()) };
    if status != 0 {
        return Err(format!(
            "MLX rejected bundled Metal library {} (status {status})",
            metallib_path.display()
        ));
    }

    Ok(Some(metallib_path))
}

#[cfg(test)]
mod tests {
    use super::metallib_path_for_executable;
    use std::path::{Path, PathBuf};

    #[test]
    fn resolves_metallib_inside_a_macos_app_bundle() {
        assert_eq!(
            metallib_path_for_executable(Path::new(
                "/Applications/AX Studio.app/Contents/MacOS/ax-studio"
            )),
            Some(PathBuf::from(
                "/Applications/AX Studio.app/Contents/Resources/mlx.metallib"
            ))
        );
    }

    #[test]
    fn resolves_metallib_beside_a_development_executable() {
        assert_eq!(
            metallib_path_for_executable(Path::new("/repo/target/debug/ax-studio")),
            Some(PathBuf::from("/repo/target/debug/mlx.metallib"))
        );
    }
}
