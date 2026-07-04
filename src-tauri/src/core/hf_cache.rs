use std::path::{Path, PathBuf};

use ax_studio_utils::normalize_path;

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

pub fn repo_cache_dir(model_id: &str) -> Result<PathBuf, String> {
    validate_model_id(model_id)?;
    let root = cache_root()
        .ok_or_else(|| "HOME is not set; cannot resolve Hugging Face cache".to_string())?;
    Ok(root.join(format!("models--{}", model_id.replace('/', "--"))))
}

pub fn snapshot_dir(model_id: &str, revision: &str) -> Result<PathBuf, String> {
    validate_revision(revision)?;
    Ok(repo_cache_dir(model_id)?.join("snapshots").join(revision))
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
