import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listThreads: vi.fn(),
    createThread: vi.fn(),
    modifyThread: vi.fn(),
    deleteThread: vi.fn(),
    createMessage: vi.fn(),
    modifyMessage: vi.fn(),
    deleteMessage: vi.fn(),
    listMessages: vi.fn(),
    getThreadAssistant: vi.fn(),
    createThreadAssistant: vi.fn(),
    modifyThreadAssistant: vi.fn(),
  },
}))

vi.stubGlobal('core', { api: mockApi })

vi.mock('@ax-studio/core', () => {
  class ConversationalExtension {
    name = ''
    url = ''
    active = false
    description = ''
    version = ''
    constructor() {}
    type() {
      return 'conversational'
    }
    async registerSettings() {}
    async getSetting<T>(_key: string, defaultValue: T) {
      return defaultValue
    }
    onSettingUpdate() {}
    async getSettings() {
      return []
    }
    async updateSettings() {}
  }

  return { ConversationalExtension }
})

import AxStudioConversationalExtension from './index'

describe('AxStudioConversationalExtension', () => {
  let ext: AxStudioConversationalExtension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = new AxStudioConversationalExtension('', '')
  })

  describe('onLoad', () => {
    it('resolves without doing anything', async () => {
      await expect(ext.onLoad()).resolves.toBeUndefined()
    })
  })

  describe('onUnload', () => {
    it('returns undefined', () => {
      expect(ext.onUnload()).toBeUndefined()
    })
  })

  describe('listThreads', () => {
    it('delegates to window.core.api.listThreads', async () => {
      const threads = [
        { id: 't1', title: 'Thread 1' },
        { id: 't2', title: 'Thread 2' },
      ]
      mockApi.listThreads.mockResolvedValue(threads)

      const result = await ext.listThreads()

      expect(mockApi.listThreads).toHaveBeenCalledTimes(1)
      expect(result).toEqual(threads)
    })

    it('returns empty array when no threads exist', async () => {
      mockApi.listThreads.mockResolvedValue([])

      const result = await ext.listThreads()

      expect(result).toEqual([])
    })
  })

  describe('createThread', () => {
    it('passes thread object wrapped in payload', async () => {
      const thread = { id: 'new-t', title: 'New Thread' } as any
      const created = { ...thread, created_at: 12345 }
      mockApi.createThread.mockResolvedValue(created)

      const result = await ext.createThread(thread)

      expect(mockApi.createThread).toHaveBeenCalledWith({ thread })
      expect(result).toEqual(created)
    })
  })

  describe('modifyThread', () => {
    it('passes thread object wrapped in payload', async () => {
      const thread = { id: 't1', title: 'Updated' } as any
      mockApi.modifyThread.mockResolvedValue(undefined)

      await ext.modifyThread(thread)

      expect(mockApi.modifyThread).toHaveBeenCalledWith({ thread })
    })
  })

  describe('deleteThread', () => {
    it('passes threadId wrapped in payload', async () => {
      mockApi.deleteThread.mockResolvedValue(undefined)

      await ext.deleteThread('t1')

      expect(mockApi.deleteThread).toHaveBeenCalledWith({ threadId: 't1' })
    })
  })

  describe('createMessage', () => {
    it('passes message wrapped in payload and returns created message', async () => {
      const message = { id: 'm1', content: 'Hello' } as any
      const created = { ...message, created_at: 99999 }
      mockApi.createMessage.mockResolvedValue(created)

      const result = await ext.createMessage(message)

      expect(mockApi.createMessage).toHaveBeenCalledWith({ message })
      expect(result.id).toBe('m1')
      expect(result.created_at).toBe(99999)
    })
  })

  describe('modifyMessage', () => {
    it('passes message wrapped in payload and returns modified message', async () => {
      const message = { id: 'm1', content: 'Updated' } as any
      mockApi.modifyMessage.mockResolvedValue(message)

      const result = await ext.modifyMessage(message)

      expect(mockApi.modifyMessage).toHaveBeenCalledWith({ message })
      expect(result.content).toBe('Updated')
    })
  })

  describe('deleteMessage', () => {
    it('passes threadId and messageId wrapped in payload', async () => {
      mockApi.deleteMessage.mockResolvedValue(undefined)

      await ext.deleteMessage('t1', 'm1')

      expect(mockApi.deleteMessage).toHaveBeenCalledWith({
        threadId: 't1',
        messageId: 'm1',
      })
    })
  })

  describe('listMessages', () => {
    it('passes threadId wrapped in payload and returns messages', async () => {
      const messages = [
        { id: 'm1', content: 'Hi' },
        { id: 'm2', content: 'Hello' },
      ]
      mockApi.listMessages.mockResolvedValue(messages)

      const result = await ext.listMessages('t1')

      expect(mockApi.listMessages).toHaveBeenCalledWith({ threadId: 't1' })
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('m1')
    })
  })

  describe('getThreadAssistant', () => {
    it('passes threadId wrapped in payload and returns assistant info', async () => {
      const assistantInfo = { assistant_id: 'a1', model: 'gpt-4' }
      mockApi.getThreadAssistant.mockResolvedValue(assistantInfo)

      const result = await ext.getThreadAssistant('t1')

      expect(mockApi.getThreadAssistant).toHaveBeenCalledWith({
        threadId: 't1',
      })
      expect(result).toEqual(assistantInfo)
    })
  })

  describe('createThreadAssistant', () => {
    it('passes threadId and assistant as separate arguments', async () => {
      const assistant = { assistant_id: 'a1', model: 'gpt-4' } as any
      mockApi.createThreadAssistant.mockResolvedValue(assistant)

      const result = await ext.createThreadAssistant('t1', assistant)

      expect(mockApi.createThreadAssistant).toHaveBeenCalledWith(
        't1',
        assistant
      )
      expect(result).toEqual(assistant)
    })
  })

  describe('modifyThreadAssistant', () => {
    it('passes threadId and assistant wrapped in payload', async () => {
      const assistant = { assistant_id: 'a1', model: 'gpt-4o' } as any
      mockApi.modifyThreadAssistant.mockResolvedValue(assistant)

      const result = await ext.modifyThreadAssistant('t1', assistant)

      expect(mockApi.modifyThreadAssistant).toHaveBeenCalledWith({
        threadId: 't1',
        assistant,
      })
      expect(result).toEqual(assistant)
    })
  })
})
