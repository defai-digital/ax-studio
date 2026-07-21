//! Tauri-managed state for voice input.
//!
//! The worker thread is spawned lazily on first use (commands carry the
//! `AppHandle` needed for events, so spawning at `.manage()` time — before
//! the app exists — would not work). Status lives in a separately shared
//! struct so `voice_get_status` never blocks on the worker channel.

use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use super::models::{StatusShared, VoiceError, VoiceStatus};
use super::worker::VoiceWorker;

#[derive(Default)]
pub struct VoiceState {
    worker: Mutex<Option<VoiceWorker>>,
    /// JoinHandle kept so the worker thread is not detached.
    _worker_join: Mutex<Option<JoinHandle<()>>>,
    status: Arc<Mutex<StatusShared>>,
}

impl VoiceState {
    fn lock<'a, T>(mutex: &'a Mutex<T>) -> std::sync::MutexGuard<'a, T> {
        mutex.lock().unwrap_or_else(|poisoned| {
            log::warn!("[voice] mutex was poisoned; recovering lock");
            poisoned.into_inner()
        })
    }

    /// Get the worker, spawning it on first use.
    pub fn worker(&self, app: &tauri::AppHandle) -> Result<VoiceWorker, VoiceError> {
        let mut guard = Self::lock(&self.worker);
        if let Some(worker) = guard.as_ref() {
            return Ok(worker.clone());
        }
        let (worker, join) = VoiceWorker::spawn(app.clone(), self.status.clone())?;
        *Self::lock(&self._worker_join) = Some(join);
        *guard = Some(worker.clone());
        Ok(worker)
    }

    /// The worker only if it has already been spawned — stop/cancel must not
    /// spin up a thread just to learn that nothing is recording.
    pub fn worker_if_spawned(&self) -> Option<VoiceWorker> {
        Self::lock(&self.worker).clone()
    }

    pub fn status(&self, model_downloaded: bool) -> VoiceStatus {
        let status = *Self::lock(&self.status);
        VoiceStatus {
            state: status.state,
            model_downloaded,
            audio_level: status.audio_level,
        }
    }
}
