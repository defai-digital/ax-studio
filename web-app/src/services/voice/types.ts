/**
 * Voice Service Types
 * Types for voice input — local whisper.cpp speech-to-text
 * (tech spec DESKTOP-NATIVE §4.C)
 */

/** Recording state machine states, mirroring the Rust `RecorderState`. */
export type VoiceRecordingState = 'idle' | 'recording' | 'transcribing'

export type VoiceModelId = 'base.en' | 'small.en'

/** `voice_get_status` response (serde camelCase). */
export interface VoiceStatus {
  state: VoiceRecordingState
  modelDownloaded: boolean
  audioLevel: number
}

/** Error shape serialized by the Rust `VoiceError` (`{ kind, message }`). */
export interface VoiceErrorShape {
  kind:
    | 'mic-permission-denied'
    | 'mic-unavailable'
    | 'model-not-downloaded'
    | 'unknown-model'
    | 'recorder-busy'
    | 'not-recording'
    | 'capture'
    | 'transcription'
    | 'download'
    | 'internal'
  message?: string
}

export const VOICE_LEVEL_EVENT = 'voice-level'
export const VOICE_STATE_EVENT = 'voice-state'
export const VOICE_TRANSCRIPT_EVENT = 'voice-transcript'

/** `DownloadEvent` payload emitted on `download-voice-model-{id-with-dashes}`. */
export interface VoiceModelDownloadProgress {
  transferred: number
  total: number
}

export const VOICE_MODELS: Record<
  VoiceModelId,
  { id: VoiceModelId; label: string; sizeLabel: string }
> = {
  'base.en': {
    id: 'base.en',
    label: 'Base (English)',
    sizeLabel: '~142 MB',
  },
  'small.en': {
    id: 'small.en',
    label: 'Small (English)',
    sizeLabel: '~466 MB',
  }
}

export const DEFAULT_VOICE_MODEL: VoiceModelId = 'base.en'

/**
 * Download task id used by the Rust side; progress events arrive on
 * `download-{taskId}`. Task ids cannot contain `.` (Rust downloads policy),
 * hence the dash substitution.
 */
export const voiceModelDownloadTaskId = (model: VoiceModelId): string =>
  `voice-model-${model.replace(/\./g, '-')}`

export const voiceModelDownloadEvent = (model: VoiceModelId): string =>
  `download-${voiceModelDownloadTaskId(model)}`

/** Type guard for the typed error serialized by the Rust commands. */
export const isVoiceError = (error: unknown): error is VoiceErrorShape =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as VoiceErrorShape).kind === 'string'

export interface VoiceService {
  /** False on platforms without the desktop shell (web fallback). */
  isAvailable(): boolean
  /**
   * Start capturing microphone audio with `model`. Rejects with a
   * `VoiceErrorShape` (`model-not-downloaded`, `mic-permission-denied`, …).
   */
  startRecording(model: VoiceModelId): Promise<void>
  /** Stop recording and resolve with the on-device transcript. */
  stopRecording(): Promise<string>
  /** Abort the in-flight recording; captured audio is discarded. */
  cancelRecording(): Promise<void>
  /** Recorder state, mic level, and whether `model` is downloaded. */
  getStatus(model: VoiceModelId): Promise<VoiceStatus>
  /** Download a model; progress arrives on `voiceModelDownloadEvent(model)`. */
  downloadModel(model: VoiceModelId): Promise<void>
  /** Cancel an in-progress model download (no-op if none). */
  cancelModelDownload(model: VoiceModelId): Promise<void>
  /** Delete a downloaded model file. */
  deleteModel(model: VoiceModelId): Promise<void>
}
