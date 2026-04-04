import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessages } from '@/hooks/useMessages'
import { useThreads } from '@/hooks/useThreads'
import { useThreadChat, type ThreadChatParams } from './use-thread-chat'

// Mock AI SDK
vi.mock('ai', () => ({
  generateId: vi.fn(() => 'generated-id-1'),
}))

// Mock UIMessage type
vi.mock('@ai-sdk/react', () => ({}))

// Mock completion helper
vi.mock('@/lib/completion', () => ({
  newUserThreadContent: vi.fn(
    (threadId: string, content: string, _attachments: unknown, id: string) => ({
      id,
      thread_id: threadId,
      role: 'user',
      type: 'text',
      object: 'thread.message',
      status: 'ready',
      content: [{ type: 'text', text: { value: content, annotations: [] } }],
      created_at: Date.now(),
      metadata: {},
    })
  ),
}))

// Mock messages conversion
vi.mock('@/lib/messages', () => ({
  convertThreadMessagesToUIMessages: vi.fn((msgs: unknown[]) =>
    msgs.map((m: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: m.id,
      role: m.role,
      parts: [{ type: 'text', text: m.content?.[0]?.text?.value ?? '' }],
    }))
  ),
}))

// Mock chat session store
vi.mock('@/stores/chat-session-store', () => ({
  useChatSessions: Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({
        sessions: {},
      })),
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  ),
}))

// Mock @ax-studio/core enums
vi.mock('@ax-studio/core', () => ({
  ContentType: { Text: 'text', Image: 'image' },
  ChatCompletionRole: { User: 'user', Assistant: 'assistant', System: 'system' },
  MessageStatus: { Ready: 'ready', InProgress: 'in_progress' },
}))

// Mock useModelProvider
vi.mock('@/hooks/useModelProvider', () => {
  const store = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        selectedProvider: 'openai',
        selectedModel: { id: 'gpt-4o' },
        getProviderByName: vi.fn(),
      }),
    {
      getState: vi.fn(() => ({
        selectedProvider: 'openai',
        selectedModel: { id: 'gpt-4o' },
        getProviderByName: vi.fn(),
        updateProvider: vi.fn(),
      })),
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  )
  return { useModelProvider: store }
})

describe('useThreadChat', () => {
  const threadId = 'thread-1'
  let mockSendMessage: ReturnType<typeof vi.fn>
  let mockRegenerate: ReturnType<typeof vi.fn>
  let mockSetChatMessages: ReturnType<typeof vi.fn>
  let mockHandleRememberCommand: ReturnType<typeof vi.fn>
  let mockHandleForgetCommand: ReturnType<typeof vi.fn>
  let lastUserInputRef: { current: string }

  const defaultParams = (): ThreadChatParams => ({
    threadId,
    sendMessage: mockSendMessage,
    regenerate: mockRegenerate,
    chatMessages: [],
    setChatMessages: mockSetChatMessages,
    handleRememberCommand: mockHandleRememberCommand,
    handleForgetCommand: mockHandleForgetCommand,
    lastUserInputRef,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMessage = vi.fn()
    mockRegenerate = vi.fn()
    mockSetChatMessages = vi.fn()
    mockHandleRememberCommand = vi.fn().mockReturnValue(false)
    mockHandleForgetCommand = vi.fn().mockReturnValue(false)
    lastUserInputRef = { current: '' }

    // Reset stores
    useMessages.setState({ messages: {} })
    useThreads.setState({
      threads: {
        [threadId]: {
          id: threadId,
          title: 'New Thread',
          updated: Date.now() / 1000,
          assistants: [],
        } as unknown as Thread,
      },
    })
  })

  describe('processAndSendMessage', () => {
    it('trims whitespace from input', async () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      await act(async () => {
        await result.current.processAndSendMessage('  hello world  ')
      })

      expect(lastUserInputRef.current).toBe('hello world')
    })

    it('delegates /remember to handleRememberCommand', async () => {
      mockHandleRememberCommand.mockReturnValue(true)
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      await act(async () => {
        await result.current.processAndSendMessage('/remember test')
      })

      expect(mockHandleRememberCommand).toHaveBeenCalledWith('/remember test')
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('delegates /forget to handleForgetCommand', async () => {
      mockHandleForgetCommand.mockReturnValue(true)
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      await act(async () => {
        await result.current.processAndSendMessage('/forget test')
      })

      expect(mockHandleForgetCommand).toHaveBeenCalledWith('/forget test')
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('renames thread on first message when title is default', async () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      await act(async () => {
        await result.current.processAndSendMessage('Hello AI')
      })

      // renameThread should have been called
      const thread = useThreads.getState().threads[threadId]
      expect(thread.title).toBe('Hello AI')
    })

    it('does not rename thread when messages already exist', async () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            {
              id: 'existing',
              thread_id: threadId,
              role: 'user',
              content: [{ type: 'text', text: { value: 'old msg' } }],
            } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          ],
        },
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      await act(async () => {
        await result.current.processAndSendMessage('Second message')
      })

      // Title should remain unchanged
      expect(useThreads.getState().threads[threadId].title).toBe('New Thread')
    })

    it('adds user message to message store', async () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      await act(async () => {
        await result.current.processAndSendMessage('Hello')
      })

      const messages = useMessages.getState().getMessages(threadId)
      expect(messages.length).toBe(1)
      expect(messages[0].role).toBe('user')
    })

    it('calls sendMessage with correct parts', async () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      await act(async () => {
        await result.current.processAndSendMessage('Hello')
      })

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'generated-id-1',
          parts: expect.arrayContaining([
            expect.objectContaining({ type: 'text' }),
          ]),
        })
      )
    })
  })

  describe('persistMessageOnFinish', () => {
    it('does nothing when contentParts is empty', () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.persistMessageOnFinish(
          { id: 'msg-1', role: 'assistant', parts: [] } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          []
        )
      })

      const messages = useMessages.getState().getMessages(threadId)
      expect(messages.length).toBe(0)
    })

    it('adds new assistant message when not existing', () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.persistMessageOnFinish(
          { id: 'msg-1', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          [{ type: 'text', text: { value: 'Hi', annotations: [] } }] as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
      })

      const messages = useMessages.getState().getMessages(threadId)
      expect(messages.length).toBe(1)
      expect(messages[0].id).toBe('msg-1')
      expect(messages[0].role).toBe('assistant')
    })

    it('updates existing message instead of adding duplicate', () => {
      // Pre-populate with existing message
      useMessages.setState({
        messages: {
          [threadId]: [
            {
              id: 'msg-1',
              thread_id: threadId,
              role: 'assistant',
              content: [{ type: 'text', text: { value: 'old' } }],
            } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          ],
        },
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.persistMessageOnFinish(
          { id: 'msg-1', role: 'assistant', parts: [{ type: 'text', text: 'new' }] } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          [{ type: 'text', text: { value: 'new', annotations: [] } }] as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
      })

      // Should still have 1 message (updated, not duplicated)
      const messages = useMessages.getState().getMessages(threadId)
      expect(messages.length).toBe(1)
    })
  })

  describe('handleRegenerate', () => {
    it('calls regenerate without arguments when no messageId', () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleRegenerate()
      })

      expect(mockRegenerate).toHaveBeenCalledWith(undefined)
    })

    it('calls regenerate with messageId', () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleRegenerate('msg-1')
      })

      expect(mockRegenerate).toHaveBeenCalledWith({ messageId: 'msg-1' })
    })

    it('deletes messages after the selected user message when regenerating assistant message', () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            { id: 'user-1', thread_id: threadId, role: 'user', content: [] },
            { id: 'assistant-1', thread_id: threadId, role: 'assistant', content: [] },
            { id: 'user-2', thread_id: threadId, role: 'user', content: [] },
            { id: 'assistant-2', thread_id: threadId, role: 'assistant', content: [] },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleRegenerate('assistant-1')
      })

      // Should delete assistant-1 after user-1 (keep user-1, delete everything after)
      // The delete function is called for user-2 and assistant-2
      const messages = useMessages.getState().getMessages(threadId)
      // user-1 is kept, assistant-1 + user-2 + assistant-2 are deleted
      expect(messages.length).toBe(1)
      expect(messages[0].id).toBe('user-1')
    })
  })

  describe('handleDeleteMessage', () => {
    it('deletes message from store', () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            { id: 'msg-1', thread_id: threadId, role: 'user', content: [] },
            { id: 'msg-2', thread_id: threadId, role: 'assistant', content: [] },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleDeleteMessage('msg-1')
      })

      const messages = useMessages.getState().getMessages(threadId)
      expect(messages.length).toBe(1)
      expect(messages[0].id).toBe('msg-2')
    })

    it('calls setChatMessages to remove message from UI', () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleDeleteMessage('msg-1')
      })

      expect(mockSetChatMessages).toHaveBeenCalled()
    })
  })

  describe('handleEditMessage', () => {
    it('updates the message content', () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            {
              id: 'msg-1',
              thread_id: threadId,
              role: 'user',
              content: [{ type: 'text', text: { value: 'old text', annotations: [] } }],
            },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const params = defaultParams()
      params.chatMessages = [
        { id: 'msg-1', role: 'user', parts: [{ type: 'text' as const, text: 'old text' }] },
      ] as any[] // eslint-disable-line @typescript-eslint/no-explicit-any

      const { result } = renderHook(() => useThreadChat(params))

      act(() => {
        result.current.handleEditMessage('msg-1', 'new text')
      })

      const messages = useMessages.getState().getMessages(threadId)
      expect(messages[0].content[0].text.value).toBe('new text')
    })

    it('does nothing when message is not found', () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleEditMessage('nonexistent', 'new text')
      })

      // Should not throw, no messages modified
      expect(mockSetChatMessages).not.toHaveBeenCalled()
    })

    it('does not regenerate when editing an assistant message', () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            {
              id: 'msg-1',
              thread_id: threadId,
              role: 'assistant',
              content: [{ type: 'text', text: { value: 'old', annotations: [] } }],
            },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const params = defaultParams()
      params.chatMessages = [
        { id: 'msg-1', role: 'assistant', parts: [{ type: 'text' as const, text: 'old' }] },
      ] as any[] // eslint-disable-line @typescript-eslint/no-explicit-any

      const { result } = renderHook(() => useThreadChat(params))

      act(() => {
        result.current.handleEditMessage('msg-1', 'corrected')
      })

      expect(mockRegenerate).not.toHaveBeenCalled()
    })

    it('regenerates when editing a user message', () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            {
              id: 'msg-1',
              thread_id: threadId,
              role: 'user',
              content: [{ type: 'text', text: { value: 'old', annotations: [] } }],
            },
            {
              id: 'msg-2',
              thread_id: threadId,
              role: 'assistant',
              content: [{ type: 'text', text: { value: 'response', annotations: [] } }],
            },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const params = defaultParams()
      params.chatMessages = [
        { id: 'msg-1', role: 'user', parts: [{ type: 'text' as const, text: 'old' }] },
        { id: 'msg-2', role: 'assistant', parts: [{ type: 'text' as const, text: 'response' }] },
      ] as any[] // eslint-disable-line @typescript-eslint/no-explicit-any

      const { result } = renderHook(() => useThreadChat(params))

      act(() => {
        result.current.handleEditMessage('msg-1', 'updated question')
      })

      expect(mockRegenerate).toHaveBeenCalledWith({ messageId: 'msg-1' })
    })
  })

  describe('handleContextSizeIncrease', () => {
    it('is a function', () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))
      expect(typeof result.current.handleContextSizeIncrease).toBe('function')
    })
  })
})
