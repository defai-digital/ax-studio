//! Microphone capture abstraction plus the `cpal` implementation.
//!
//! The [`Capture`] trait exists so the recording state machine
//! ([`super::session`]) can be unit-tested without audio hardware. The real
//! implementation streams device-native audio, converts it to interleaved
//! f32, and forwards chunks to the voice worker over the command channel —
//! resampling to 16 kHz mono happens in the session so this layer stays thin.

use std::sync::mpsc::Sender;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use super::audio::{i16_samples_to_f32, u16_samples_to_f32};
use super::models::VoiceError;
use super::session::VoiceCommand;

/// Audio source for a recording session.
pub trait Capture: Send {
    /// Start capturing from the default input device, forwarding raw
    /// interleaved f32 chunks (device channel count / sample rate) to `tx`.
    fn start(&mut self, tx: Sender<VoiceCommand>) -> Result<(), VoiceError>;
    /// Stop capturing and release the input device.
    fn stop(&mut self);
}

/// `cpal`-backed capture. The stream is created per recording and dropped on
/// stop; everything lives on the voice worker thread, so platform streams
/// that are not `Send` never cross a thread boundary.
#[derive(Default)]
pub struct CpalCapture {
    stream: Option<cpal::Stream>,
}

impl CpalCapture {
    pub fn new() -> Self {
        Self::default()
    }
}

fn log_stream_error(err: cpal::Error) {
    log::error!("Voice capture stream error: {err}");
}

fn forward_chunk(tx: &Sender<VoiceCommand>, samples: Vec<f32>, channels: u16, sample_rate: u32) {
    // If the worker is gone the stream is about to be dropped anyway.
    let _ = tx.send(VoiceCommand::Chunk {
        samples,
        channels,
        sample_rate,
    });
}

/// Map a cpal error to a typed voice error. `ErrorKind::PermissionDenied`
/// surfaces when the OS microphone permission was denied (or the TCC prompt
/// was dismissed) — the frontend uses it to point at System Settings.
fn map_cpal_error(context: &str, err: cpal::Error) -> VoiceError {
    match err.kind() {
        cpal::ErrorKind::PermissionDenied => VoiceError::MicPermissionDenied(format!(
            "{context}: grant microphone access in System Settings → Privacy & Security → Microphone ({err})"
        )),
        cpal::ErrorKind::DeviceNotAvailable => {
            VoiceError::MicUnavailable(format!("{context}: {err}"))
        }
        _ => VoiceError::Capture(format!("{context}: {err}")),
    }
}

impl Capture for CpalCapture {
    fn start(&mut self, tx: Sender<VoiceCommand>) -> Result<(), VoiceError> {
        let host = cpal::default_host();
        let device = host.default_input_device().ok_or_else(|| {
            VoiceError::MicUnavailable(
                "no default input device — check microphone connection and OS permission".into(),
            )
        })?;
        let supported = device
            .default_input_config()
            .map_err(|e| map_cpal_error("default input config", e))?;
        let sample_format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let channels = config.channels;
        let sample_rate = config.sample_rate;

        let stream = match sample_format {
            cpal::SampleFormat::F32 => {
                let cb_tx = tx.clone();
                device.build_input_stream(
                    config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        forward_chunk(&cb_tx, data.to_vec(), channels, sample_rate);
                    },
                    log_stream_error,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let cb_tx = tx.clone();
                device.build_input_stream(
                    config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        forward_chunk(&cb_tx, i16_samples_to_f32(data), channels, sample_rate);
                    },
                    log_stream_error,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let cb_tx = tx;
                device.build_input_stream(
                    config,
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        forward_chunk(&cb_tx, u16_samples_to_f32(data), channels, sample_rate);
                    },
                    log_stream_error,
                    None,
                )
            }
            other => {
                return Err(VoiceError::Capture(format!(
                    "unsupported microphone sample format: {other}"
                )))
            }
        }
        .map_err(|e| map_cpal_error("build input stream", e))?;

        stream
            .play()
            .map_err(|e| map_cpal_error("start input stream", e))?;
        self.stream = Some(stream);
        Ok(())
    }

    fn stop(&mut self) {
        // Dropping the stream stops capture and releases the device.
        self.stream = None;
    }
}
