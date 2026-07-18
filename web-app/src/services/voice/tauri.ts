/**
 * Tauri Voice Service - Desktop implementation
 *
 * Thin wrappers over the Rust voice commands (`src-tauri/src/core/voice`).
 * Typed `VoiceError` rejections cross IPC as `{ kind, message }` and are
 * rethrown untouched so callers can switch on `kind`.
 */

import { invoke } from '@tauri-apps/api/core'
import type {
  VoiceModelId,
  VoiceService,
  VoiceStatus,
} from './types'
import { voiceModelDownloadTaskId } from './types'

export class TauriVoiceService implements VoiceService {
  isAvailable(): boolean {
    return true
  }

  async startRecording(model: VoiceModelId): Promise<void> {
    await invoke<void>('voice_start_recording', { model })
  }

  async stopRecording(): Promise<string> {
    return invoke<string>('voice_stop_recording')
  }

  async cancelRecording(): Promise<void> {
    await invoke<void>('voice_cancel_recording')
  }

  async getStatus(model: VoiceModelId): Promise<VoiceStatus> {
    return invoke<VoiceStatus>('voice_get_status', { model })
  }

  async downloadModel(model: VoiceModelId): Promise<void> {
    await invoke<void>('voice_download_model', { model })
  }

  async cancelModelDownload(model: VoiceModelId): Promise<void> {
    try {
      await invoke<void>('cancel_download_task', {
        taskId: voiceModelDownloadTaskId(model),
      })
    } catch (error) {
      // Cancelling when no task is running is expected — the downloads
      // manager answers "No download task" in that case.
      console.debug('cancelModelDownload:', error)
    }
  }

  async deleteModel(model: VoiceModelId): Promise<void> {
    await invoke<void>('voice_delete_model', { model })
  }
}
