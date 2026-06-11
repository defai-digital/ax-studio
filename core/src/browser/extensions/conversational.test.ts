import { describe, it, test, expect, beforeEach } from 'vitest'
import { ConversationalExtension } from './conversational'
import { ExtensionTypeEnum } from '../extension'
import {
  ContentType,
  MessageStatus,
  Thread,
  ThreadAssistantInfo,
  ThreadMessage,
} from '../../types'

const createThreadAssistant = (overrides: Partial<ThreadAssistantInfo> = {}): ThreadAssistantInfo => ({
  id: 'test-assistant',
  name: 'Test Assistant',
  model: { id: 'test-model', name: 'Test Model', engine: 'test' },
  tools: [],
  ...overrides,
})

// Mock implementation of ConversationalExtension
class MockConversationalExtension extends ConversationalExtension {
  private threads: Thread[] = []
  private messages: { [threadId: string]: ThreadMessage[] } = {}
  private assistants: { [threadId: string]: ThreadAssistantInfo } = {}

  constructor() {
    super('http://mock-url.com', 'mock-extension', 'Mock Extension', true, 'A mock extension', '1.0.0')
  }

  onLoad(): void {
    // Mock implementation
  }

  onUnload(): void {
    // Mock implementation
  }

  async listThreads(): Promise<Thread[]> {
    return this.threads
  }

  async createThread(thread: Partial<Thread>): Promise<Thread> {
    const timestamp = Math.floor(Date.now() / 1000)
    const newThread: Thread = {
      id: thread.id || `thread-${Date.now()}`,
      object: thread.object || 'thread',
      title: thread.title || 'New Thread',
      assistants: thread.assistants || [],
      created: thread.created || timestamp,
      updated: thread.updated || timestamp,
      metadata: thread.metadata,
    }
    this.threads.push(newThread)
    this.messages[newThread.id] = []
    return newThread
  }

  async modifyThread(thread: Thread): Promise<void> {
    const index = this.threads.findIndex(t => t.id === thread.id)
    if (index !== -1) {
      this.threads[index] = thread
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads = this.threads.filter(t => t.id !== threadId)
    delete this.messages[threadId]
    delete this.assistants[threadId]
  }

  async createMessage(message: Partial<ThreadMessage>): Promise<ThreadMessage> {
    if (!message.thread_id) throw new Error('Thread ID is required')

    const timestamp = Math.floor(Date.now() / 1000)
    const newMessage: ThreadMessage = {
      id: message.id || `message-${Date.now()}`,
      object: message.object || 'thread.message',
      thread_id: message.thread_id,
      content:
        message.content || [
          {
            type: ContentType.Text,
            text: {
              value: 'Test message',
              annotations: [],
            },
          },
        ],
      role: message.role || 'user',
      status: message.status || MessageStatus.Ready,
      created_at: message.created_at || timestamp,
      completed_at: message.completed_at || timestamp,
      metadata: message.metadata,
    }

    if (!this.messages[message.thread_id]) {
      this.messages[message.thread_id] = []
    }

    this.messages[message.thread_id].push(newMessage)
    return newMessage
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    if (this.messages[threadId]) {
      this.messages[threadId] = this.messages[threadId].filter(m => m.id !== messageId)
    }
  }

  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    return this.messages[threadId] || []
  }

  async getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo> {
    return this.assistants[threadId] || createThreadAssistant({
      id: '',
      name: '',
      model: { id: '', name: '', engine: '' },
    })
  }

  async createThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    this.assistants[threadId] = assistant
    return assistant
  }

  async modifyThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    this.assistants[threadId] = assistant
    return assistant
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    if (!this.messages[message.thread_id]) return message

    const index = this.messages[message.thread_id].findIndex(m => m.id === message.id)
    if (index !== -1) {
      this.messages[message.thread_id][index] = message
    }

    return message
  }
}

describe('ConversationalExtension', () => {
  let extension: MockConversationalExtension

  beforeEach(() => {
    extension = new MockConversationalExtension()
  })

  test('should return the correct extension type', () => {
    expect(extension.type()).toBe(ExtensionTypeEnum.Conversational)
  })

  test('should create and list threads', async () => {
    const thread = await extension.createThread({ title: 'Test Thread' })
    expect(thread.title).toBe('Test Thread')

    const threads = await extension.listThreads()
    expect(threads).toHaveLength(1)
    expect(threads[0].id).toBe(thread.id)
  })

  test('should modify thread', async () => {
    const thread = await extension.createThread({ title: 'Test Thread' })
    const modifiedThread = { ...thread, title: 'Modified Thread' }

    await extension.modifyThread(modifiedThread)

    const threads = await extension.listThreads()
    expect(threads[0].title).toBe('Modified Thread')
  })

  test('should delete thread', async () => {
    const thread = await extension.createThread({ title: 'Test Thread' })

    await extension.deleteThread(thread.id)

    const threads = await extension.listThreads()
    expect(threads).toHaveLength(0)
  })

  test('should create and list messages', async () => {
    const thread = await extension.createThread({ title: 'Test Thread' })

    const message = await extension.createMessage({
      thread_id: thread.id,
      content: [{
        type: ContentType.Text,
        text: { value: 'Test message', annotations: [] },
      }],
      role: 'user',
    })

    expect(message.content[0]?.text?.value).toBe('Test message')

    const messages = await extension.listMessages(thread.id)
    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe(message.id)
  })

  test('should modify message', async () => {
    const thread = await extension.createThread({ title: 'Test Thread' })

    const message = await extension.createMessage({
      thread_id: thread.id,
      content: [{
        type: ContentType.Text,
        text: { value: 'Test message', annotations: [] },
      }],
      role: 'user',
    })

    const modifiedMessage = {
      ...message,
      content: [{
        type: ContentType.Text,
        text: { value: 'Modified message', annotations: [] },
      }],
    }

    await extension.modifyMessage(modifiedMessage)

    const messages = await extension.listMessages(thread.id)
    expect(messages[0].content[0]?.text?.value).toBe('Modified message')
  })

  test('should delete message', async () => {
    const thread = await extension.createThread({ title: 'Test Thread' })

    const message = await extension.createMessage({
      thread_id: thread.id,
      content: [{
        type: ContentType.Text,
        text: { value: 'Test message', annotations: [] },
      }],
      role: 'user',
    })

    await extension.deleteMessage(thread.id, message.id)

    const messages = await extension.listMessages(thread.id)
    expect(messages).toHaveLength(0)
  })

  test('should create and get thread assistant', async () => {
    const thread = await extension.createThread({ title: 'Test Thread' })
    const assistant = createThreadAssistant()

    await extension.createThreadAssistant(thread.id, assistant)

    const retrievedAssistant = await extension.getThreadAssistant(thread.id)
    expect(retrievedAssistant.model.id).toBe('test-model')
  })

  test('should modify thread assistant', async () => {
    const thread = await extension.createThread({ title: 'Test Thread' })
    const assistant = createThreadAssistant()

    await extension.createThreadAssistant(thread.id, assistant)

    const modifiedAssistant = createThreadAssistant({
      model: { id: 'modified-model', name: 'Modified Model', engine: 'test' },
    })

    await extension.modifyThreadAssistant(thread.id, modifiedAssistant)

    const retrievedAssistant = await extension.getThreadAssistant(thread.id)
    expect(retrievedAssistant.model.id).toBe('modified-model')
  })

  test('should delete thread assistant when thread is deleted', async () => {
    const thread = await extension.createThread({ title: 'Test Thread' })
    const assistant = createThreadAssistant()

    await extension.createThreadAssistant(thread.id, assistant)
    await extension.deleteThread(thread.id)

    // Creating a new thread with the same ID to test if assistant was deleted
    const newThread = await extension.createThread({ id: thread.id, title: 'New Thread' })
    const retrievedAssistant = await extension.getThreadAssistant(newThread.id)

    expect(retrievedAssistant.id).toBe('')
  })
})
