import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import {
  DEFAULT_VOICE_MODEL,
  type VoiceModelId,
} from '@/services/voice/types'

type VoiceSettingsState = {
  /**
   * Master switch for the composer mic button. Defaults on so users
   * discover dictation; the first click routes to Settings when no speech
   * model is downloaded yet. Turn off to hide the mic button.
   */
  voiceInputEnabled: boolean
  /** Whisper model used for transcription. */
  voiceModel: VoiceModelId
  setVoiceInputEnabled: (value: boolean) => void
  setVoiceModel: (value: VoiceModelId) => void
}

export const useVoiceSettings = create<VoiceSettingsState>()(
  persist(
    (set) => ({
      voiceInputEnabled: true,
      voiceModel: DEFAULT_VOICE_MODEL,
      setVoiceInputEnabled: (value) => set({ voiceInputEnabled: value }),
      setVoiceModel: (value) => set({ voiceModel: value }),
    }),
    {
      name: localStorageKey.voiceSettings,
    }
  )
)
