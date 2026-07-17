use std::{fs, io, path::Path};

#[cfg(test)]
use std::path::PathBuf;

const MAX_COPY_DEPTH: usize = 128;
const MAX_COPY_ENTRIES: usize = 1_000_000;

fn invalid_copy_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn copy_dir_recursive_inner(
    source_root: &std::path::Path,
    src: &std::path::Path,
    dst: &std::path::Path,
    exclude_dirs: &[&str],
    depth: usize,
    copied_entries: &mut usize,
) -> Result<(), io::Error> {
    if depth > MAX_COPY_DEPTH {
        return Err(invalid_copy_data(format!(
            "Directory tree exceeds the maximum depth of {MAX_COPY_DEPTH}"
        )));
    }
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        *copied_entries = copied_entries
            .checked_add(1)
            .filter(|count| *count <= MAX_COPY_ENTRIES)
            .ok_or_else(|| {
                invalid_copy_data(format!(
                    "Directory tree exceeds the maximum of {MAX_COPY_ENTRIES} entries"
                ))
            })?;

        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            if entry
                .file_name()
                .to_str()
                .is_some_and(|name| exclude_dirs.contains(&name))
            {
                continue;
            }
            copy_dir_recursive_inner(
                source_root,
                &src_path,
                &dst_path,
                exclude_dirs,
                depth + 1,
                copied_entries,
            )?;
        } else if file_type.is_file() {
            fs::copy(&src_path, &dst_path)?;
        } else if file_type.is_symlink() {
            // Dereference internal file symlinks so relocation works on every
            // platform without requiring symlink privileges. Never follow a
            // link outside the managed source tree or a directory link that
            // could introduce cycles.
            let target = fs::canonicalize(&src_path)?;
            if !target.starts_with(source_root) {
                return Err(invalid_copy_data(format!(
                    "Refusing to copy symlink outside the data folder: {}",
                    src_path.display()
                )));
            }
            if !target.is_file() {
                return Err(invalid_copy_data(format!(
                    "Refusing to copy non-file symlink: {}",
                    src_path.display()
                )));
            }
            fs::copy(target, &dst_path)?;
        } else {
            return Err(invalid_copy_data(format!(
                "Refusing to copy special filesystem entry: {}",
                src_path.display()
            )));
        }
    }

    Ok(())
}

/// Recursively copy a directory from src to dst, excluding specified directories
pub fn copy_dir_recursive(src: &Path, dst: &Path, exclude_dirs: &[&str]) -> Result<(), io::Error> {
    let source_root = fs::canonicalize(src)?;
    if !source_root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Copy source is not a directory",
        ));
    }
    let mut copied_entries = 0;
    copy_dir_recursive_inner(
        &source_root,
        &source_root,
        dst,
        exclude_dirs,
        0,
        &mut copied_entries,
    )
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
        assert_eq!(
            fs::read_to_string(dst.join("file1.txt")).unwrap(),
            "content1"
        );
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

    #[cfg(unix)]
    #[test]
    fn test_copy_dir_recursive_rejects_external_symlink() {
        use std::os::unix::fs::symlink;

        let tmp = make_temp_dir("external_symlink");
        let src = tmp.join("src");
        let dst = tmp.join("dst");
        let outside = tmp.join("outside.txt");
        fs::create_dir_all(&src).unwrap();
        fs::write(&outside, "private").unwrap();
        symlink(&outside, src.join("linked.txt")).unwrap();

        let error = copy_dir_recursive(&src, &dst, &[]).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(!dst.join("linked.txt").exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn test_copy_dir_recursive_dereferences_internal_file_symlink() {
        use std::os::unix::fs::symlink;

        let tmp = make_temp_dir("internal_symlink");
        let src = tmp.join("src");
        let dst = tmp.join("dst");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("target.txt"), "content").unwrap();
        symlink("target.txt", src.join("linked.txt")).unwrap();

        copy_dir_recursive(&src, &dst, &[]).unwrap();
        assert_eq!(
            fs::read_to_string(dst.join("linked.txt")).unwrap(),
            "content"
        );
        assert!(!fs::symlink_metadata(dst.join("linked.txt"))
            .unwrap()
            .file_type()
            .is_symlink());

        let _ = fs::remove_dir_all(&tmp);
    }
}
