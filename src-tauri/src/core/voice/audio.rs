//! Pure audio helpers: channel downmix, resampling to 16 kHz mono f32,
//! RMS level, and silence detection. No hardware access — everything here is
//! unit-testable.

/// Sample rate whisper.cpp expects.
pub const WHISPER_SAMPLE_RATE: u32 = 16_000;

/// RMS below this counts as silence for the auto-stop detector. Typical mic
/// noise floors sit under 0.005; speech peaks well above 0.02.
pub const SILENCE_RMS_THRESHOLD: f32 = 0.01;

/// Continuous silence after which recording stops and transcribes itself.
pub const SILENCE_AUTO_STOP_SECS: f32 = 12.0;

/// Hard cap on a single recording so a stuck auto-stop can never grow the
/// buffer without bound (5 minutes at 16 kHz ≈ 19 MB of f32).
pub const MAX_RECORDING_SAMPLES: usize = 300 * WHISPER_SAMPLE_RATE as usize;

/// Root-mean-square amplitude of `samples` (0.0 for empty input).
pub fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// Downmix interleaved multi-channel `samples` to mono and resample to
/// 16 kHz via linear interpolation. Input is expected to be f32 normalized
/// to roughly [-1.0, 1.0].
pub fn resample_to_16khz_mono(samples: &[f32], channels: u16, sample_rate: u32) -> Vec<f32> {
    let channels = channels.max(1) as usize;

    // Downmix to mono by averaging each frame's channels.
    let mono: Vec<f32> = if channels == 1 {
        samples.to_vec()
    } else {
        samples
            .chunks(channels)
            .filter(|frame| !frame.is_empty())
            .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
            .collect()
    };

    if sample_rate == WHISPER_SAMPLE_RATE || mono.is_empty() {
        return mono;
    }

    // Linear-interpolation resample. Positions map `out[i]` to
    // `in[i * src/dst]`; adequate for speech at these rates.
    let ratio = sample_rate as f64 / WHISPER_SAMPLE_RATE as f64;
    let out_len = (mono.len() as f64 / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let idx = pos.floor() as usize;
        let frac = (pos - idx as f64) as f32;
        let a = mono[idx];
        let b = mono.get(idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}

/// Convert interleaved i16 PCM to normalized f32.
pub fn i16_samples_to_f32(samples: &[i16]) -> Vec<f32> {
    samples
        .iter()
        .map(|s| *s as f32 / i16::MAX as f32)
        .collect()
}

/// Convert interleaved u16 PCM to normalized f32.
pub fn u16_samples_to_f32(samples: &[u16]) -> Vec<f32> {
    samples
        .iter()
        .map(|s| (*s as f32 - 32768.0) / 32768.0)
        .collect()
}

/// Counts consecutive below-threshold samples and reports when the run
/// exceeds the auto-stop duration. Sample-count based (no wall clock), so
/// the detector is deterministic under test.
#[derive(Debug, Clone)]
pub struct SilenceDetector {
    threshold: f32,
    max_silent_samples: usize,
    silent_run: usize,
}

impl SilenceDetector {
    pub fn new(threshold: f32, max_silence_secs: f32) -> Self {
        Self {
            threshold,
            max_silent_samples: (max_silence_secs * WHISPER_SAMPLE_RATE as f32) as usize,
            silent_run: 0,
        }
    }

    /// Feed one chunk: its RMS and its length (in 16 kHz samples). Returns
    /// true exactly on the chunk that crosses the auto-stop threshold.
    pub fn update(&mut self, rms: f32, chunk_samples: usize) -> bool {
        if rms < self.threshold {
            self.silent_run += chunk_samples;
            self.silent_run >= self.max_silent_samples
        } else {
            self.silent_run = 0;
            false
        }
    }

    pub fn reset(&mut self) {
        self.silent_run = 0;
    }
}

impl Default for SilenceDetector {
    fn default() -> Self {
        Self::new(SILENCE_RMS_THRESHOLD, SILENCE_AUTO_STOP_SECS)
    }
}
