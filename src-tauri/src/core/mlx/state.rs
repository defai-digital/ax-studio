//! Tauri-managed state for in-process MLX inference.
//!
//! `MlxState` lazily starts the dedicated MLX worker and replaces it if the
//! thread exits or panics. The worker owns the actual `EngineSession` registry.

#![cfg(target_os = "macos")]

use std::thread::JoinHandle;

use crate::core::mlx::worker::MlxWorker;

pub struct MlxState {
    worker: std::sync::Mutex<Option<MlxWorker>>,
    worker_join: std::sync::Mutex<Option<JoinHandle<()>>>,
}

impl MlxState {
    pub fn new() -> Self {
        Self {
            worker: std::sync::Mutex::new(None),
            worker_join: std::sync::Mutex::new(None),
        }
    }

    /// Return the live worker, spawning it on first use or after a crash.
    pub fn worker(&self) -> Result<MlxWorker, String> {
        let mut worker = self.worker.lock().unwrap_or_else(|poisoned| {
            log::warn!("[mlx] worker mutex was poisoned; recovering lock");
            poisoned.into_inner()
        });
        let mut join = self.worker_join.lock().unwrap_or_else(|poisoned| {
            log::warn!("[mlx] worker_join mutex was poisoned; recovering lock");
            poisoned.into_inner()
        });

        if join.as_ref().is_some_and(JoinHandle::is_finished) {
            let completed = join.take();
            *worker = None;
            if completed.is_some_and(|handle| handle.join().is_err()) {
                log::error!("[mlx-worker] worker thread panicked; starting a replacement");
            } else {
                log::warn!("[mlx-worker] worker thread exited; starting a replacement");
            }
        }

        if worker.is_none() {
            let (new_worker, new_join) = MlxWorker::spawn()?;
            *worker = Some(new_worker);
            *join = Some(new_join);
        }

        worker
            .as_ref()
            .cloned()
            .ok_or_else(|| "MLX worker is unavailable".to_string())
    }
}

impl Default for MlxState {
    fn default() -> Self {
        Self::new()
    }
}
