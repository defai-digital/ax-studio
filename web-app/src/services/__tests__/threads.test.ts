import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultThreadsService } from '../threads/default'
import { ExtensionManager } from '@/lib/extension'
import { ConversationalExtension, ExtensionTypeEnum } from '@ax-studio/core'

// Mock ExtensionManager
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(),
  },
}))

describe('DefaultThreadsService', () => {
  let threadsService: DefaultThreadsService

  const mockConversationalExtension = {
    listThreads: vi.fn(),
    createThread: vi.fn(),
    modifyThread: vi.fn(),
    deleteThread: vi.fn(),
  }

  const mockExtensionManager = {
    get: vi.fn().mockReturnValue(mockConversationalExtension),
  }

  const mockNativeApi = {
    listThreads: vi.fn(),
    createThread: vi.fn(),
    modifyThread: vi.fn(),
    deleteThread: vi.fn(),
  }

  beforeEach(() => {
    threadsService = new DefaultThreadsService()
    vi.clearAllMocks()
    // @ts-expect-error test-only core bridge
    window.core = undefined
    ;(ExtensionManager.getInstance as any).mockReturnValue(mockExtensionManager)
  })

  describe('fetchThreads', () => {
    it('should fetch and transform threads successfully', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          updated: 1234567890,
          metadata: { order: 1, is_favorite: true },
          assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 1234567890,
        order: 1,
        isFavorite: true,
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
    })

    it('should migrate old threads properly', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          updated: 1234567880000,
          metadata: { order: 1, is_favorite: true },
          assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        },
        {
          id: '2',
          title: 'Test Thread 2',
          updated: 1234567890,
          metadata: { order: 1, is_favorite: true },
          assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 1234567880,
        order: 1,
        isFavorite: true,
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
      expect(result[1]).toMatchObject({
        id: '2',
        title: 'Test Thread 2',
        updated: 1234567890,
        order: 1,
        isFavorite: true,
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
    })

    it('should handle empty threads array', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue([])

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle error and return empty array', async () => {
      mockConversationalExtension.listThreads.mockRejectedValue(
        new Error('API Error')
      )

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle null/undefined response', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue(null)

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })
  })

  describe('createThread', () => {
    it('should create thread successfully', async () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [realAssistant],
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ ...realAssistant, model: { id: 'gpt-4', engine: 'openai' } }],
        metadata: { order: 1 },
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toMatchObject({
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        model: { id: 'gpt-4', provider: 'openai' },
        order: 1,
        // Real assistants (with instructions) are preserved
        assistants: [expect.objectContaining({ instructions: 'You are a helpful assistant.' })],
      })
    })

    it('should throw creation errors', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }

      mockConversationalExtension.createThread.mockRejectedValue(
        new Error('Creation failed')
      )

      await expect(threadsService.createThread(inputThread as Thread)).rejects.toThrow(
        'Creation failed'
      )
    })
  })

  describe('updateThread', () => {
    it('should update thread successfully', async () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const thread = {
        id: '1',
        title: 'Updated Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [realAssistant],
        isFavorite: true,
        order: 2,
      }

      const result = threadsService.updateThread(thread as Thread)

      expect(mockConversationalExtension.modifyThread).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '1',
          title: 'Updated Thread',
          assistants: expect.arrayContaining([
            expect.objectContaining({
              model: { id: 'gpt-4', engine: 'openai' },
            }),
          ]),
          metadata: { is_favorite: true, order: 2 },
        })
      )
    })
  })

  describe('deleteThread', () => {
    it('should delete thread successfully', () => {
      const threadId = '1'

      threadsService.deleteThread(threadId)

      expect(mockConversationalExtension.deleteThread).toHaveBeenCalledWith(
        threadId
      )
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle fetchThreads when extension manager returns null', async () => {
      ;(ExtensionManager.getInstance as any).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      })

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should fall back to native createThread when extension manager returns null', async () => {
      ;(ExtensionManager.getInstance as any).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      })
      // @ts-expect-error test-only core bridge
      window.core = { api: mockNativeApi }

      const inputThread = {
        id: '1',
        title: 'Test Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }
      mockNativeApi.createThread.mockResolvedValue({
        ...inputThread,
        assistants: [
          {
            model: { id: 'gpt-4', engine: 'openai' },
          },
        ],
        metadata: {},
      })

      const result = await threadsService.createThread(inputThread as Thread)

      expect(mockNativeApi.createThread).toHaveBeenCalled()
      expect(result.model).toEqual({ id: 'gpt-4', provider: 'openai' })
    })

    it('should throw on updateThread when storage is unavailable', async () => {
      ;(ExtensionManager.getInstance as any).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      })

      const thread = {
        id: '1',
        title: 'Test Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }

      await expect(threadsService.updateThread(thread as Thread)).rejects.toThrow(
        'Conversational storage is not available'
      )
    })

    it('should throw on deleteThread when storage is unavailable', async () => {
      ;(ExtensionManager.getInstance as any).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      })

      await expect(threadsService.deleteThread('test-id')).rejects.toThrow(
        'Conversational storage is not available'
      )
    })

    it('should fall back to native storage when extension update fails', async () => {
      // @ts-expect-error test-only core bridge
      window.core = { api: mockNativeApi }
      const thread = {
        id: '1',
        title: 'Test Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }
      mockConversationalExtension.modifyThread.mockRejectedValueOnce(new Error('Extension missing file'))
      mockNativeApi.modifyThread.mockResolvedValue(thread)

      await threadsService.updateThread(thread as Thread)

      expect(mockConversationalExtension.modifyThread).toHaveBeenCalled()
      expect(mockNativeApi.modifyThread).toHaveBeenCalled()
    })

    it('should fall back to native storage when extension delete fails', async () => {
      // @ts-expect-error test-only core bridge
      window.core = { api: mockNativeApi }
      mockConversationalExtension.deleteThread.mockRejectedValueOnce(new Error('Extension missing file'))
      mockNativeApi.deleteThread.mockResolvedValue(undefined)

      await threadsService.deleteThread('test-id')

      expect(mockConversationalExtension.deleteThread).toHaveBeenCalledWith('test-id')
      expect(mockNativeApi.deleteThread).toHaveBeenCalledWith({ threadId: 'test-id' })
    })

    it('should handle fetchThreads with threads missing metadata', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          // missing metadata and assistants
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 0,
        order: undefined,
        isFavorite: undefined,
      })
    })

    it('should handle fetchThreads with threads missing assistants', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          updated: 1234567890,
          metadata: { order: 1, is_favorite: true },
          // missing assistants
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 1234567890,
        order: 1,
        isFavorite: true,
      })
    })

    it('should handle createThread with missing model info', async () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const inputThread = {
        id: '1',
        title: 'New Thread',
        // missing model
        assistants: [realAssistant],
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ ...realAssistant, model: { id: '*', engine: 'ax-studio' } }],
        metadata: { order: 1 },
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(mockConversationalExtension.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            expect.objectContaining({
              model: { id: '*', engine: 'ax-studio' },
            }),
          ],
        })
      )
    })

    it('should handle createThread with missing assistants', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        // missing assistants
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ id: 'model-only', name: 'Model', model: { id: 'gpt-4', engine: 'openai' } }],
        metadata: { order: 1 },
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      // Should create with model-only entry when no assistants provided
      expect(mockConversationalExtension.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            expect.objectContaining({
              id: 'model-only',
              name: 'Model',
              model: { id: 'gpt-4', engine: 'openai' },
            }),
          ],
        })
      )
    })

    it('should handle updateThread with missing assistants', () => {
      const thread = {
        id: '1',
        title: 'Updated Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        // missing assistants
        isFavorite: true,
        order: 2,
      }

      threadsService.updateThread(thread as Thread)

      expect(mockConversationalExtension.modifyThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            {
              model: { id: 'gpt-4', engine: 'openai' },
              id: 'ax-studio',
              name: 'Ax-Studio',
              instructions: '',
              tools: [],
            },
          ],
        })
      )
    })

    it('should handle updateThread with missing model info', () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const thread = {
        id: '1',
        title: 'Updated Thread',
        // missing model
        assistants: [realAssistant],
        isFavorite: true,
        order: 2,
      }

      threadsService.updateThread(thread as Thread)

      expect(mockConversationalExtension.modifyThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            expect.objectContaining({
              model: { id: '*', engine: 'ax-studio' },
            }),
          ],
        })
      )
    })

    it('should handle fetchThreads with non-array response', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue('not-an-array')

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle createThread with missing metadata in response', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        // missing metadata
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toMatchObject({
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        model: { id: 'gpt-4', provider: 'openai' },
        order: 1, // Should fall back to original thread order
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
    })
  })
})
