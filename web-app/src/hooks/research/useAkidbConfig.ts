import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

// ─── Config types matching the Rust AkidbConfig struct ─────────────────────

export type IngestSource = {
  path: string
}

export type IngestChunking = {
  chunk_size: number
  overlap: number
}

export type FabricSection = {
  data_root: string
  max_storage_gb: number
}

export type AkidbSection = {
  root: string
  collection: string
  metric: 'cosine' | 'l2' | 'dot'
  dimension: number
}

export type IngestSection = {
  sources: IngestSource[]
  chunking: IngestChunking
}

export type EmbedderSection = {
  type: 'local' | 'http' | 'cloudflare' | 'mcp'
  model_id: string
  dimension: number
  batch_size: number
  timeout_ms?: number
  base_url?: string
  api_key?: string
  api_key_env?: string
}

export type ScheduleSection = {
  interval_minutes: number
}

export type AkidbConfig = {
  fabric: FabricSection
  akidb: AkidbSection
  ingest: IngestSection
  embedder: EmbedderSection
  schedule?: ScheduleSection
}

export type AkidbStatus = {
  status: 'idle' | 'syncing' | 'error'
  config_loaded: boolean
  data_folder: string | null
  last_sync_at: string | null
  total_files: number
  indexed_files: number
  pending_files: number
  error_files: number
  daemon_pid: number | null
}

// ─── Default config factory ────────────────────────────────────────────────

export function createDefaultConfig(dataFolder?: string): AkidbConfig {
  return {
    fabric: {
      data_root: '~/.ax-studio/data',
      max_storage_gb: 50,
    },
    akidb: {
      root: '~/.ax-studio/data/akidb',
      collection: 'default',
      metric: 'cosine',
      dimension: 1536,
    },
    ingest: {
      sources: dataFolder ? [{ path: dataFolder }] : [],
      chunking: {
        chunk_size: 2800,
        overlap: 0.15,
      },
    },
    embedder: {
      type: 'http',
      model_id: 'gte-qwen2-1.5b-instruct-q4_k_m',
      dimension: 1536,
      batch_size: 4,
      timeout_ms: 120000,
      base_url: 'http://127.0.0.1:18080',
    },
    schedule: {
      interval_minutes: 60,
    },
  }
}

// ─── Store ─────────────────────────────────────────────────────────────────

type AkidbSyncResult = {
  success: boolean
  stdout: string
  stderr: string
}

type AkidbConfigStore = {
  config: AkidbConfig | null
  status: AkidbStatus | null
  loading: boolean
  saving: boolean
  syncing: boolean
  error: string | null

  /** Read current config from the AX Studio path, with legacy fallback via Tauri */
  load: () => Promise<void>

  /** Write updated config to the AX Studio path and mirror legacy compatibility files */
  save: (config: AkidbConfig) => Promise<void>

  /** Read daemon status from the AX Studio path, with legacy fallback */
  loadStatus: () => Promise<void>

  /** Trigger a one-shot knowledge-base sync (daemon --once) */
  syncNow: () => Promise<AkidbSyncResult>
}

export const useAkidbConfig = create<AkidbConfigStore>()((set, get) => ({
  config: null,
  status: null,
  loading: false,
  saving: false,
  syncing: false,
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
      throw e
    } finally {
      set({ saving: false })
    }
  },

  loadStatus: async () => {
    try {
      const status = await invoke<AkidbStatus | null>('read_akidb_status')
      set({ status })
    } catch {
      set({ status: null })
    }
  },

  syncNow: async () => {
    set({ syncing: true, error: null })
    try {
      const result = await invoke<AkidbSyncResult>('akidb_sync_now')
      // Refresh status after sync completes
      await get().loadStatus()
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ error: msg })
      throw e
    } finally {
      set({ syncing: false })
    }
  },
}))
