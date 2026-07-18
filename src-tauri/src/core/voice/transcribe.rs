//! Speech-to-text abstraction plus the `whisper-rs` (whisper.cpp) backend.
//!
//! The [`Transcriber`] trait lets the session state machine be unit-tested
//! with a mock. The real implementation keeps a loaded `WhisperContext` and
//! reloads only when the model path changes; inference runs on the voice
//! worker thread, which is fine — it is the only caller.

use std::path::{Path, PathBuf};

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use super::models::VoiceError;

/// On-device speech-to-text engine.
pub trait Transcriber: Send {
    /// Load (or reuse) the GGML model at `path`.
    fn load(&mut self, path: &Path) -> Result<(), VoiceError>;
    /// Transcribe 16 kHz mono f32 samples to text.
    fn transcribe(&mut self, samples: &[f32]) -> Result<String, VoiceError>;
}

#[derive(Default)]
pub struct WhisperTranscriber {
    ctx: Option<WhisperContext>,
    loaded_path: Option<PathBuf>,
}

impl WhisperTranscriber {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Transcriber for WhisperTranscriber {
    fn load(&mut self, path: &Path) -> Result<(), VoiceError> {
        if self.ctx.is_some() && self.loaded_path.as_deref() == Some(path) {
            return Ok(());
        }
        let path_str = path.to_str().ok_or_else(|| {
            VoiceError::Internal(format!("model path is not valid UTF-8: {}", path.display()))
        })?;
        let ctx = WhisperContext::new_with_params(path_str, WhisperContextParameters::default())
            .map_err(|e| {
                VoiceError::Transcription(format!(
                    "failed to load whisper model {}: {e}",
                    path.display()
                ))
            })?;
        self.ctx = Some(ctx);
        self.loaded_path = Some(path.to_path_buf());
        log::info!("Loaded whisper model for voice input: {}", path.display());
        Ok(())
    }

    fn transcribe(&mut self, samples: &[f32]) -> Result<String, VoiceError> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| VoiceError::Internal("transcriber has no model loaded".into()))?;
        let mut state = ctx.create_state().map_err(|e| {
            VoiceError::Transcription(format!("failed to create whisper state: {e}"))
        })?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        // The supported models are English-only (`.en`) GGML builds.
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);

        state
            .full(params, samples)
            .map_err(|e| VoiceError::Transcription(format!("whisper inference failed: {e}")))?;

        let mut text = String::new();
        for segment in state.as_iter() {
            if let Ok(segment_text) = segment.to_str() {
                text.push_str(segment_text);
            }
        }
        Ok(text.trim().to_string())
    }
}
