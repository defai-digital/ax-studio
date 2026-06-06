import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Tauri APIs before import
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))

vi.mock('@ax-studio/core', () => ({
  BaseExtension: class {
    name = ''
    url = ''
    active = false
    description = ''
    version = ''
    constructor() {}
    type() { return undefined }
    async registerSettings(_settings: unknown[]) {}
    async getSetting<T>(_key: string, defaultValue: T) { return defaultValue }
    onSettingUpdate() {}
    async getSettings() { return [] }
    async updateSettings() {}
  },
  events: {
    emit: vi.fn(),
  },
}))

// Provide SETTINGS global (normally injected by rolldown)
;(globalThis as Record<string, unknown>).SETTINGS = []

import AxStudioDownloadManager, { Settings } from './index'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

describe('AxStudioDownloadManager', () => {
  let manager: AxStudioDownloadManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new AxStudioDownloadManager('', '')
  })

  describe('Settings enum', () => {
    it('defines hfToken setting key', () => {
      expect(Settings.hfToken).toBe('hf-token')
    })
  })

  describe('_sanitizeTaskId', () => {
    it('replaces dots with underscores', () => {
      // Access private method via casting
      const result = (manager as any)._sanitizeTaskId('Qwen3.5-27B')
      expect(result).toBe('Qwen3_5-27B')
    })

    it('preserves valid characters', () => {
      const result = (manager as any)._sanitizeTaskId('my-model/v1:latest_tag')
      expect(result).toBe('my-model/v1:latest_tag')
    })

    it('replaces multiple invalid characters', () => {
      const result = (manager as any)._sanitizeTaskId('model@v1.0+beta')
      expect(result).toBe('model_v1_0_beta')
    })

    it('handles already-valid task IDs', () => {
      const result = (manager as any)._sanitizeTaskId('simple-task-123')
      expect(result).toBe('simple-task-123')
    })
  })

  describe('_getHeaders', () => {
    it('returns empty object when no hfToken', () => {
      manager.hfToken = undefined
      const headers = manager._getHeaders()
      expect(headers).toEqual({})
    })

    it('returns Authorization header when hfToken is set', () => {
      manager.hfToken = 'hf_abc123'
      const headers = manager._getHeaders()
      expect(headers).toEqual({ Authorization: 'Bearer hf_abc123' })
    })

    it('returns empty object when hfToken is empty string', () => {
      manager.hfToken = ''
      const headers = manager._getHeaders()
      expect(headers).toEqual({})
    })
  })

  describe('onSettingUpdate', () => {
    it('updates hfToken when key matches', () => {
      manager.onSettingUpdate(Settings.hfToken, 'new-token')
      expect(manager.hfToken).toBe('new-token')
    })

    it('does not update hfToken for other keys', () => {
      manager.hfToken = 'original'
      manager.onSettingUpdate('other-key', 'value')
      expect(manager.hfToken).toBe('original')
    })
  })

  describe('downloadFile', () => {
    it('calls downloadFiles with correct item structure', async () => {
      const mockListen = vi.mocked(listen)
      mockListen.mockResolvedValue(vi.fn())
      vi.mocked(invoke).mockResolvedValue(undefined)

      await manager.downloadFile(
        'https://example.com/model.gguf',
        '/save/path/model.gguf',
        'task-1'
      )

      expect(invoke).toHaveBeenCalledWith('download_files', {
        items: [{ url: 'https://example.com/model.gguf', save_path: '/save/path/model.gguf' }],
        taskId: 'task-1',
        headers: {},
      })
    })

    it('includes proxy when provided', async () => {
      const mockListen = vi.mocked(listen)
      mockListen.mockResolvedValue(vi.fn())
      vi.mocked(invoke).mockResolvedValue(undefined)

      await manager.downloadFile(
        'https://example.com/model.gguf',
        '/save/path',
        'task-1',
        { url: 'http://proxy:8080' }
      )

      expect(invoke).toHaveBeenCalledWith('download_files', {
        items: [
          {
            url: 'https://example.com/model.gguf',
            save_path: '/save/path',
            proxy: { url: 'http://proxy:8080' },
          },
        ],
        taskId: 'task-1',
        headers: {},
      })
    })

    it('does not include proxy for empty object', async () => {
      const mockListen = vi.mocked(listen)
      mockListen.mockResolvedValue(vi.fn())
      vi.mocked(invoke).mockResolvedValue(undefined)

      await manager.downloadFile(
        'https://example.com/model.gguf',
        '/save/path',
        'task-1',
        {}
      )

      const invokeCall = vi.mocked(invoke).mock.calls[0]
      const args = invokeCall[1] as Record<string, unknown>
      const items = args.items as Array<Record<string, unknown>>
      expect(items[0].proxy).toBeUndefined()
    })
  })

  describe('downloadFiles', () => {
    it('sets up event listener with sanitized task ID', async () => {
      const mockUnlisten = vi.fn()
      vi.mocked(listen).mockResolvedValue(mockUnlisten)
      vi.mocked(invoke).mockResolvedValue(undefined)

      await manager.downloadFiles(
        [{ url: 'https://example.com/file', save_path: '/path' }],
        'model.v1.0'
      )

      expect(listen).toHaveBeenCalledWith('download-model_v1_0', expect.any(Function))
      expect(mockUnlisten).toHaveBeenCalled()
    })

    it('calls onProgress callback with event payload', async () => {
      const mockUnlisten = vi.fn()
      let listenCallback: ((event: { payload: { transferred: number; total: number } }) => void) | null = null

      vi.mocked(listen).mockImplementation(async (_event, callback) => {
        listenCallback = callback as typeof listenCallback
        return mockUnlisten
      })
      vi.mocked(invoke).mockImplementation(async () => {
        if (listenCallback) {
          listenCallback({ payload: { transferred: 50, total: 100 } })
        }
      })

      const onProgress = vi.fn()
      await manager.downloadFiles(
        [{ url: 'https://example.com/file', save_path: '/path' }],
        'task-1',
        onProgress
      )

      expect(onProgress).toHaveBeenCalledWith(50, 100)
    })

    it('cleans up listener on error', async () => {
      const mockUnlisten = vi.fn()
      vi.mocked(listen).mockResolvedValue(mockUnlisten)
      vi.mocked(invoke).mockRejectedValue(new Error('download failed'))

      await expect(
        manager.downloadFiles(
          [{ url: 'https://example.com/file', save_path: '/path' }],
          'task-1'
        )
      ).rejects.toThrow('download failed')

      expect(mockUnlisten).toHaveBeenCalled()
    })
  })

  describe('cancelDownload', () => {
    it('invokes cancel with sanitized task ID', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)

      await manager.cancelDownload('model.v2.0')

      expect(invoke).toHaveBeenCalledWith('cancel_download_task', {
        taskId: 'model_v2_0',
      })
    })

    it('rethrows errors from invoke', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('cancel failed'))

      await expect(manager.cancelDownload('task-1')).rejects.toThrow('cancel failed')
    })
  })
})
