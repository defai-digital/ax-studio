import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import type { ApplyMode } from '@/lib/system-prompt'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage'

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

export function sanitizePersistedGeneralSettings(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value
  }

  const persistedValue = value as Record<string, unknown>
  const state =
    persistedValue.state && typeof persistedValue.state === 'object'
      ? { ...(persistedValue.state as Record<string, unknown>) }
      : persistedValue.state

  if (state && typeof state === 'object' && 'huggingfaceToken' in state) {
    delete state.huggingfaceToken
  }

  return {
    ...persistedValue,
    state,
  }
}

// Sensitive tokens are intentionally kept in-memory only. They are omitted from
// persisted localStorage state until the app has a real secure storage backend.
const encryptedStorage = {
  getItem: (name: string) => {
    const item = safeStorageGetItem(localStorage, name, 'useGeneralSetting')
    if (!item) return null

    try {
      const parsed = JSON.parse(item)
      return parsed
    } catch {
      return null
    }
  },
  setItem: (name: string, value: unknown) => {
    try {
      safeStorageSetItem(
        localStorage,
        name,
        JSON.stringify(sanitizePersistedGeneralSettings(value)),
        'useGeneralSetting'
      )
    } catch {
      // Fallback
    }
  },
  removeItem: (name: string) => {
    safeStorageRemoveItem(localStorage, name, 'useGeneralSetting')
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
      setHuggingfaceToken: (token) => set({ huggingfaceToken: token }),
    }),
    {
      name: localStorageKey.settingGeneral,
      storage: encryptedStorage,
    }
  )
)
