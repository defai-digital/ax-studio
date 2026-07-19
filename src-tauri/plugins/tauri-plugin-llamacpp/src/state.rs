use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Weak};
use tokio::process::Child;
use tokio::sync::{Mutex, OwnedMutexGuard};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub pid: i32,
    pub port: i32,
    pub model_id: String,
    pub model_path: String,
    pub is_embedding: bool,
    pub api_key: String,
    #[serde(default)]
    pub mmproj_path: Option<String>,
}

pub struct LLamaBackendSession {
    pub child: Child,
    pub info: SessionInfo,
}

/// LlamaCpp plugin state
pub struct LlamacppState {
    pub llama_server_process: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    startup_locks: Arc<Mutex<HashMap<String, Weak<Mutex<()>>>>>,
    trusted_binary_roots: std::sync::RwLock<Vec<PathBuf>>,
    trusted_model_roots: std::sync::RwLock<Vec<PathBuf>>,
}

impl Default for LlamacppState {
    fn default() -> Self {
        Self {
            llama_server_process: Arc::new(Mutex::new(HashMap::new())),
            startup_locks: Arc::new(Mutex::new(HashMap::new())),
            trusted_binary_roots: std::sync::RwLock::new(Vec::new()),
            trusted_model_roots: std::sync::RwLock::new(Vec::new()),
        }
    }
}

impl LlamacppState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_trusted_binary_root(&self, root: PathBuf) {
        let mut roots = self
            .trusted_binary_roots
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !roots.contains(&root) {
            roots.push(root);
        }
    }

    pub fn trusted_binary_roots(&self) -> Vec<PathBuf> {
        self.trusted_binary_roots
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub fn add_trusted_model_root(&self, root: PathBuf) {
        let mut roots = self
            .trusted_model_roots
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !roots.contains(&root) {
            roots.push(root);
        }
    }

    pub fn trusted_model_roots(&self) -> Vec<PathBuf> {
        self.trusted_model_roots
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Serialize startup for the same logical model/service without blocking
    /// unrelated model loads or access to the active-session map.
    pub async fn acquire_startup_lock(&self, key: &str) -> OwnedMutexGuard<()> {
        let lock = {
            let mut locks = self.startup_locks.lock().await;
            locks.retain(|_, lock| lock.strong_count() > 0);
            if let Some(lock) = locks.get(key).and_then(Weak::upgrade) {
                lock
            } else {
                let lock = Arc::new(Mutex::new(()));
                locks.insert(key.to_string(), Arc::downgrade(&lock));
                lock
            }
        };
        lock.lock_owned().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn startup_locks_serialize_same_key_without_blocking_other_models() {
        let state = LlamacppState::new();
        let first = state.acquire_startup_lock("model-a").await;

        assert!(tokio::time::timeout(
            Duration::from_millis(10),
            state.acquire_startup_lock("model-a")
        )
        .await
        .is_err());
        let other = tokio::time::timeout(
            Duration::from_secs(1),
            state.acquire_startup_lock("model-b"),
        )
        .await
        .expect("unrelated model startup should not block");
        drop(other);

        drop(first);
        tokio::time::timeout(
            Duration::from_secs(1),
            state.acquire_startup_lock("model-a"),
        )
        .await
        .expect("same model startup should resume after the prior load exits");

        state.acquire_startup_lock("model-c").await;
        assert_eq!(state.startup_locks.lock().await.len(), 1);
    }
}
