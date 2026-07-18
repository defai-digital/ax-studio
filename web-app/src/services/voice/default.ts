/**
 * Default Voice Service - Web fallback (no-op)
 *
 * Voice input requires the desktop shell (Rust capture + whisper.cpp); in
 * web mode `isAvailable()` is false so the composer hides the mic button and
 * no command is ever invoked.
 */

import type {
  VoiceModelId,
  VoiceService,
  VoiceStatus,
} from './types'

export class DefaultVoiceService implements VoiceService {
  isAvailable(): boolean {
    return false
  }

  async startRecording(_model: VoiceModelId): Promise<void> {}

  async stopRecording(): Promise<string> {
    return ''
  }

  async cancelRecording(): Promise<void> {}

  async getStatus(_model: VoiceModelId): Promise<VoiceStatus> {
    return { state: 'idle', modelDownloaded: false, audioLevel: 0 }
  }

  async downloadModel(_model: VoiceModelId): Promise<void> {}

  async cancelModelDownload(_model: VoiceModelId): Promise<void> {}

  async deleteModel(_model: VoiceModelId): Promise<void> {}
}
