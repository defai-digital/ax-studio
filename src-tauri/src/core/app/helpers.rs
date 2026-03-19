use std::{fs, io, path::PathBuf};

/// Recursively copy a directory from src to dst, excluding specified directories
pub fn copy_dir_recursive(
    src: &PathBuf,
    dst: &PathBuf,
    exclude_dirs: &[&str],
) -> Result<(), io::Error> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            // Skip excluded directories
            if let Some(dir_name) = entry.file_name().to_str() {
                if exclude_dirs.contains(&dir_name) {
                    continue;
                }
            }
            copy_dir_recursive(&src_path, &dst_path, exclude_dirs)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a unique temp directory for each test to avoid collisions.
    fn make_temp_dir(test_name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("ax_studio_test_helpers")
            .join(test_name);
        // Clean up from previous runs
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn create_test_tree(base: &std::path::Path) {
        fs::create_dir_all(base.join("sub")).unwrap();
        fs::create_dir_all(base.join("excluded")).unwrap();
        fs::write(base.join("file1.txt"), "content1").unwrap();
        fs::write(base.join("sub").join("file2.txt"), "content2").unwrap();
        fs::write(base.join("excluded").join("secret.txt"), "secret").unwrap();
    }

    #[test]
    fn test_copy_dir_recursive_basic() {
        let tmp = make_temp_dir("basic");
        let src = tmp.join("src");
        let dst = tmp.join("dst");
        fs::create_dir_all(&src).unwrap();
        create_test_tree(&src);

        copy_dir_recursive(&src, &dst, &[]).unwrap();

        assert!(dst.join("file1.txt").exists());
        assert!(dst.join("sub").join("file2.txt").exists());
        assert!(dst.join("excluded").join("secret.txt").exists());
        assert_eq!(fs::read_to_string(dst.join("file1.txt")).unwrap(), "content1");
        assert_eq!(
            fs::read_to_string(dst.join("sub").join("file2.txt")).unwrap(),
            "content2"
        );

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_copy_dir_recursive_excludes_dirs() {
        let tmp = make_temp_dir("excludes");
        let src = tmp.join("src");
        let dst = tmp.join("dst");
        fs::create_dir_all(&src).unwrap();
        create_test_tree(&src);

        copy_dir_recursive(&src, &dst, &["excluded"]).unwrap();

        assert!(dst.join("file1.txt").exists());
        assert!(dst.join("sub").join("file2.txt").exists());
        assert!(!dst.join("excluded").exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_copy_dir_recursive_creates_dst() {
        let tmp = make_temp_dir("creates_dst");
        let src = tmp.join("src");
        let dst = tmp.join("deeply").join("nested").join("dst");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("test.txt"), "hello").unwrap();

        copy_dir_recursive(&src, &dst, &[]).unwrap();

        assert!(dst.join("test.txt").exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_copy_dir_recursive_empty_source() {
        let tmp = make_temp_dir("empty_src");
        let src = tmp.join("empty_src");
        let dst = tmp.join("empty_dst");
        fs::create_dir_all(&src).unwrap();

        copy_dir_recursive(&src, &dst, &[]).unwrap();

        assert!(dst.exists());
        assert!(dst.is_dir());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_copy_dir_recursive_multiple_excludes() {
        let tmp = make_temp_dir("multi_exclude");
        let src = tmp.join("src");
        let dst = tmp.join("dst");
        fs::create_dir_all(&src).unwrap();
        create_test_tree(&src);
        fs::create_dir_all(src.join("node_modules")).unwrap();
        fs::write(src.join("node_modules").join("pkg.json"), "{}").unwrap();

        copy_dir_recursive(&src, &dst, &["excluded", "node_modules"]).unwrap();

        assert!(dst.join("file1.txt").exists());
        assert!(!dst.join("excluded").exists());
        assert!(!dst.join("node_modules").exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_copy_dir_recursive_nonexistent_src_returns_error() {
        let tmp = make_temp_dir("nonexistent");
        let src = tmp.join("does_not_exist");
        let dst = tmp.join("dst");

        let result = copy_dir_recursive(&src, &dst, &[]);
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&tmp);
    }
}
