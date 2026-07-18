//! Unit tests for the voice module: pure audio helpers and the recording
//! state machine driven through `VoiceSession::handle` with injected mock
//! capture/transcriber implementations (no hardware, no threads).

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

use tokio::sync::oneshot;

use super::audio::*;
use super::capture::Capture;
use super::models::{RecorderState, StatusShared, VoiceError, WhisperModel};
use super::session::{EventSink, VoiceCommand, VoiceSession};
use super::transcribe::Transcriber;
use super::{VOICE_LEVEL_EVENT, VOICE_STATE_EVENT, VOICE_TRANSCRIPT_EVENT};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

#[test]
fn rms_of_empty_and_silence_is_zero() {
    assert_eq!(compute_rms(&[]), 0.0);
    assert_eq!(compute_rms(&[0.0; 1024]), 0.0);
}

#[test]
fn rms_of_constant_signal_is_its_amplitude() {
    let rms = compute_rms(&[0.5; 100]);
    assert!((rms - 0.5).abs() < 1e-6);
}

#[test]
fn resample_passthrough_at_native_rate() {
    let input: Vec<f32> = (0..100).map(|i| i as f32).collect();
    let out = resample_to_16khz_mono(&input, 1, WHISPER_SAMPLE_RATE);
    assert_eq!(out, input);
}

#[test]
fn resample_downmixes_stereo_by_averaging() {
    // One stereo frame: L=1.0, R=0.0 → mono 0.5
    let out = resample_to_16khz_mono(&[1.0, 0.0], 2, WHISPER_SAMPLE_RATE);
    assert_eq!(out, vec![0.5]);
}

#[test]
fn resample_48k_to_16k_shrinks_by_three() {
    let input = vec![0.25f32; 4800];
    let out = resample_to_16khz_mono(&input, 1, 48_000);
    assert_eq!(out.len(), 1600);
    assert!(out.iter().all(|s| (*s - 0.25).abs() < 1e-6));
}

#[test]
fn resample_handles_zero_channels_and_empty_input() {
    assert!(resample_to_16khz_mono(&[], 1, 48_000).is_empty());
    assert!(resample_to_16khz_mono(&[0.5, 0.5], 0, 48_000).len() <= 2);
}

#[test]
fn i16_and_u16_conversion_is_normalized() {
    let out = i16_samples_to_f32(&[i16::MAX, 0, i16::MIN]);
    assert!((out[0] - 1.0).abs() < 1e-6);
    assert_eq!(out[1], 0.0);
    assert!(out[2] < -0.99);

    let out = u16_samples_to_f32(&[u16::MAX, 32768, 0]);
    assert!((out[0] - 1.0).abs() < 1e-3);
    assert_eq!(out[1], 0.0);
    assert!(out[2] <= -1.0);
}

#[test]
fn silence_detector_triggers_only_after_full_duration() {
    // 12 s threshold at 16 kHz, fed in 1 s chunks of silence.
    let mut detector = SilenceDetector::new(0.01, 12.0);
    for _ in 0..11 {
        assert!(!detector.update(0.001, 16_000));
    }
    assert!(detector.update(0.001, 16_000));
}

#[test]
fn silence_detector_resets_on_speech() {
    let mut detector = SilenceDetector::new(0.01, 12.0);
    for _ in 0..11 {
        assert!(!detector.update(0.001, 16_000));
    }
    assert!(!detector.update(0.5, 16_000)); // loud chunk resets the run
    for _ in 0..11 {
        assert!(!detector.update(0.001, 16_000));
    }
    assert!(detector.update(0.001, 16_000));
}

#[test]
fn silence_detector_reset_clears_progress() {
    let mut detector = SilenceDetector::new(0.01, 1.0);
    assert!(!detector.update(0.0, 8_000));
    detector.reset();
    assert!(!detector.update(0.0, 8_000));
    assert!(detector.update(0.0, 8_000));
}

// ---------------------------------------------------------------------------
// Model metadata
// ---------------------------------------------------------------------------

#[test]
fn whisper_model_parse_round_trip() {
    assert_eq!(
        WhisperModel::parse("base.en").unwrap(),
        WhisperModel::BaseEn
    );
    assert_eq!(
        WhisperModel::parse("small.en").unwrap(),
        WhisperModel::SmallEn
    );
    match WhisperModel::parse("tiny.en") {
        Err(VoiceError::UnknownModel(id)) => assert_eq!(id, "tiny.en"),
        other => panic!("expected UnknownModel, got {other:?}"),
    }
}

#[test]
fn whisper_model_paths_and_urls() {
    let model = WhisperModel::BaseEn;
    assert_eq!(model.file_name(), "ggml-base.en.bin");
    assert_eq!(
        model.url(),
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
    );
    let app_data = Path::new("/data");
    assert_eq!(
        model.file_path(app_data),
        PathBuf::from("/data/models/whisper/ggml-base.en.bin")
    );
    assert_eq!(
        model.relative_save_path(),
        "models/whisper/ggml-base.en.bin"
    );
}

#[test]
fn download_task_id_uses_allowed_charset() {
    for model in [WhisperModel::BaseEn, WhisperModel::SmallEn] {
        let task_id = model.download_task_id();
        assert!(task_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
    }
    assert_eq!(
        WhisperModel::BaseEn.download_task_id(),
        "voice-model-base-en"
    );
}

#[test]
fn voice_error_serializes_with_kind_and_message() {
    let err = VoiceError::ModelNotDownloaded("base.en".to_string());
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "model-not-downloaded");
    assert_eq!(json["message"], "voice model 'base.en' is not downloaded");

    let err = VoiceError::NotRecording;
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "not-recording");
}

// ---------------------------------------------------------------------------
// State machine with injected mocks
// ---------------------------------------------------------------------------

struct MockCapture {
    started: bool,
    start_calls: usize,
    stop_calls: usize,
    fail_start: bool,
}

impl MockCapture {
    fn new() -> Self {
        Self {
            started: false,
            start_calls: 0,
            stop_calls: 0,
            fail_start: false,
        }
    }
}

impl Capture for MockCapture {
    fn start(&mut self, _tx: Sender<VoiceCommand>) -> Result<(), VoiceError> {
        self.start_calls += 1;
        if self.fail_start {
            return Err(VoiceError::MicPermissionDenied("denied in test".into()));
        }
        self.started = true;
        Ok(())
    }

    fn stop(&mut self) {
        self.stop_calls += 1;
        self.started = false;
    }
}

struct MockTranscriber {
    loaded_paths: Vec<PathBuf>,
    transcribed_lens: Vec<usize>,
    transcript: String,
}

impl MockTranscriber {
    fn new() -> Self {
        Self {
            loaded_paths: Vec::new(),
            transcribed_lens: Vec::new(),
            transcript: "hello world".to_string(),
        }
    }
}

impl Transcriber for MockTranscriber {
    fn load(&mut self, path: &Path) -> Result<(), VoiceError> {
        self.loaded_paths.push(path.to_path_buf());
        Ok(())
    }

    fn transcribe(&mut self, samples: &[f32]) -> Result<String, VoiceError> {
        self.transcribed_lens.push(samples.len());
        Ok(self.transcript.clone())
    }
}

#[derive(Clone, Default)]
struct VecEventSink {
    events: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
}

impl VecEventSink {
    fn names(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|(name, _)| name.clone())
            .collect()
    }

    fn last_payload(&self, name: &str) -> Option<serde_json::Value> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(n, _)| n == name)
            .map(|(_, p)| p.clone())
    }
}

impl EventSink for VecEventSink {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
    }
}

struct TestRig {
    session: VoiceSession<MockCapture, MockTranscriber>,
    tx: Sender<VoiceCommand>,
    sink: VecEventSink,
    status: Arc<Mutex<StatusShared>>,
    model_path: PathBuf,
    _dir: tempfile::TempDir,
}

fn rig() -> TestRig {
    let dir = tempfile::tempdir().unwrap();
    let model_path = dir.path().join("ggml-base.en.bin");
    std::fs::write(&model_path, b"fake-ggml-model").unwrap();

    let sink = VecEventSink::default();
    let status = Arc::new(Mutex::new(StatusShared::default()));
    let session = VoiceSession::new(
        MockCapture::new(),
        MockTranscriber::new(),
        Box::new(sink.clone()),
        status.clone(),
    );
    let (tx, _rx) = channel();
    TestRig {
        session,
        tx,
        sink,
        status,
        model_path,
        _dir: dir,
    }
}

fn start_cmd(model_path: PathBuf) -> (VoiceCommand, oneshot::Receiver<Result<(), VoiceError>>) {
    let (reply, rx) = oneshot::channel();
    (VoiceCommand::Start { model_path, reply }, rx)
}

fn stop_cmd() -> (VoiceCommand, oneshot::Receiver<Result<String, VoiceError>>) {
    let (reply, rx) = oneshot::channel();
    (VoiceCommand::Stop { reply }, rx)
}

fn cancel_cmd() -> (VoiceCommand, oneshot::Receiver<Result<(), VoiceError>>) {
    let (reply, rx) = oneshot::channel();
    (VoiceCommand::Cancel { reply }, rx)
}

fn chunk(samples: Vec<f32>) -> VoiceCommand {
    VoiceCommand::Chunk {
        samples,
        channels: 1,
        sample_rate: WHISPER_SAMPLE_RATE,
    }
}

/// Speech-like loud chunk (RMS well above the silence threshold).
fn loud_chunk(len: usize) -> Vec<f32> {
    // Alternating ±0.3 → RMS 0.3
    (0..len)
        .map(|i| if i % 2 == 0 { 0.3 } else { -0.3 })
        .collect()
}

fn state_of(rig: &TestRig) -> RecorderState {
    rig.status.lock().unwrap().state
}

#[test]
fn start_then_stop_returns_transcript_and_discards_audio() {
    let mut rig = rig();

    let (cmd, rx) = start_cmd(rig.model_path.clone());
    rig.session.handle(cmd, &rig.tx);
    assert!(rx.blocking_recv().unwrap().is_ok());
    assert_eq!(state_of(&rig), RecorderState::Recording);
    assert_eq!(rig.session.capture.start_calls, 1);
    assert_eq!(
        rig.session.transcriber.loaded_paths,
        vec![rig.model_path.clone()]
    );

    rig.session.handle(chunk(loud_chunk(1600)), &rig.tx);
    rig.session.handle(chunk(loud_chunk(1600)), &rig.tx);
    assert!(rig.status.lock().unwrap().audio_level > 0.1);

    let (cmd, rx) = stop_cmd();
    rig.session.handle(cmd, &rig.tx);
    let transcript = rx.blocking_recv().unwrap().unwrap();
    assert_eq!(transcript, "hello world");
    assert_eq!(state_of(&rig), RecorderState::Idle);
    // The transcriber saw exactly the captured 3200 samples, and the session
    // buffer was taken (discarded) for transcription.
    assert_eq!(rig.session.transcriber.transcribed_lens, vec![3200]);
    assert!(rig.session.buffer.is_empty());
    assert!(!rig.session.capture.started);
}

#[test]
fn start_while_recording_is_busy() {
    let mut rig = rig();
    let (cmd, rx) = start_cmd(rig.model_path.clone());
    rig.session.handle(cmd, &rig.tx);
    assert!(rx.blocking_recv().unwrap().is_ok());

    let (cmd, rx) = start_cmd(rig.model_path.clone());
    rig.session.handle(cmd, &rig.tx);
    match rx.blocking_recv().unwrap() {
        Err(VoiceError::RecorderBusy(_)) => {}
        other => panic!("expected RecorderBusy, got {other:?}"),
    }
    // Capture was not restarted.
    assert_eq!(rig.session.capture.start_calls, 1);
}

#[test]
fn start_with_missing_model_fails_before_touching_mic() {
    let mut rig = rig();
    let missing = rig._dir.path().join("ggml-small.en.bin");

    let (cmd, rx) = start_cmd(missing);
    rig.session.handle(cmd, &rig.tx);
    match rx.blocking_recv().unwrap() {
        Err(VoiceError::ModelNotDownloaded(name)) => {
            assert_eq!(name, "ggml-small.en.bin")
        }
        other => panic!("expected ModelNotDownloaded, got {other:?}"),
    }
    assert_eq!(rig.session.capture.start_calls, 0);
    assert_eq!(state_of(&rig), RecorderState::Idle);
}

#[test]
fn mic_permission_error_propagates_and_resets_state() {
    let mut rig = rig();
    rig.session.capture.fail_start = true;

    let (cmd, rx) = start_cmd(rig.model_path.clone());
    rig.session.handle(cmd, &rig.tx);
    match rx.blocking_recv().unwrap() {
        Err(VoiceError::MicPermissionDenied(_)) => {}
        other => panic!("expected MicPermissionDenied, got {other:?}"),
    }
    assert_eq!(state_of(&rig), RecorderState::Idle);
}

#[test]
fn stop_without_recording_is_not_recording_error() {
    let mut rig = rig();
    let (cmd, rx) = stop_cmd();
    rig.session.handle(cmd, &rig.tx);
    match rx.blocking_recv().unwrap() {
        Err(VoiceError::NotRecording) => {}
        other => panic!("expected NotRecording, got {other:?}"),
    }
}

#[test]
fn cancel_discards_audio_without_transcribing() {
    let mut rig = rig();
    let (cmd, rx) = start_cmd(rig.model_path.clone());
    rig.session.handle(cmd, &rig.tx);
    assert!(rx.blocking_recv().unwrap().is_ok());

    rig.session.handle(chunk(loud_chunk(1600)), &rig.tx);

    let (cmd, rx) = cancel_cmd();
    rig.session.handle(cmd, &rig.tx);
    assert!(rx.blocking_recv().unwrap().is_ok());

    assert_eq!(state_of(&rig), RecorderState::Idle);
    assert!(rig.session.buffer.is_empty());
    assert!(rig.session.transcriber.transcribed_lens.is_empty());
    assert!(!rig.session.capture.started);
}

#[test]
fn silence_auto_stop_transcribes_and_emits_events() {
    let mut rig = rig();
    let (cmd, rx) = start_cmd(rig.model_path.clone());
    rig.session.handle(cmd, &rig.tx);
    assert!(rx.blocking_recv().unwrap().is_ok());

    // One loud chunk, then >12 s of silence in 1 s chunks.
    rig.session.handle(chunk(loud_chunk(16_000)), &rig.tx);
    for _ in 0..12 {
        rig.session.handle(chunk(vec![0.0; 16_000]), &rig.tx);
    }

    // Auto-stop ran: capture stopped, transcription happened, back to idle.
    assert!(!rig.session.capture.started);
    assert_eq!(rig.session.transcriber.transcribed_lens.len(), 1);
    assert_eq!(state_of(&rig), RecorderState::Idle);

    let names = rig.sink.names();
    assert!(names.contains(&VOICE_TRANSCRIPT_EVENT.to_string()));
    let transcript = rig.sink.last_payload(VOICE_TRANSCRIPT_EVENT).unwrap();
    assert_eq!(transcript["text"], "hello world");

    // State transitions were announced: recording → transcribing → idle.
    let states: Vec<String> = rig
        .sink
        .events
        .lock()
        .unwrap()
        .iter()
        .filter(|(n, _)| n == VOICE_STATE_EVENT)
        .map(|(_, p)| p["state"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(states, vec!["recording", "transcribing", "idle"]);
}

#[test]
fn pure_silence_recording_yields_empty_transcript() {
    let mut rig = rig();
    let (cmd, rx) = start_cmd(rig.model_path.clone());
    rig.session.handle(cmd, &rig.tx);
    assert!(rx.blocking_recv().unwrap().is_ok());

    rig.session.handle(chunk(vec![0.0; 16_000]), &rig.tx);

    let (cmd, rx) = stop_cmd();
    rig.session.handle(cmd, &rig.tx);
    // Buffer is all zeros → below the RMS gate → no inference call.
    assert_eq!(rx.blocking_recv().unwrap().unwrap(), "");
    assert!(rig.session.transcriber.transcribed_lens.is_empty());
}

#[test]
fn tiny_recording_yields_empty_transcript() {
    let mut rig = rig();
    let (cmd, rx) = start_cmd(rig.model_path.clone());
    rig.session.handle(cmd, &rig.tx);
    assert!(rx.blocking_recv().unwrap().is_ok());

    rig.session.handle(chunk(loud_chunk(100)), &rig.tx); // < 100 ms

    let (cmd, rx) = stop_cmd();
    rig.session.handle(cmd, &rig.tx);
    assert_eq!(rx.blocking_recv().unwrap().unwrap(), "");
    assert!(rig.session.transcriber.transcribed_lens.is_empty());
}

#[test]
fn level_events_are_emitted_while_recording() {
    let mut rig = rig();
    let (cmd, rx) = start_cmd(rig.model_path.clone());
    rig.session.handle(cmd, &rig.tx);
    assert!(rx.blocking_recv().unwrap().is_ok());

    rig.session.handle(chunk(loud_chunk(800)), &rig.tx);

    let level = rig.sink.last_payload(VOICE_LEVEL_EVENT).unwrap();
    let level = level["level"].as_f64().unwrap();
    assert!((level - 0.3).abs() < 1e-3);
}

#[test]
fn chunks_are_ignored_when_not_recording() {
    let mut rig = rig();
    rig.session.handle(chunk(loud_chunk(1600)), &rig.tx);
    assert!(rig.session.buffer.is_empty());
    assert!(rig.sink.names().is_empty());
}
