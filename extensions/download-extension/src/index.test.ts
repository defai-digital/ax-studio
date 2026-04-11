import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetAppDataFolderPath, mockValidateUrlProtocol } = vi.hoisted(() => ({
  mockGetAppDataFolderPath: vi.fn(),
  mockValidateUrlProtocol: vi.fn(),
}))

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
  getAppDataFolderPath: mockGetAppDataFolderPath,
  validateUrlProtocol: mockValidateUrlProtocol,
}))

// Provide SETTINGS global (normally injected by rolldown)
;(globalThis as Record<string, unknown>).SETTINGS = []

import AxStudioDownloadManager from './index'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

describe('AxStudioDownloadManager', () => {
  let manager: AxStudioDownloadManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new AxStudioDownloadManager('', '')
    mockGetAppDataFolderPath.mockResolvedValue('/app/data')
    mockValidateUrlProtocol.mockImplementation(() => {})
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

  describe('onLoad', () => {
    it('registers settings without loading persisted secrets', async () => {
      const registerSpy = vi.spyOn(manager, 'registerSettings').mockResolvedValue()

      await manager.onLoad()

      expect(registerSpy).toHaveBeenCalledWith([])
    })
  })

  describe('downloadFile', () => {
    it('calls downloadFiles with correct item structure', async () => {
      const mockListen = vi.mocked(listen)
      mockListen.mockResolvedValue(vi.fn())
      vi.mocked(invoke).mockResolvedValue(undefined)

      await manager.downloadFile(
        'https://example.com/model.gguf',
        '/app/data/save/path/model.gguf',
        'task-1'
      )

      expect(invoke).toHaveBeenCalledWith('download_files', {
        items: [{ url: 'https://example.com/model.gguf', save_path: '/app/data/save/path/model.gguf' }],
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
        'models/model.gguf',
        'task-1',
        { url: 'http://proxy:8080' }
      )

      expect(invoke).toHaveBeenCalledWith('download_files', {
        items: [
            {
              url: 'https://example.com/model.gguf',
              save_path: 'models/model.gguf',
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
        'models/model.gguf',
        'task-1',
        {}
      )

      const invokeCall = vi.mocked(invoke).mock.calls[0]
      const args = invokeCall[1] as Record<string, unknown>
      const items = args.items as Array<Record<string, unknown>>
      expect(items[0].proxy).toBeUndefined()
    })

    it('passes request headers through without persisting them', async () => {
      const mockListen = vi.mocked(listen)
      mockListen.mockResolvedValue(vi.fn())
      vi.mocked(invoke).mockResolvedValue(undefined)

      await manager.downloadFile(
        'https://example.com/model.gguf',
        'models/model.gguf',
        'task-1',
        null,
        { Authorization: 'Bearer hf_abc123' }
      )

      expect(invoke).toHaveBeenCalledWith('download_files', {
        items: [{ url: 'https://example.com/model.gguf', save_path: 'models/model.gguf' }],
        taskId: 'task-1',
        headers: { Authorization: 'Bearer hf_abc123' },
      })
    })
  })

  describe('downloadFiles', () => {
    it('rejects empty item arrays before invoking Tauri', async () => {
      await expect(manager.downloadFiles([], 'task-1')).rejects.toThrow(
        'downloadFiles requires at least one item'
      )

      expect(listen).not.toHaveBeenCalled()
      expect(invoke).not.toHaveBeenCalled()
    })

    it('sets up event listener with sanitized task ID', async () => {
      const mockUnlisten = vi.fn()
      vi.mocked(listen).mockResolvedValue(mockUnlisten)
      vi.mocked(invoke).mockResolvedValue(undefined)

      await manager.downloadFiles(
        [{ url: 'https://example.com/file', save_path: 'models/file.gguf' }],
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
        [{ url: 'https://example.com/file', save_path: 'models/file.gguf' }],
        'task-1',
        undefined,
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
          [{ url: 'https://example.com/file', save_path: 'models/file.gguf' }],
          'task-1'
        )
      ).rejects.toThrow('download failed')

      expect(mockUnlisten).toHaveBeenCalled()
    })

    it('drains queued progress callbacks before unlistening', async () => {
      const order: string[] = []
      const mockUnlisten = vi.fn(() => {
        order.push('unlisten')
      })
      let listenCallback:
        | ((event: { payload: { transferred: number; total: number } }) => void)
        | null = null

      vi.mocked(listen).mockImplementation(async (_event, callback) => {
        listenCallback = callback as typeof listenCallback
        return mockUnlisten
      })
      vi.mocked(invoke).mockImplementation(async () => {
        queueMicrotask(() => {
          order.push('progress')
          listenCallback?.({ payload: { transferred: 100, total: 100 } })
        })
      })

      const onProgress = vi.fn(() => {
        order.push('callback')
      })

      await manager.downloadFiles(
        [{ url: 'https://example.com/file', save_path: 'models/file.gguf' }],
        'task-1',
        undefined,
        onProgress
      )

      expect(order).toEqual(['progress', 'callback', 'unlisten'])
    })

    it('rejects invalid URL protocols before invoking Tauri', async () => {
      mockValidateUrlProtocol.mockImplementation(() => {
        throw new Error('Unsafe URL protocol: file:')
      })

      await expect(
        manager.downloadFiles(
          [{ url: 'file:///tmp/model.gguf', save_path: 'models/file.gguf' }],
          'task-1'
        )
      ).rejects.toThrow('Unsafe URL protocol: file:')

      expect(listen).not.toHaveBeenCalled()
      expect(invoke).not.toHaveBeenCalled()
    })

    it('rejects absolute save paths outside the app data folder', async () => {
      await expect(
        manager.downloadFiles(
          [{ url: 'https://example.com/file', save_path: '/outside/app-data/file.gguf' }],
          'task-1'
        )
      ).rejects.toThrow(
        'Download save path must stay within the Ax-Studio data folder: /outside/app-data/file.gguf'
      )

      expect(listen).not.toHaveBeenCalled()
      expect(invoke).not.toHaveBeenCalled()
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
