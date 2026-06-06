import { create } from 'zustand'
import { type SettingComponentProps } from '@ax-studio/core'

export type AttachmentsSettings = {
  enabled: boolean
  maxFileSizeMB: number
  retrievalLimit: number
  retrievalThreshold: number
  chunkSizeChars: number
  overlapChars: number
  searchMode: 'auto' | 'ann' | 'linear'
  parseMode: 'auto' | 'inline' | 'embeddings' | 'prompt'
  autoInlineContextRatio: number
}

type AttachmentsStore = AttachmentsSettings & {
  // Dynamic controller definitions for rendering UI
  settingsDefs: SettingComponentProps[]
  loadSettingsDefs: () => Promise<boolean>
  setEnabled: (v: boolean) => void
  setMaxFileSizeMB: (v: number) => void
  setRetrievalLimit: (v: number) => void
  setRetrievalThreshold: (v: number) => void
  setChunkSizeChars: (v: number) => void
  setOverlapChars: (v: number) => void
  setSearchMode: (v: 'auto' | 'ann' | 'linear') => void
  setParseMode: (v: 'auto' | 'inline' | 'embeddings' | 'prompt') => void
  setAutoInlineContextRatio: (v: number) => void
}

export const useAttachments = create<AttachmentsStore>()((set) => ({
  enabled: true,
  maxFileSizeMB: 20,
  retrievalLimit: 3,
  retrievalThreshold: 0.3,
  chunkSizeChars: 512,
  overlapChars: 64,
  searchMode: 'auto',
  parseMode: 'auto',
  autoInlineContextRatio: 0.75,
  settingsDefs: [],
  loadSettingsDefs: async () => {
    // RAGExtension removed; settings are managed locally only
    return false
  },
  setEnabled: (v) => {
    set((s) => ({
      enabled: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'enabled'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: !!v },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setMaxFileSizeMB: (val) => {
    set((s) => ({
      maxFileSizeMB: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'max_file_size_mb'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setRetrievalLimit: (val) => {
    set((s) => ({
      retrievalLimit: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'retrieval_limit'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setRetrievalThreshold: (val) => {
    set((s) => ({
      retrievalThreshold: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'retrieval_threshold'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setChunkSizeChars: (val) => {
    set((s) => ({
      chunkSizeChars: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'chunk_size_chars'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setOverlapChars: (val) => {
    set((s) => ({
      overlapChars: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'overlap_chars'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setSearchMode: (v) => {
    set((s) => ({
      searchMode: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'search_mode'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: v },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setParseMode: (v) => {
    set((s) => ({
      parseMode: v,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'parse_mode'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: v },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
  setAutoInlineContextRatio: (val) => {
    set((s) => ({
      autoInlineContextRatio: val,
      settingsDefs: s.settingsDefs.map((d) =>
        d.key === 'auto_inline_context_ratio'
          ? ({
              ...d,
              controllerProps: { ...d.controllerProps, value: val },
            } as SettingComponentProps)
          : d
      ),
    }))
  },
}))
