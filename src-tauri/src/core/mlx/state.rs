//! Tauri-managed state for in-process MLX inference.
//!
//! `MlxState` holds the handle to the dedicated MLX worker thread, which owns
//! the actual `EngineSession` registry. The handle is `Clone` so multiple
//! command handlers can dispatch concurrently without contention.

#![cfg(target_os = "macos")]

use std::thread::JoinHandle;

use crate::core::mlx::worker::MlxWorker;

pub struct MlxState {
    pub worker: MlxWorker,
    /// JoinHandle held so the worker isn't detached. Wrapped in `Option` so a
    /// shutdown handler can take/join it explicitly.
    pub _worker_join: std::sync::Mutex<Option<JoinHandle<()>>>,
}

impl MlxState {
    pub fn new() -> Self {
        let (worker, join) = MlxWorker::spawn();
        Self {
            worker,
            _worker_join: std::sync::Mutex::new(Some(join)),
        }
    }
}

impl Default for MlxState {
    fn default() -> Self {
        Self::new()
    }
}
