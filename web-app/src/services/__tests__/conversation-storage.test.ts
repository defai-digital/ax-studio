import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionManager } from '@/lib/extension'
import {
  runConversationalStorageMethod,
  CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE,
} from '../conversation-storage'

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(),
  },
}))

const mockExtension = {
  listThreads: vi.fn(),
  createThread: vi.fn(),
  modifyThread: vi.fn(),
  deleteThread: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  modifyMessage: vi.fn(),
  modifyMessages: vi.fn(),
  deleteMessage: vi.fn(),
}

const mockNativeApi = {
  listThreads: vi.fn(),
  createThread: vi.fn(),
  modifyThread: vi.fn(),
  deleteThread: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  modifyMessage: vi.fn(),
  modifyMessages: vi.fn(),
  deleteMessage: vi.fn(),
}

describe('conversation-storage', () => {
  let onFailure: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    onFailure = vi.fn()
    vi.mocked(ExtensionManager.getInstance).mockReturnValue({
      get: vi.fn().mockReturnValue(mockExtension),
    } as ReturnType<typeof ExtensionManager.getInstance>)
    window.core = { api: mockNativeApi } as unknown as typeof window.core
  })

  afterEach(() => {
    window.core = undefined
  })

  describe('runConversationalStorageMethod', () => {
    it('should prefer extension when it succeeds', async () => {
      const threadId = 'thread-1'
      const messages = [{ id: '1', thread_id: threadId, role: 'user' }]
      mockExtension.listMessages.mockResolvedValue(messages)

      const result = await runConversationalStorageMethod(
        'listMessages',
        [threadId],
        [{ threadId }],
        onFailure
      )

      expect(mockExtension.listMessages).toHaveBeenCalledWith(threadId)
      expect(mockNativeApi.listMessages).not.toHaveBeenCalled()
      expect(onFailure).not.toHaveBeenCalled()
      expect(result).toBe(messages)
    })

    it('should fall back to native API when extension fails', async () => {
      const thread = { id: 'thread-id' }
      mockExtension.listThreads.mockRejectedValueOnce(
        new Error('extension failure')
      )
      mockNativeApi.listThreads.mockResolvedValue([thread])

      const result = await runConversationalStorageMethod(
        'listThreads',
        [],
        [],
        onFailure
      )

      expect(mockExtension.listThreads).toHaveBeenCalled()
      expect(mockNativeApi.listThreads).toHaveBeenCalled()
      expect(onFailure).toHaveBeenCalledTimes(1)
      expect(result).toEqual([thread])
    })

    it('should throw when storage is unavailable', async () => {
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      } as ReturnType<typeof ExtensionManager.getInstance>)
      window.core = undefined as unknown as typeof window.core

      await expect(
        runConversationalStorageMethod(
          'deleteThread',
          ['thread-id'],
          [{ threadId: 'thread-id' }],
          onFailure
        )
      ).rejects.toThrow(CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE)

      expect(onFailure).not.toHaveBeenCalled()
    })

    it('should retry native API when extension and native both fail', async () => {
      const extensionError = new Error('extension failure')
      const nativeError = new Error('native failure')
      mockExtension.modifyMessage.mockRejectedValueOnce(extensionError)
      mockNativeApi.modifyMessage.mockRejectedValueOnce(nativeError)

      await expect(
        runConversationalStorageMethod(
          'modifyMessage',
          [{ id: 'm1', thread_id: 'thread-id', role: 'user' }],
          [{ message: { id: 'm1', thread_id: 'thread-id', role: 'user' } }],
          onFailure
        )
      ).rejects.toBe(nativeError)

      expect(onFailure).toHaveBeenCalledTimes(2)
      expect(onFailure).toHaveBeenNthCalledWith(1, extensionError)
      expect(onFailure).toHaveBeenNthCalledWith(2, nativeError)
    })
  })
})
