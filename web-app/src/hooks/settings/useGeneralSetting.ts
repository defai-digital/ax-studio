import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import type { ApplyMode } from '@/lib/prompts/system-prompt'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage/storage'

type GeneralSettingState = {
  spellCheckChatInput: boolean
  tokenCounterCompact: boolean
  globalDefaultPrompt: string
  autoTuningEnabled: boolean
  applyMode: ApplyMode
  setSpellCheckChatInput: (value: boolean) => void
  setTokenCounterCompact: (value: boolean) => void
  setGlobalDefaultPrompt: (value: string) => void
  setAutoTuningEnabled: (value: boolean) => void
  setApplyMode: (value: ApplyMode) => void
}

function sanitizePersistedGeneralSettings<T>(value: T): T {
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
  } as T
}

// Keep stripping credentials written by older builds. The dedicated Hugging
// Face connection migrates the untouched legacy payload to secure storage.
const encryptedStorage = {
  getItem: (name: string) => {
    const item = safeStorageGetItem(localStorage, name, 'useGeneralSetting')
    if (!item) return null

    try {
      const parsed = JSON.parse(item)
      return sanitizePersistedGeneralSettings(parsed)
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
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      globalDefaultPrompt: '',
      autoTuningEnabled: false,
      applyMode: 'all_chats',
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setTokenCounterCompact: (value) => set({ tokenCounterCompact: value }),
      setGlobalDefaultPrompt: (value) => set({ globalDefaultPrompt: value }),
      setAutoTuningEnabled: (value) => set({ autoTuningEnabled: value }),
      setApplyMode: (value) => set({ applyMode: value }),
    }),
    {
      name: localStorageKey.settingGeneral,
      storage: encryptedStorage,
    }
  )
)
