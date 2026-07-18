//! Recording state machine. Runs entirely on the voice worker thread; every
//! input arrives as a [`VoiceCommand`] (from Tauri commands or the capture
//! callback) and outputs flow back through oneshot replies and the
//! [`EventSink`]. Generic over [`Capture`]/[`Transcriber`] so tests can
//! inject mocks; events go through `Box<dyn EventSink>` so tests can record
//! them without a Tauri runtime.

use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::oneshot;

use super::audio::{
    compute_rms, resample_to_16khz_mono, SilenceDetector, MAX_RECORDING_SAMPLES,
    SILENCE_RMS_THRESHOLD, WHISPER_SAMPLE_RATE,
};
use super::capture::Capture;
use super::models::{RecorderState, StatusShared, VoiceError};
use super::transcribe::Transcriber;
use super::{VOICE_LEVEL_EVENT, VOICE_STATE_EVENT, VOICE_TRANSCRIPT_EVENT};

/// Minimum audio worth sending to whisper — shorter clips produce garbage.
const MIN_TRANSCRIBE_SAMPLES: usize = WHISPER_SAMPLE_RATE as usize / 10; // 100 ms

/// Throttle for `voice-level` events so the frontend gets ~10 updates/sec.
const LEVEL_EMIT_INTERVAL: Duration = Duration::from_millis(100);

/// Events emitted from the worker thread. Production wraps the Tauri
/// `AppHandle`; tests record into a vec.
pub trait EventSink: Send {
    fn emit_json(&self, event: &str, payload: serde_json::Value);
}

/// Tauri-backed event sink (broadcasts to all webview windows).
pub struct TauriEventSink(pub tauri::AppHandle);

impl EventSink for TauriEventSink {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        use tauri::Emitter;
        if let Err(e) = self.0.emit(event, payload) {
            log::error!("Failed to emit {event}: {e}");
        }
    }
}

/// Everything the worker can be asked to do. `Chunk` is sent by the capture
/// callback; the rest come from Tauri commands.
pub enum VoiceCommand {
    Start {
        model_path: PathBuf,
        reply: oneshot::Sender<Result<(), VoiceError>>,
    },
    Stop {
        reply: oneshot::Sender<Result<String, VoiceError>>,
    },
    Cancel {
        reply: oneshot::Sender<Result<(), VoiceError>>,
    },
    /// Raw interleaved f32 audio at the device's channel count / sample rate.
    Chunk {
        samples: Vec<f32>,
        channels: u16,
        sample_rate: u32,
    },
}

/// Lock a shared mutex, tolerating poisoning (a panicking recorder must not
/// wedge status reads forever).
fn lock<'a, T>(mutex: &'a Mutex<T>) -> std::sync::MutexGuard<'a, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct VoiceSession<C: Capture, T: Transcriber> {
    state: RecorderState,
    // `pub(super)` so the sibling test module can assert on the mocks.
    pub(super) capture: C,
    pub(super) transcriber: T,
    events: Box<dyn EventSink>,
    status: Arc<Mutex<StatusShared>>,
    /// 16 kHz mono f32 samples for the in-flight recording. Never persisted;
    /// cleared on transcribe and on cancel.
    pub(super) buffer: Vec<f32>,
    silence: SilenceDetector,
    last_level_emit: Option<Instant>,
}

impl<C: Capture, T: Transcriber> VoiceSession<C, T> {
    pub fn new(
        capture: C,
        transcriber: T,
        events: Box<dyn EventSink>,
        status: Arc<Mutex<StatusShared>>,
    ) -> Self {
        Self {
            state: RecorderState::Idle,
            capture,
            transcriber,
            events,
            status,
            buffer: Vec::new(),
            silence: SilenceDetector::default(),
            last_level_emit: None,
        }
    }

    /// Dispatch one command. Called by the worker loop (and directly by
    /// tests, which never spawn the thread).
    pub fn handle(&mut self, command: VoiceCommand, tx: &Sender<VoiceCommand>) {
        match command {
            VoiceCommand::Start { model_path, reply } => {
                let _ = reply.send(self.start(&model_path, tx.clone()));
            }
            VoiceCommand::Stop { reply } => {
                let _ = reply.send(self.stop());
            }
            VoiceCommand::Cancel { reply } => {
                let _ = reply.send(self.cancel());
            }
            VoiceCommand::Chunk {
                samples,
                channels,
                sample_rate,
            } => self.on_chunk(&samples, channels, sample_rate),
        }
    }

    fn start(
        &mut self,
        model_path: &std::path::Path,
        tx: Sender<VoiceCommand>,
    ) -> Result<(), VoiceError> {
        if self.state != RecorderState::Idle {
            return Err(VoiceError::RecorderBusy(format!(
                "already {:?}",
                self.state
            )));
        }
        if !model_path.is_file() {
            return Err(VoiceError::ModelNotDownloaded(
                model_path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| model_path.display().to_string()),
            ));
        }
        // Load the model before touching the microphone so a missing/corrupt
        // model fails fast instead of after the user has spoken.
        self.transcriber.load(model_path)?;
        self.capture.start(tx)?;

        self.buffer.clear();
        self.silence.reset();
        self.last_level_emit = None;
        self.set_state(RecorderState::Recording);
        Ok(())
    }

    fn stop(&mut self) -> Result<String, VoiceError> {
        if self.state != RecorderState::Recording {
            return Err(VoiceError::NotRecording);
        }
        self.capture.stop();
        self.set_state(RecorderState::Transcribing);
        let result = self.transcribe_buffer();
        self.set_state(RecorderState::Idle);
        result
    }

    fn cancel(&mut self) -> Result<(), VoiceError> {
        if self.state == RecorderState::Recording {
            self.capture.stop();
            // Discard captured audio immediately — nothing leaves the device.
            self.buffer.clear();
            self.set_state(RecorderState::Idle);
        }
        Ok(())
    }

    fn on_chunk(&mut self, samples: &[f32], channels: u16, sample_rate: u32) {
        if self.state != RecorderState::Recording {
            return;
        }
        let mono = resample_to_16khz_mono(samples, channels, sample_rate);
        if mono.is_empty() {
            return;
        }
        let rms = compute_rms(&mono);
        self.buffer.extend_from_slice(&mono);

        {
            let mut status = lock(&self.status);
            status.audio_level = rms.min(1.0);
        }
        let now = Instant::now();
        if self
            .last_level_emit
            .is_none_or(|t| now.duration_since(t) >= LEVEL_EMIT_INTERVAL)
        {
            self.events
                .emit_json(VOICE_LEVEL_EVENT, serde_json::json!({ "level": rms }));
            self.last_level_emit = Some(now);
        }

        let silence_triggered = self.silence.update(rms, mono.len());
        let over_cap = self.buffer.len() >= MAX_RECORDING_SAMPLES;
        if silence_triggered || over_cap {
            if over_cap && !silence_triggered {
                log::info!("Voice recording hit the 5-minute cap — auto-stopping");
            } else {
                log::info!("Voice recording auto-stopped after prolonged silence");
            }
            self.auto_stop();
        }
    }

    /// Silence/cap path: stop, transcribe, and push the transcript to the
    /// frontend via event (there is no awaiting command caller here).
    fn auto_stop(&mut self) {
        self.capture.stop();
        self.set_state(RecorderState::Transcribing);
        match self.transcribe_buffer() {
            Ok(text) => {
                self.events
                    .emit_json(VOICE_TRANSCRIPT_EVENT, serde_json::json!({ "text": text }));
            }
            Err(e) => {
                log::error!("Auto-stop transcription failed: {e}");
                self.events
                    .emit_json(VOICE_TRANSCRIPT_EVENT, serde_json::json!({ "text": "" }));
            }
        }
        self.set_state(RecorderState::Idle);
    }

    /// Run inference on the captured buffer, then always discard the audio.
    fn transcribe_buffer(&mut self) -> Result<String, VoiceError> {
        let samples = std::mem::take(&mut self.buffer);
        let result = if samples.len() < MIN_TRANSCRIBE_SAMPLES {
            Ok(String::new())
        } else if compute_rms(&samples) < SILENCE_RMS_THRESHOLD {
            // Pure silence — skip inference (whisper hallucinates on noise).
            Ok(String::new())
        } else {
            self.transcriber.transcribe(&samples)
        };
        // `samples` is dropped here, before returning — audio never persists.
        result
    }

    fn set_state(&mut self, state: RecorderState) {
        self.state = state;
        {
            let mut status = lock(&self.status);
            status.state = state;
            if state != RecorderState::Recording {
                status.audio_level = 0.0;
            }
        }
        self.events
            .emit_json(VOICE_STATE_EVENT, serde_json::json!({ "state": state }));
    }
}
