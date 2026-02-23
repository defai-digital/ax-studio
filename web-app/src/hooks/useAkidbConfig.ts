import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type AkidbConfig = {
  'data-folder': string
  frequency: number // minutes between reconciliation scans; 0 = real-time only
}

type AkidbConfigStore = {
  config: AkidbConfig | null // null = ~/.akidb/config.yaml does not exist yet
  loading: boolean
  saving: boolean
  error: string | null

  /** Read current config from ~/.akidb/config.yaml via Tauri command */
  load: () => Promise<void>

  /** Write updated config to ~/.akidb/config.yaml via Tauri command */
  save: (config: AkidbConfig) => Promise<void>
}

export const useAkidbConfig = create<AkidbConfigStore>()((set) => ({
  config: null,
  loading: false,
  saving: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const config = await invoke<AkidbConfig | null>('read_akidb_config')
      set({ config })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ loading: false })
    }
  },

  save: async (config: AkidbConfig) => {
    set({ saving: true, error: null })
    try {
      await invoke('write_akidb_config', { config })
      set({ config })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      throw e // re-throw so the calling component can show a toast
    } finally {
      set({ saving: false })
    }
  },
}))
