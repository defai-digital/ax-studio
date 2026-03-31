import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { ExtensionManager } from '@/lib/extension'
import { encrypt, decrypt } from '@/lib/crypto'
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

// Custom storage that encrypts/decrypts sensitive fields
const encryptedStorage: any = {
  getItem: (name: string) => {
    const item = localStorage.getItem(name)
    if (!item) return null

    try {
      const parsed = JSON.parse(item)
      // Decrypt huggingfaceToken if it exists
      if (parsed.state?.huggingfaceToken) {
        parsed.state.huggingfaceToken = decrypt(parsed.state.huggingfaceToken)
      }
      return parsed
    } catch {
      return null
    }
  },
  setItem: (name: string, value: any) => {
    try {
      const valueToStore = { ...value }
      // Encrypt huggingfaceToken if it exists
      if (valueToStore.state?.huggingfaceToken) {
        valueToStore.state.huggingfaceToken = encrypt(
          valueToStore.state.huggingfaceToken
        )
      }
      localStorage.setItem(name, JSON.stringify(valueToStore))
    } catch {
      // Fallback
    }
  },
  removeItem: (name: string) => {
    localStorage.removeItem(name)
  },
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
          .getByName('@ax-studio/download-extension')
          ?.getSettings()
          .then((settings) => {
            if (settings) {
              const newSettings = settings.map((e) =>
                e.key === 'hf-token'
                  ? {
                      ...e,
                      controllerProps: { ...e.controllerProps, value: token },
                    }
                  : e
              )
              ExtensionManager.getInstance()
                .getByName('@ax-studio/download-extension')
                ?.updateSettings(newSettings)
            }
          })
      },
    }),
    {
      name: localStorageKey.settingGeneral,
      storage: encryptedStorage,
    }
  )
)
