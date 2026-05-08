import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultMessagesService } from '../messages/default'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum } from '@ax-studio/core'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

// Mock the ExtensionManager
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(() => ({
      get: vi.fn(),
    })),
  },
}))

describe('DefaultMessagesService', () => {
  let messagesService: DefaultMessagesService

  const mockExtension = {
    listMessages: vi.fn(),
    createMessage: vi.fn(),
    modifyMessage: vi.fn(),
    deleteMessage: vi.fn(),
  }

  const mockExtensionManager = {
    get: vi.fn(),
  }

  const mockNativeApi = {
    listMessages: vi.fn(),
    createMessage: vi.fn(),
    modifyMessage: vi.fn(),
    deleteMessage: vi.fn(),
  }

  beforeEach(() => {
    messagesService = new DefaultMessagesService()
    vi.clearAllMocks()
    // @ts-expect-error test-only core bridge
    window.core = undefined
    vi.mocked(ExtensionManager.getInstance).mockReturnValue(
      mockExtensionManager as ReturnType<typeof ExtensionManager.getInstance>
    )
    mockExtensionManager.get.mockReturnValue(mockExtension)
  })

  describe('fetchMessages', () => {
    it('should fetch messages successfully', async () => {
      const threadId = 'thread-123'
      const mockMessages = [
        { id: 'msg-1', threadId, content: 'Hello', role: 'user' },
        { id: 'msg-2', threadId, content: 'Hi there!', role: 'assistant' },
      ]
      mockExtension.listMessages.mockResolvedValue(mockMessages)

      const result = await messagesService.fetchMessages(threadId)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(
        ExtensionTypeEnum.Conversational
      )
      expect(mockExtension.listMessages).toHaveBeenCalledWith(threadId)
      expect(result).toEqual(mockMessages)
    })

    it('should return empty array when storage is unavailable', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      const threadId = 'thread-123'

      const result = await messagesService.fetchMessages(threadId)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(
        ExtensionTypeEnum.Conversational
      )
      expect(result).toEqual([])
    })

    it('should fall back to native storage when extension is not found', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      // @ts-expect-error test-only core bridge
      window.core = { api: mockNativeApi }
      const threadId = 'thread-123'
      const mockMessages = [{ id: 'msg-1', thread_id: threadId, role: 'user' }]
      mockNativeApi.listMessages.mockResolvedValue(mockMessages)

      const result = await messagesService.fetchMessages(threadId)

      expect(mockNativeApi.listMessages).toHaveBeenCalledWith({ threadId })
      expect(result).toEqual(mockMessages)
    })

    it('should fall back to native storage when extension list fails', async () => {
      // @ts-expect-error test-only core bridge
      window.core = { api: mockNativeApi }
      const threadId = 'thread-123'
      const mockMessages = [{ id: 'msg-1', thread_id: threadId, role: 'user' }]
      mockExtension.listMessages.mockRejectedValueOnce(new Error('Extension missing file'))
      mockNativeApi.listMessages.mockResolvedValue(mockMessages)

      const result = await messagesService.fetchMessages(threadId)

      expect(mockExtension.listMessages).toHaveBeenCalledWith(threadId)
      expect(mockNativeApi.listMessages).toHaveBeenCalledWith({ threadId })
      expect(result).toEqual(mockMessages)
    })

    it('should return empty array when listMessages fails', async () => {
      const threadId = 'thread-123'
      mockExtension.listMessages.mockRejectedValue(
        new Error('Failed to list messages')
      )

      const result = await messagesService.fetchMessages(threadId)

      expect(result).toEqual([])
    })

    it('should handle undefined listMessages response', async () => {
      const threadId = 'thread-123'
      mockExtension.listMessages.mockReturnValue(undefined)

      const result = await messagesService.fetchMessages(threadId)

      expect(result).toEqual([])
    })

    it('should return empty array for TEMPORARY_CHAT_ID without calling extension', async () => {
      const result = await messagesService.fetchMessages(TEMPORARY_CHAT_ID)

      expect(result).toEqual([])
      expect(mockExtensionManager.get).not.toHaveBeenCalled()
    })
  })

  describe('createMessage', () => {
    it('should create message successfully', async () => {
      const message = {
        id: 'msg-1',
        thread_id: 'thread-123',
        content: 'Hello',
        role: 'user',
      }
      mockExtension.createMessage.mockResolvedValue(message)

      const result = await messagesService.createMessage(message as never)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(
        ExtensionTypeEnum.Conversational
      )
      expect(mockExtension.createMessage).toHaveBeenCalledWith(message)
      expect(result).toEqual(message)
    })

    it('should throw when storage is unavailable', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      const message = {
        id: 'msg-1',
        thread_id: 'thread-123',
        content: 'Hello',
        role: 'user',
      }

      await expect(
        messagesService.createMessage(message as never)
      ).rejects.toThrow('Conversational storage is not available')
    })

    it('should fall back to native storage when extension create fails', async () => {
      // @ts-expect-error test-only core bridge
      window.core = { api: mockNativeApi }
      const message = {
        id: 'msg-1',
        thread_id: 'thread-123',
        content: 'Hello',
        role: 'user',
      }
      mockExtension.createMessage.mockRejectedValueOnce(new Error('Extension missing file'))
      mockNativeApi.createMessage.mockResolvedValue(message)

      const result = await messagesService.createMessage(message as never)

      expect(mockExtension.createMessage).toHaveBeenCalledWith(message)
      expect(mockNativeApi.createMessage).toHaveBeenCalledWith({ message })
      expect(result).toEqual(message)
    })

    it('should throw when createMessage fails', async () => {
      const message = {
        id: 'msg-1',
        thread_id: 'thread-123',
        content: 'Hello',
        role: 'user',
      }
      mockExtension.createMessage.mockRejectedValue(
        new Error('Failed to create message')
      )

      await expect(
        messagesService.createMessage(message as never)
      ).rejects.toThrow('Failed to create message')
    })

    it('should return message immediately for TEMPORARY_CHAT_ID without calling extension', async () => {
      const message = {
        id: 'msg-1',
        thread_id: TEMPORARY_CHAT_ID,
        content: 'Hello',
        role: 'user',
      }

      const result = await messagesService.createMessage(message as never)

      expect(result).toEqual(message)
      expect(mockExtensionManager.get).not.toHaveBeenCalled()
    })
  })

  describe('modifyMessage', () => {
    it('should modify message successfully', async () => {
      const message = {
        id: 'msg-1',
        thread_id: 'thread-123',
        content: 'Updated',
        role: 'user',
      }
      mockExtension.modifyMessage.mockResolvedValue(message)

      const result = await messagesService.modifyMessage(message as never)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(
        ExtensionTypeEnum.Conversational
      )
      expect(mockExtension.modifyMessage).toHaveBeenCalledWith(message)
      expect(result).toEqual(message)
    })

    it('should throw when storage is unavailable', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      const message = {
        id: 'msg-1',
        thread_id: 'thread-123',
        content: 'Updated',
        role: 'user',
      }

      await expect(
        messagesService.modifyMessage(message as never)
      ).rejects.toThrow('Conversational storage is not available')
    })

    it('should fall back to native storage when extension modify fails', async () => {
      // @ts-expect-error test-only core bridge
      window.core = { api: mockNativeApi }
      const message = {
        id: 'msg-1',
        thread_id: 'thread-123',
        content: 'Updated',
        role: 'user',
      }
      mockExtension.modifyMessage.mockRejectedValueOnce(new Error('Extension missing file'))
      mockNativeApi.modifyMessage.mockResolvedValue(message)

      const result = await messagesService.modifyMessage(message as never)

      expect(mockExtension.modifyMessage).toHaveBeenCalledWith(message)
      expect(mockNativeApi.modifyMessage).toHaveBeenCalledWith({ message })
      expect(result).toEqual(message)
    })

    it('should throw when modifyMessage fails', async () => {
      const message = {
        id: 'msg-1',
        thread_id: 'thread-123',
        content: 'Updated',
        role: 'user',
      }
      mockExtension.modifyMessage.mockRejectedValue(
        new Error('Failed to modify')
      )

      await expect(
        messagesService.modifyMessage(message as never)
      ).rejects.toThrow('Failed to modify')
    })

    it('should return message immediately for TEMPORARY_CHAT_ID without calling extension', async () => {
      const message = {
        id: 'msg-1',
        thread_id: TEMPORARY_CHAT_ID,
        content: 'Updated',
        role: 'user',
      }

      const result = await messagesService.modifyMessage(message as never)

      expect(result).toEqual(message)
      expect(mockExtensionManager.get).not.toHaveBeenCalled()
    })
  })

  describe('deleteMessage', () => {
    it('should delete message successfully', async () => {
      const threadId = 'thread-123'
      const messageId = 'msg-1'
      mockExtension.deleteMessage.mockResolvedValue(undefined)

      const result = await messagesService.deleteMessage(threadId, messageId)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(
        ExtensionTypeEnum.Conversational
      )
      expect(mockExtension.deleteMessage).toHaveBeenCalledWith(
        threadId,
        messageId
      )
      expect(result).toBeUndefined()
    })

    it('should throw when storage is unavailable', async () => {
      mockExtensionManager.get.mockReturnValue(null)

      await expect(
        messagesService.deleteMessage('thread-123', 'msg-1')
      ).rejects.toThrow('Conversational storage is not available')
    })

    it('should fall back to native storage when extension delete fails', async () => {
      // @ts-expect-error test-only core bridge
      window.core = { api: mockNativeApi }
      mockExtension.deleteMessage.mockRejectedValueOnce(new Error('Extension missing file'))
      mockNativeApi.deleteMessage.mockResolvedValue(undefined)

      await messagesService.deleteMessage('thread-123', 'msg-1')

      expect(mockExtension.deleteMessage).toHaveBeenCalledWith('thread-123', 'msg-1')
      expect(mockNativeApi.deleteMessage).toHaveBeenCalledWith({
        threadId: 'thread-123',
        messageId: 'msg-1',
      })
    })

    it('should handle deleteMessage error', async () => {
      mockExtension.deleteMessage.mockRejectedValue(
        new Error('Failed to delete message')
      )

      await expect(
        messagesService.deleteMessage('thread-123', 'msg-1')
      ).rejects.toThrow('Failed to delete message')
    })

    it('should return immediately for TEMPORARY_CHAT_ID without calling extension', async () => {
      const result = await messagesService.deleteMessage(
        TEMPORARY_CHAT_ID,
        'msg-1'
      )

      expect(result).toBeUndefined()
      expect(mockExtensionManager.get).not.toHaveBeenCalled()
    })
  })
})
