use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::time::SystemTime;

use ax_studio_utils::normalize_path;

#[cfg(target_os = "macos")]
pub const AX_NATIVE_MODEL_MANIFEST_FILE: &str = "model-manifest.json";

#[cfg(target_os = "macos")]
#[derive(Debug, Clone)]
pub struct CachedModelEntry {
    pub model_id: String,
    pub model_dir: PathBuf,
    pub has_manifest: bool,
    pub size_bytes: u64,
}

pub fn cache_root() -> Option<PathBuf> {
    if let Some(value) =
        non_empty_env("HF_HUB_CACHE").or_else(|| non_empty_env("HUGGINGFACE_HUB_CACHE"))
    {
        return Some(PathBuf::from(value));
    }

    if let Some(value) = non_empty_env("HF_HOME") {
        return Some(PathBuf::from(value).join("hub"));
    }

    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join(".cache")
            .join("huggingface")
            .join("hub"),
    )
}

#[cfg(target_os = "macos")]
pub fn repo_cache_dir(model_id: &str) -> Result<PathBuf, String> {
    validate_model_id(model_id)?;
    let root = cache_root()
        .ok_or_else(|| "HOME is not set; cannot resolve Hugging Face cache".to_string())?;
    Ok(root.join(format!("models--{}", model_id.replace('/', "--"))))
}

#[cfg(target_os = "macos")]
pub fn snapshot_dir(model_id: &str, revision: &str) -> Result<PathBuf, String> {
    validate_revision(revision)?;
    Ok(repo_cache_dir(model_id)?.join("snapshots").join(revision))
}

/// Reverse of hub dir naming: `models--org--name` → `org/name`.
#[cfg(target_os = "macos")]
pub fn model_id_from_repo_dir_name(dir_name: &str) -> Option<String> {
    let rest = dir_name.strip_prefix("models--")?;
    if rest.is_empty() {
        return None;
    }
    let model_id = rest.replace("--", "/");
    validate_model_id(&model_id).ok()?;
    Some(model_id)
}

/// Scan the Hugging Face hub cache for MLX/AX-ready model directories.
///
/// Prefers snapshot (or nested) dirs that contain `model-manifest.json`. Also
/// includes safetensors-only dirs so Studio can register them after generating
/// a manifest on first load.
#[cfg(target_os = "macos")]
pub fn list_cached_models() -> Vec<CachedModelEntry> {
    let Some(root) = cache_root() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };

    let mut models = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(model_id) = model_id_from_repo_dir_name(dir_name) else {
            continue;
        };
        let Some((model_dir, has_manifest, size_bytes)) = find_best_model_dir(&path) else {
            continue;
        };
        models.push(CachedModelEntry {
            model_id,
            model_dir,
            has_manifest,
            size_bytes,
        });
    }

    models.sort_by(|a, b| a.model_id.cmp(&b.model_id));
    models
}

/// Resolve the best local dir for a cached HF repo id.
/// Prefers dirs with AX `model-manifest.json`, then newest safetensors snapshot.
#[cfg(target_os = "macos")]
pub fn resolve_best_model_dir(model_id: &str) -> Option<PathBuf> {
    let repo_dir = repo_cache_dir(model_id).ok()?;
    find_best_model_dir(&repo_dir).map(|(path, _, _)| path)
}

#[cfg(target_os = "macos")]
fn find_best_model_dir(repo_dir: &Path) -> Option<(PathBuf, bool, u64)> {
    let snapshots = repo_dir.join("snapshots");
    let entries = std::fs::read_dir(&snapshots).ok()?;

    // Rank: (has_manifest, mtime, path, size)
    let mut best: Option<(bool, SystemTime, PathBuf, u64)> = None;

    for entry in entries.flatten() {
        let snapshot = entry.path();
        if !snapshot.is_dir() {
            continue;
        }
        consider_model_candidate(&snapshot, &mut best);

        // Nested layouts (e.g. snapshots/<rev>/assistant/)
        if let Ok(children) = std::fs::read_dir(&snapshot) {
            for child in children.flatten() {
                let child_path = child.path();
                if child_path.is_dir() {
                    consider_model_candidate(&child_path, &mut best);
                }
            }
        }
    }

    best.map(|(has_manifest, _, path, size_bytes)| (path, has_manifest, size_bytes))
}

#[cfg(target_os = "macos")]
fn consider_model_candidate(path: &Path, best: &mut Option<(bool, SystemTime, PathBuf, u64)>) {
    let has_manifest = path.join(AX_NATIVE_MODEL_MANIFEST_FILE).is_file();
    let has_weights = dir_contains_safetensors(path);
    if !has_manifest && !has_weights {
        return;
    }

    let mtime = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let size_bytes = estimate_safetensors_size(path);

    let replace = match best {
        None => true,
        Some((best_has_manifest, best_mtime, _, _)) => {
            // Prefer manifest-bearing dirs; among equals, newest mtime.
            has_manifest && !*best_has_manifest
                || has_manifest == *best_has_manifest && mtime > *best_mtime
        }
    };
    if replace {
        *best = Some((has_manifest, mtime, path.to_path_buf(), size_bytes));
    }
}

#[cfg(target_os = "macos")]
fn dir_contains_safetensors(path: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(path) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            return false; // only direct children for scan speed
        }
        entry_path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("safetensors"))
    })
}

#[cfg(target_os = "macos")]
fn estimate_safetensors_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let entry_path = entry.path();
            let is_st = entry_path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("safetensors"));
            if !is_st {
                return None;
            }
            entry.metadata().ok().map(|m| m.len())
        })
        .sum()
}

pub fn is_within_cache(path: &Path) -> bool {
    let Some(root) = cache_root() else {
        return false;
    };
    is_within_root(path, &root)
}

pub fn is_within_root(path: &Path, root: &Path) -> bool {
    let normalized_root = normalize_existing_or_parent(root);
    let normalized_path = normalize_existing_or_parent(path);
    normalized_path == normalized_root || normalized_path.starts_with(&normalized_root)
}

#[cfg(target_os = "macos")]
pub fn validate_model_id(model_id: &str) -> Result<(), String> {
    if model_id.is_empty()
        || model_id.contains("..")
        || !model_id.contains('/')
        || !model_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
        || model_id
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("invalid Hugging Face model id '{model_id}'"));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn validate_revision(revision: &str) -> Result<(), String> {
    if revision.is_empty()
        || revision.contains("..")
        || revision
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
    {
        return Err(format!("invalid Hugging Face revision '{revision}'"));
    }
    Ok(())
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

pub fn normalize_existing_or_parent(path: &Path) -> PathBuf {
    path.canonicalize()
        .map(|path| normalize_path(&path))
        .unwrap_or_else(|_| {
            if let Some(parent) = path.parent() {
                if let Ok(canonical_parent) = parent.canonicalize() {
                    if let Some(file_name) = path.file_name() {
                        return normalize_path(&canonical_parent.join(file_name));
                    }
                }
            }
            normalize_path(path)
        })
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{Duration, SystemTime};

    fn touch(path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(path, b"x").unwrap();
    }

    #[test]
    fn model_id_from_repo_dir_name_roundtrip() {
        assert_eq!(
            model_id_from_repo_dir_name("models--mlx-community--gemma-4-12B-it-4bit").as_deref(),
            Some("mlx-community/gemma-4-12B-it-4bit")
        );
        assert_eq!(
            model_id_from_repo_dir_name("models--ax-local--mlx-community--Qwen3.6-27B-6bit-MTP")
                .as_deref(),
            Some("ax-local/mlx-community/Qwen3.6-27B-6bit-MTP")
        );
        assert!(model_id_from_repo_dir_name("blobs").is_none());
    }

    #[test]
    fn find_best_model_dir_prefers_manifest() {
        let root = std::env::temp_dir().join(format!(
            "ax-hf-cache-test-{}",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or(Duration::from_secs(0))
                .as_nanos()
        ));
        let snapshots = root.join("snapshots");
        let older = snapshots.join("aaaa");
        let newer = snapshots.join("bbbb");
        fs::create_dir_all(&older).unwrap();
        fs::create_dir_all(&newer).unwrap();
        touch(&older.join("model.safetensors"));
        touch(&older.join(AX_NATIVE_MODEL_MANIFEST_FILE));
        touch(&newer.join("model.safetensors"));
        // newer has weights only — older has manifest and should win
        let (path, has_manifest, _) = find_best_model_dir(&root).expect("candidate");
        assert!(has_manifest);
        assert_eq!(path, older);
        let _ = fs::remove_dir_all(&root);
    }
}
