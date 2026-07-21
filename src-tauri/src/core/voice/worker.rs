//! Dedicated voice worker thread.
//!
//! cpal streams and whisper contexts are not uniformly `Send`, so — exactly
//! like the MLX integration — a single OS thread owns the capture device and
//! the transcription engine and processes [`VoiceCommand`]s from an mpsc
//! channel. Tauri commands are thin async wrappers that send a request and
//! await a oneshot reply; the capture callback feeds audio chunks back into
//! the same channel.

use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use tokio::sync::oneshot;

use super::capture::CpalCapture;
use super::models::{StatusShared, VoiceError};
use super::session::{TauriEventSink, VoiceCommand, VoiceSession};
use super::transcribe::WhisperTranscriber;

/// Handle to the voice worker thread. Clonable via the inner sender.
#[derive(Clone)]
pub struct VoiceWorker {
    tx: Sender<VoiceCommand>,
}

impl VoiceWorker {
    /// Spawn the worker thread. The session (cpal + whisper) is constructed
    /// inside the thread so no non-`Send` handle ever crosses threads.
    pub fn spawn(
        app: tauri::AppHandle,
        status: Arc<Mutex<StatusShared>>,
    ) -> Result<(Self, JoinHandle<()>), VoiceError> {
        let (tx, rx) = channel::<VoiceCommand>();
        let session_tx = tx.clone();
        let join = thread::Builder::new()
            .name("voice-worker".to_string())
            .spawn(move || {
                let mut session = VoiceSession::new(
                    CpalCapture::new(),
                    WhisperTranscriber::new(),
                    Box::new(TauriEventSink(app)),
                    status,
                );
                // The loop ends when every sender is dropped (app shutdown).
                while let Ok(command) = rx.recv() {
                    session.handle(command, &session_tx);
                }
            })
            .map_err(|error| {
                VoiceError::Internal(format!("failed to spawn voice worker thread: {error}"))
            })?;
        Ok((Self { tx }, join))
    }

    async fn dispatch<T>(
        &self,
        build: impl FnOnce(oneshot::Sender<T>) -> VoiceCommand,
    ) -> Result<T, VoiceError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(build(reply_tx))
            .map_err(|_| VoiceError::Internal("voice worker is not running".to_string()))?;
        reply_rx
            .await
            .map_err(|_| VoiceError::Internal("voice worker dropped the reply channel".to_string()))
    }

    pub async fn start_recording(&self, model_path: PathBuf) -> Result<(), VoiceError> {
        self.dispatch(|reply| VoiceCommand::Start { model_path, reply })
            .await?
    }

    pub async fn stop_recording(&self) -> Result<String, VoiceError> {
        self.dispatch(|reply| VoiceCommand::Stop { reply }).await?
    }

    pub async fn cancel_recording(&self) -> Result<(), VoiceError> {
        self.dispatch(|reply| VoiceCommand::Cancel { reply })
            .await?
    }
}
