import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { useAkidbConfig, createDefaultConfig } from './useAkidbConfig'
import type { AkidbConfig, AkidbStatus } from './useAkidbConfig'

describe('createDefaultConfig', () => {
  it('should create config with default values', () => {
    const config = createDefaultConfig()

    expect(config.fabric.data_root).toBe('~/.ax-studio/data')
    expect(config.fabric.max_storage_gb).toBe(50)
    expect(config.akidb.collection).toBe('default')
    expect(config.akidb.metric).toBe('cosine')
    expect(config.akidb.dimension).toBe(1536)
    expect(config.ingest.sources).toEqual([])
    expect(config.ingest.chunking.chunk_size).toBe(2800)
    expect(config.ingest.chunking.overlap).toBe(0.15)
    expect(config.embedder.type).toBe('http')
    expect(config.embedder.model_id).toBe('gte-qwen2-1.5b-instruct-q4_k_m')
    expect(config.embedder.batch_size).toBe(4)
    expect(config.schedule?.interval_minutes).toBe(60)
  })

  it('should include data folder as source when provided', () => {
    const config = createDefaultConfig('/home/user/documents')

    expect(config.ingest.sources).toEqual([{ path: '/home/user/documents' }])
  })

  it('should have empty sources when no data folder provided', () => {
    const config = createDefaultConfig()

    expect(config.ingest.sources).toEqual([])
  })
})

describe('useAkidbConfig store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state
    useAkidbConfig.setState({
      config: null,
      status: null,
      loading: false,
      saving: false,
      syncing: false,
      error: null,
    })
  })

  it('should initialize with null config and default flags', () => {
    const state = useAkidbConfig.getState()

    expect(state.config).toBe(null)
    expect(state.status).toBe(null)
    expect(state.loading).toBe(false)
    expect(state.saving).toBe(false)
    expect(state.syncing).toBe(false)
    expect(state.error).toBe(null)
  })

  describe('load', () => {
    it('should set loading true then false after successful load', async () => {
      const mockConfig: AkidbConfig = createDefaultConfig('/data')
      mockInvoke.mockResolvedValueOnce(mockConfig)

      const { load } = useAkidbConfig.getState()
      await load()

      const state = useAkidbConfig.getState()
      expect(state.loading).toBe(false)
      expect(state.config).toEqual(mockConfig)
      expect(state.error).toBe(null)
      expect(mockInvoke).toHaveBeenCalledWith('read_akidb_config')
    })

    it('should handle null config from backend', async () => {
      mockInvoke.mockResolvedValueOnce(null)

      await useAkidbConfig.getState().load()

      expect(useAkidbConfig.getState().config).toBe(null)
      expect(useAkidbConfig.getState().loading).toBe(false)
    })

    it('should set error on load failure', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Config file not found'))

      await useAkidbConfig.getState().load()

      const state = useAkidbConfig.getState()
      expect(state.loading).toBe(false)
      expect(state.error).toBe('Config file not found')
      expect(state.config).toBe(null)
    })

    it('should handle non-Error thrown values', async () => {
      mockInvoke.mockRejectedValueOnce('string error')

      await useAkidbConfig.getState().load()

      expect(useAkidbConfig.getState().error).toBe('string error')
    })
  })

  describe('save', () => {
    it('should save config and update store', async () => {
      const config = createDefaultConfig('/new-data')
      mockInvoke.mockResolvedValueOnce(undefined)

      await useAkidbConfig.getState().save(config)

      const state = useAkidbConfig.getState()
      expect(state.saving).toBe(false)
      expect(state.config).toEqual(config)
      expect(state.error).toBe(null)
      expect(mockInvoke).toHaveBeenCalledWith('write_akidb_config', { config })
    })

    it('should set error and re-throw on save failure', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Permission denied'))

      const config = createDefaultConfig()

      await expect(useAkidbConfig.getState().save(config)).rejects.toThrow(
        'Permission denied'
      )

      const state = useAkidbConfig.getState()
      expect(state.saving).toBe(false)
      expect(state.error).toBe('Permission denied')
    })

    it('should clear error before saving', async () => {
      useAkidbConfig.setState({ error: 'previous error' })
      mockInvoke.mockResolvedValueOnce(undefined)

      await useAkidbConfig.getState().save(createDefaultConfig())

      expect(useAkidbConfig.getState().error).toBe(null)
    })
  })

  describe('loadStatus', () => {
    it('should load status successfully', async () => {
      const mockStatus: AkidbStatus = {
        status: 'idle',
        config_loaded: true,
        data_folder: '/data',
        last_sync_at: '2024-01-01T00:00:00Z',
        total_files: 100,
        indexed_files: 90,
        pending_files: 10,
        error_files: 0,
        daemon_pid: 1234,
      }
      mockInvoke.mockResolvedValueOnce(mockStatus)

      await useAkidbConfig.getState().loadStatus()

      expect(useAkidbConfig.getState().status).toEqual(mockStatus)
      expect(mockInvoke).toHaveBeenCalledWith('read_akidb_status')
    })

    it('should set status to null on error', async () => {
      useAkidbConfig.setState({
        status: { status: 'idle' } as AkidbStatus,
      })
      mockInvoke.mockRejectedValueOnce(new Error('fail'))

      await useAkidbConfig.getState().loadStatus()

      expect(useAkidbConfig.getState().status).toBe(null)
    })
  })

  describe('syncNow', () => {
    it('should trigger sync and refresh status', async () => {
      const syncResult = {
        success: true,
        stdout: 'Synced 10 files',
        stderr: '',
      }
      const mockStatus: AkidbStatus = {
        status: 'idle',
        config_loaded: true,
        data_folder: '/data',
        last_sync_at: '2024-01-01T00:00:00Z',
        total_files: 110,
        indexed_files: 110,
        pending_files: 0,
        error_files: 0,
        daemon_pid: null,
      }
      mockInvoke
        .mockResolvedValueOnce(syncResult) // akidb_sync_now
        .mockResolvedValueOnce(mockStatus) // read_akidb_status (from loadStatus)

      const result = await useAkidbConfig.getState().syncNow()

      expect(result).toEqual(syncResult)
      expect(useAkidbConfig.getState().syncing).toBe(false)
      expect(useAkidbConfig.getState().status).toEqual(mockStatus)
      expect(mockInvoke).toHaveBeenCalledWith('akidb_sync_now')
    })

    it('should set error and re-throw on sync failure', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Sync failed'))

      await expect(useAkidbConfig.getState().syncNow()).rejects.toThrow(
        'Sync failed'
      )

      const state = useAkidbConfig.getState()
      expect(state.syncing).toBe(false)
      expect(state.error).toBe('Sync failed')
    })

    it('should clear error before syncing', async () => {
      useAkidbConfig.setState({ error: 'old error' })
      mockInvoke
        .mockResolvedValueOnce({ success: true, stdout: '', stderr: '' })
        .mockResolvedValueOnce(null)

      await useAkidbConfig.getState().syncNow()

      expect(useAkidbConfig.getState().error).toBe(null)
    })

    it('should handle non-Error thrown values in sync', async () => {
      mockInvoke.mockRejectedValueOnce('raw string error')

      await expect(useAkidbConfig.getState().syncNow()).rejects.toBe(
        'raw string error'
      )

      expect(useAkidbConfig.getState().error).toBe('raw string error')
    })
  })
})
