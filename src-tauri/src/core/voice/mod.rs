//! Voice input — local speech-to-text via whisper.cpp (`whisper-rs`).
//!
//! `cpal` captures microphone audio, which is resampled to 16 kHz mono f32
//! and transcribed entirely on-device. Audio buffers are discarded as soon as
//! transcription completes and are never written to disk (local-first privacy
//! promise). GGML model files (`ggml-base.en.bin`, `ggml-small.en.bin`) are
//! downloaded at runtime into the app data folder via the existing downloads
//! infrastructure.
//!
//! Layout: the recording/transcription state machine ([`session`]) runs on a
//! dedicated worker thread ([`worker`]) because cpal streams and whisper
//! contexts are not safely `Send` across the board (same discipline as the
//! MLX integration). Tauri commands ([`commands`]) are thin async wrappers
//! that dispatch to the worker over a channel and await oneshot replies.
//! Pure helpers ([`audio`], [`models`]) are unit-tested directly; the session
//! is tested with injected mock `Capture`/`Transcriber` implementations.

pub mod audio;
pub mod capture;
pub mod commands;
pub mod models;
pub mod session;
pub mod state;
pub mod transcribe;
pub mod worker;

#[cfg(test)]
mod tests;

/// RMS of the captured audio, pushed while recording (`{ level: f32 }`).
pub const VOICE_LEVEL_EVENT: &str = "voice-level";
/// Recording state transitions (`{ state: "idle" | "recording" | "transcribing" }`).
pub const VOICE_STATE_EVENT: &str = "voice-state";
/// Transcript produced by the silence auto-stop path (`{ text: String }`).
/// Manual stops return the transcript from `voice_stop_recording` instead.
pub const VOICE_TRANSCRIPT_EVENT: &str = "voice-transcript";
