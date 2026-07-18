//! Voice feature data types: errors, status payloads, and model metadata.

use std::path::{Path, PathBuf};

/// Errors returned by voice commands. Serialized across IPC as
/// `{ "kind": <kebab-case>, "message": <display string> }` so the frontend
/// can switch on `kind` (e.g. route to Settings when `model-not-downloaded`)
/// while still having human-readable text for toasts.
#[derive(Debug, thiserror::Error)]
pub enum VoiceError {
    #[error("microphone permission denied: {0}")]
    MicPermissionDenied(String),
    #[error("no microphone input device available: {0}")]
    MicUnavailable(String),
    #[error("voice model '{0}' is not downloaded")]
    ModelNotDownloaded(String),
    #[error("unknown voice model '{0}' (expected base.en or small.en)")]
    UnknownModel(String),
    #[error("recorder is busy: {0}")]
    RecorderBusy(String),
    #[error("no recording in progress")]
    NotRecording,
    #[error("audio capture failed: {0}")]
    Capture(String),
    #[error("transcription failed: {0}")]
    Transcription(String),
    #[error("voice model download failed: {0}")]
    Download(String),
    #[error("voice subsystem error: {0}")]
    Internal(String),
}

impl VoiceError {
    /// Stable machine-readable code for the frontend.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::MicPermissionDenied(_) => "mic-permission-denied",
            Self::MicUnavailable(_) => "mic-unavailable",
            Self::ModelNotDownloaded(_) => "model-not-downloaded",
            Self::UnknownModel(_) => "unknown-model",
            Self::RecorderBusy(_) => "recorder-busy",
            Self::NotRecording => "not-recording",
            Self::Capture(_) => "capture",
            Self::Transcription(_) => "transcription",
            Self::Download(_) => "download",
            Self::Internal(_) => "internal",
        }
    }
}

impl serde::Serialize for VoiceError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("VoiceError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

/// Recording state machine states, mirrored by the frontend hook.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RecorderState {
    Idle,
    Recording,
    Transcribing,
}

/// Response of `voice_get_status`.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub state: RecorderState,
    pub model_downloaded: bool,
    pub audio_level: f32,
}

/// State shared between the voice worker and command handlers so
/// `voice_get_status` never has to round-trip through the worker channel.
#[derive(Debug, Clone, Copy)]
pub struct StatusShared {
    pub state: RecorderState,
    pub audio_level: f32,
}

impl Default for StatusShared {
    fn default() -> Self {
        Self {
            state: RecorderState::Idle,
            audio_level: 0.0,
        }
    }
}

/// Supported whisper.cpp GGML models. Files are fetched from the
/// `ggerganov/whisper.cpp` Hugging Face repo (the source used by
/// whisper.cpp's own `models/download-ggml-model.sh`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhisperModel {
    BaseEn,
    SmallEn,
}

impl WhisperModel {
    pub const DEFAULT: WhisperModel = WhisperModel::BaseEn;

    pub fn parse(id: &str) -> Result<Self, VoiceError> {
        match id {
            "base.en" => Ok(Self::BaseEn),
            "small.en" => Ok(Self::SmallEn),
            other => Err(VoiceError::UnknownModel(other.to_string())),
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::BaseEn => "base.en",
            Self::SmallEn => "small.en",
        }
    }

    pub fn file_name(self) -> &'static str {
        match self {
            Self::BaseEn => "ggml-base.en.bin",
            Self::SmallEn => "ggml-small.en.bin",
        }
    }

    pub fn url(self) -> String {
        format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
            self.file_name()
        )
    }

    /// Path of the model file relative to the app data folder. Must stay
    /// within the app data root so the downloads policy accepts it.
    pub fn relative_save_path(self) -> String {
        format!("models/whisper/{}", self.file_name())
    }

    pub fn file_path(self, app_data_dir: &Path) -> PathBuf {
        app_data_dir
            .join("models")
            .join("whisper")
            .join(self.file_name())
    }

    pub fn dir_path(self, app_data_dir: &Path) -> PathBuf {
        app_data_dir.join("models").join("whisper")
    }

    /// Task id used with the downloads manager. Restricted to the
    /// `[A-Za-z0-9_-]` charset required by `validate_download_task_id`
    /// (model ids contain a `.`, which is not allowed in task ids).
    pub fn download_task_id(self) -> String {
        format!("voice-model-{}", self.id().replace('.', "-"))
    }
}
