import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { ExtensionManager } from '@/lib/extension'
import type { ApplyMode } from '@/lib/system-prompt'
type GeneralSettingState = {
  currentLanguage: Language
  spellCheckChatInput: boolean
  tokenCounterCompact: boolean
  huggingfaceToken?: string
  globalDefaultPrompt: string
  autoTuningEnabled: boolean
  applyMode: ApplyMode
  setHuggingfaceToken: (token: string) => void
  setSpellCheckChatInput: (value: boolean) => void
  setTokenCounterCompact: (value: boolean) => void
  setCurrentLanguage: (value: Language) => void
  setGlobalDefaultPrompt: (value: string) => void
  setAutoTuningEnabled: (value: boolean) => void
  setApplyMode: (value: ApplyMode) => void
}

export const useGeneralSetting = create<GeneralSettingState>()(
  persist(
    (set) => ({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      huggingfaceToken: undefined,
      globalDefaultPrompt: '',
      autoTuningEnabled: false,
      applyMode: 'all_chats',
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setTokenCounterCompact: (value) => set({ tokenCounterCompact: value }),
      setCurrentLanguage: (value) => set({ currentLanguage: value }),
      setGlobalDefaultPrompt: (value) => set({ globalDefaultPrompt: value }),
      setAutoTuningEnabled: (value) => set({ autoTuningEnabled: value }),
      setApplyMode: (value) => set({ applyMode: value }),
      setHuggingfaceToken: (token) => {
        set({ huggingfaceToken: token })
        ExtensionManager.getInstance()
          .getByName('@ax-fabric/download-extension')
          ?.getSettings()
          .then((settings) => {
            if (settings) {
              const newSettings = settings.map((e) => {
                if (e.key === 'hf-token') {
                  e.controllerProps.value = token
                }
                return e
              })
              ExtensionManager.getInstance()
                .getByName('@ax-fabric/download-extension')
                ?.updateSettings(newSettings)
            }
          })
      },
    }),
    {
      name: localStorageKey.settingGeneral,
      storage: createJSONStorage(() => localStorage),
    }
  )
)


