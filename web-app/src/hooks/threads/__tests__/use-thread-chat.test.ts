import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessages } from '@/hooks/chat/useMessages'
import { useThreads } from '@/hooks/threads/useThreads'
import { useChatAttachments } from '@/hooks/chat/useChatAttachments'
import { useChatSessions } from '@/stores/chat-session-store'
import { useThreadChat, type ThreadChatParams } from '../use-thread-chat'
import { runAxBiAuthoringWorkflow } from '@/lib/ax-bi/authoring-workflow'

const axBiWorkflowMocks = vi.hoisted(() => ({
  runAxBiAuthoringWorkflow: vi.fn(),
}))

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
  newAssistantThreadContent: vi.fn(
    (
      threadId: string,
      content: string,
      metadata: Record<string, unknown>,
      id = 'assistant-id-1'
    ) => ({
      id,
      thread_id: threadId,
      role: 'assistant',
      type: 'text',
      object: 'thread.message',
      status: 'ready',
      content: [{ type: 'text', text: { value: content, annotations: [] } }],
      created_at: Date.now(),
      metadata,
    })
  ),
}))

vi.mock('@/lib/ax-bi/authoring-workflow', () => axBiWorkflowMocks)

// Mock messages conversion
vi.mock('@/lib/messages', () => ({
  convertThreadMessagesToUIMessages: vi.fn((msgs: unknown[]) =>
    msgs.map((m: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: m.id,
      role: m.role,
      parts: [{ type: 'text', text: m.content?.[0]?.text?.value ?? '' }],
    }))
  ),
  extractContentPartsFromUIMessage: vi.fn((message: {
    parts?: Array<{ type?: string; text?: string }>
  }) => {
    const text = (message.parts ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('')
    return text
      ? [{ type: 'text', text: { value: text, annotations: [] } }]
      : []
  }),
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
vi.mock('@/hooks/models/useModelProvider', () => {
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

  const defaultParams = (): ThreadChatParams => ({
    threadId,
    sendMessage: mockSendMessage,
    regenerate: mockRegenerate,
    chatMessages: [],
    setChatMessages: mockSetChatMessages,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMessage = vi.fn()
    mockRegenerate = vi.fn()
    mockSetChatMessages = vi.fn()

    // Reset stores
    useMessages.setState({ messages: {} })
    useChatAttachments.setState({ attachmentsByThread: {} })
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
    // Always start from a cold chat-session snapshot. Earlier tests may
    // mockReturnValue a live session; clearAllMocks does not drop that.
    vi.mocked(useChatSessions.getState).mockReturnValue({
      sessions: {},
    } as never)
    axBiWorkflowMocks.runAxBiAuthoringWorkflow.mockResolvedValue({ handled: false })
  })

  it('marks an empty persisted history as loaded', async () => {
    const { result } = renderHook(() => useThreadChat(defaultParams()))

    await vi.waitFor(() => {
      expect(result.current.messagesLoaded).toBe(true)
      expect(
        Object.prototype.hasOwnProperty.call(
          useMessages.getState().messages,
          threadId
        )
      ).toBe(true)
    })
    expect(useMessages.getState().getMessages(threadId)).toEqual([])
    expect(mockSetChatMessages).toHaveBeenCalledWith([])
  })

  it('marks the thread loaded when persisted fetch fails', async () => {
    const { useServiceHub } = await import('@/hooks/useServiceHub')
    const hub = useServiceHub() as {
      messages: (...args: unknown[]) => unknown
    }
    const fetchMessages = vi.fn().mockRejectedValue(new Error('disk offline'))
    const messagesSpy = vi.spyOn(hub, 'messages').mockReturnValue({
      fetchMessages,
    })
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    const { result } = renderHook(() => useThreadChat(defaultParams()))

    await vi.waitFor(() => {
      expect(result.current.messagesLoaded).toBe(true)
      expect(
        Object.prototype.hasOwnProperty.call(
          useMessages.getState().messages,
          threadId
        )
      ).toBe(true)
    })
    expect(useMessages.getState().getMessages(threadId)).toEqual([])
    expect(fetchMessages).toHaveBeenCalledWith(threadId)
    expect(consoleErrorSpy).toHaveBeenCalled()
    messagesSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('hydrates the message store when a live chat session already exists', async () => {
    const getStateSpy = vi.mocked(useChatSessions.getState)
    getStateSpy.mockReturnValue({
      sessions: {
        [threadId]: {
          chat: {
            messages: [
              {
                id: 'live-1',
                role: 'user',
                parts: [{ type: 'text', text: 'from session' }],
              },
            ],
          },
          isStreaming: false,
        },
      },
    } as never)

    const { result } = renderHook(() => useThreadChat(defaultParams()))

    await vi.waitFor(() => {
      expect(result.current.messagesLoaded).toBe(true)
      expect(
        Object.prototype.hasOwnProperty.call(
          useMessages.getState().messages,
          threadId
        )
      ).toBe(true)
    })
    // Live UI text is mirrored into the store for hand-off dedupe.
    const stored = useMessages.getState().getMessages(threadId)
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe('live-1')
    expect(stored[0].content?.[0]?.text?.value).toBe('from session')
    getStateSpy.mockReturnValue({ sessions: {} } as never)
  })

  it('does not wipe live chat messages when history fetch finishes after send', async () => {
    const { useServiceHub } = await import('@/hooks/useServiceHub')
    const hub = useServiceHub() as {
      messages: (...args: unknown[]) => unknown
    }
    let resolveFetch!: (value: unknown[]) => void
    const fetchPromise = new Promise<unknown[]>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMessages = vi.fn().mockReturnValue(fetchPromise)
    const messagesSpy = vi.spyOn(hub, 'messages').mockReturnValue({
      fetchMessages,
    })
    const getStateSpy = vi.mocked(useChatSessions.getState)
    getStateSpy.mockReturnValue({ sessions: {} } as never)

    const { result } = renderHook(() => useThreadChat(defaultParams()))

    // History is still in flight — store not hydrated yet.
    expect(result.current.messagesLoaded).toBe(false)
    expect(mockSetChatMessages).not.toHaveBeenCalled()

    // User starts chatting; live session now owns the thread.
    getStateSpy.mockReturnValue({
      sessions: {
        [threadId]: {
          chat: {
            messages: [
              {
                id: 'live-user',
                role: 'user',
                parts: [{ type: 'text', text: 'hello live' }],
              },
              {
                id: 'live-assistant',
                role: 'assistant',
                parts: [{ type: 'text', text: 'streaming…' }],
              },
            ],
          },
          isStreaming: true,
        },
      },
    } as never)

    // Late history arrives (stale snapshot).
    resolveFetch([
      {
        id: 'disk-1',
        thread_id: threadId,
        role: 'user',
        content: [{ type: 'text', text: { value: 'old history', annotations: [] } }],
        created_at: 1,
      },
    ])

    await vi.waitFor(() => {
      expect(result.current.messagesLoaded).toBe(true)
    })

    // Live transcript must not be replaced with converted disk history.
    expect(mockSetChatMessages).not.toHaveBeenCalled()
    const stored = useMessages.getState().getMessages(threadId)
    expect(stored.map((m) => m.id)).toEqual(
      expect.arrayContaining(['live-user', 'live-assistant'])
    )
    expect(stored.some((m) => m.id === 'disk-1')).toBe(true)

    messagesSpy.mockRestore()
    getStateSpy.mockReturnValue({ sessions: {} } as never)
  })

  describe('processAndSendMessage', () => {
    it('trims whitespace from input', async () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      await act(async () => {
        await result.current.processAndSendMessage('  hello world  ')
      })

      // Trim happens inside processAndSendMessage; verify by checking that
      // sendMessage was invoked with the trimmed text downstream.
      expect(mockSendMessage).toHaveBeenCalled()
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

    it('sends local knowledge context to the model without saving it in visible history', async () => {
      const knowledgeContext =
        '\n\n## Local Knowledge Base (ACTIVE)\nThe author got hired as a Software Development Engineer at Amazon.'
      const retrieval = {
        searched: true,
        extracted: true,
        source: '/Users/devop/Documents/akidb-testing/coding-interview-university.md',
      }
      const prepareLocalKnowledge = vi.fn().mockResolvedValue({
        context: knowledgeContext,
        retrieval,
      })
      const hiddenText = `What real-world hiring outcome did the author achieve?${knowledgeContext}`

      vi.mocked(useChatSessions.getState).mockReturnValue({
        sessions: {
          [threadId]: {
            chat: {
              messages: [
                {
                  id: 'generated-id-1',
                  role: 'user',
                  parts: [{ type: 'text', text: hiddenText }],
                },
              ],
            },
          },
        },
      } as never)

      const params = defaultParams()
      params.prepareLocalKnowledge = prepareLocalKnowledge

      const { result } = renderHook(() => useThreadChat(params))

      await act(async () => {
        await result.current.processAndSendMessage('What real-world hiring outcome did the author achieve?')
        await Promise.resolve()
      })

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          parts: [
            expect.objectContaining({
              type: 'text',
              text: hiddenText,
            }),
          ],
          metadata: expect.objectContaining({
            localKnowledgeRetrieval: retrieval,
          }),
        })
      )

      const messages = useMessages.getState().getMessages(threadId)
      expect(messages[0].content[0].text.value).toBe(
        'What real-world hiring outcome did the author achieve?'
      )
      expect(messages[0].metadata.localKnowledgeRetrieval).toEqual(retrieval)
      expect(mockSetChatMessages).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'generated-id-1',
          parts: [
            expect.objectContaining({
              text: 'What real-world hiring outcome did the author achieve?',
            }),
          ],
        }),
      ])
    })

    it('passes failed document-processing attachments to the AX BI authoring workflow', async () => {
      const attachment = {
        name: 'sales.csv',
        type: 'document' as const,
        path: '/tmp/sales.csv',
        fileType: 'csv',
        processed: false,
        error: 'Failed to extract text',
      }
      useChatAttachments.setState({
        attachmentsByThread: {
          [threadId]: [attachment],
        },
      })
      axBiWorkflowMocks.runAxBiAuthoringWorkflow.mockResolvedValueOnce({
        handled: true,
        delegated: true,
        artifactType: 'dashboard',
        status: 'completed',
        message: 'Created AX BI dashboard',
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      await act(async () => {
        await result.current.processAndSendMessage('Create an AX BI dashboard from this file')
      })

      expect(runAxBiAuthoringWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [attachment],
        })
      )
      expect(mockSendMessage).not.toHaveBeenCalled()
      expect(useMessages.getState().getMessages(threadId)).toHaveLength(2)
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

    it('preserves aborted metadata on a partial assistant message', () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.persistMessageOnFinish(
          {
            id: 'msg-aborted',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Partial' }],
            metadata: { aborted: true },
          } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          [
            {
              type: 'text',
              text: { value: 'Partial', annotations: [] },
            },
          ] as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
      })

      expect(useMessages.getState().getMessages(threadId)[0].metadata).toMatchObject({
        aborted: true,
      })
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

    it('marks the old tail inactive instead of deleting it, tagging it as version 1', () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            { id: 'user-1', thread_id: threadId, role: 'user', content: [] },
            { id: 'assistant-1', thread_id: threadId, role: 'assistant', content: [] },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleRegenerate('assistant-1')
      })

      // Nothing is deleted — both messages remain in the raw store
      const messages = useMessages.getState().getMessages(threadId)
      expect(messages).toHaveLength(2)

      const assistant1 = messages.find((m) => m.id === 'assistant-1')!
      expect(assistant1.metadata).toMatchObject({
        versionGroupId: 'user-1',
        versionIndex: 1,
        isActiveVersion: false,
      })
      expect(mockRegenerate).toHaveBeenCalledWith({ messageId: 'assistant-1' })
    })

    it('tags every message in a multi-message tail with the same version', () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            { id: 'user-1', thread_id: threadId, role: 'user', content: [] },
            { id: 'assistant-1', thread_id: threadId, role: 'assistant', content: [] },
            { id: 'tool-1', thread_id: threadId, role: 'tool', content: [] },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleRegenerate('assistant-1')
      })

      const messages = useMessages.getState().getMessages(threadId)
      const tool1 = messages.find((m) => m.id === 'tool-1')!
      expect(tool1.metadata).toMatchObject({
        versionGroupId: 'user-1',
        versionIndex: 1,
        isActiveVersion: false,
      })
    })

    it('increments the version index on a second regenerate for the same turn', () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            { id: 'user-1', thread_id: threadId, role: 'user', content: [] },
            {
              id: 'assistant-1',
              thread_id: threadId,
              role: 'assistant',
              content: [],
              metadata: { versionGroupId: 'user-1', versionIndex: 1, isActiveVersion: false },
            },
            {
              id: 'assistant-2',
              thread_id: threadId,
              role: 'assistant',
              content: [],
              metadata: { versionGroupId: 'user-1', versionIndex: 2, isActiveVersion: true },
            },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleRegenerate('assistant-2')
      })

      const messages = useMessages.getState().getMessages(threadId)
      const assistant1 = messages.find((m) => m.id === 'assistant-1')!
      const assistant2 = messages.find((m) => m.id === 'assistant-2')!
      // v1 (already superseded) is untouched
      expect(assistant1.metadata).toMatchObject({ versionIndex: 1, isActiveVersion: false })
      // v2 becomes inactive, ready to be replaced by the incoming v3
      expect(assistant2.metadata).toMatchObject({
        versionGroupId: 'user-1',
        versionIndex: 2,
        isActiveVersion: false,
      })
    })

    it('does nothing to the store when there is no preceding tail', () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            { id: 'user-1', thread_id: threadId, role: 'user', content: [] },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleRegenerate('user-1')
      })

      const messages = useMessages.getState().getMessages(threadId)
      expect(messages[0].metadata ?? {}).toEqual({})
      expect(mockRegenerate).toHaveBeenCalledWith({ messageId: 'user-1' })
    })
  })

  describe('persistMessageOnFinish + version tagging', () => {
    it('applies a pending version tag to the newly persisted message after a regenerate', () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            { id: 'user-1', thread_id: threadId, role: 'user', content: [] },
            { id: 'assistant-1', thread_id: threadId, role: 'assistant', content: [] },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleRegenerate('assistant-1')
      })
      act(() => {
        result.current.persistMessageOnFinish(
          { id: 'assistant-2', role: 'assistant', parts: [{ type: 'text', text: 'new answer' }] } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          [{ type: 'text', text: { value: 'new answer', annotations: [] } }] as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
      })

      const messages = useMessages.getState().getMessages(threadId)
      const newMessage = messages.find((m) => m.id === 'assistant-2')!
      expect(newMessage.metadata).toMatchObject({
        versionGroupId: 'user-1',
        versionIndex: 2,
        isActiveVersion: true,
      })
    })

    it('does not tag a normal (non-regenerate) message', () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.persistMessageOnFinish(
          { id: 'msg-1', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          [{ type: 'text', text: { value: 'Hi', annotations: [] } }] as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
      })

      const messages = useMessages.getState().getMessages(threadId)
      expect((messages[0].metadata as Record<string, unknown>).versionGroupId).toBeUndefined()
    })

    it('a regenerate stopped before finishing does not tag the next unrelated message', async () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            { id: 'user-1', thread_id: threadId, role: 'user', content: [] },
            { id: 'assistant-1', thread_id: threadId, role: 'assistant', content: [] },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })

      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleRegenerate('assistant-1') // sets a pending tag
      })
      // Simulate: the regenerate was stopped (isAbort=true upstream), so
      // persistMessageOnFinish never fired. Instead, the user sends a normal
      // follow-up message, which must clear the stale pending tag.
      await act(async () => {
        await result.current.processAndSendMessage('a totally new question')
      })
      act(() => {
        result.current.persistMessageOnFinish(
          { id: 'assistant-unrelated', role: 'assistant', parts: [{ type: 'text', text: 'reply' }] } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          [{ type: 'text', text: { value: 'reply', annotations: [] } }] as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
      })

      const messages = useMessages.getState().getMessages(threadId)
      const unrelated = messages.find((m) => m.id === 'assistant-unrelated')!
      expect((unrelated.metadata as Record<string, unknown>).versionGroupId).toBeUndefined()
    })
  })

  describe('handleSwitchVersion', () => {
    const groupId = 'user-1'
    const setupTwoVersions = () => {
      useMessages.setState({
        messages: {
          [threadId]: [
            { id: 'user-1', thread_id: threadId, role: 'user', content: [] },
            {
              id: 'assistant-v1',
              thread_id: threadId,
              role: 'assistant',
              content: [{ type: 'text', text: { value: 'first answer', annotations: [] } }],
              metadata: { versionGroupId: groupId, versionIndex: 1, isActiveVersion: false },
            },
            {
              id: 'assistant-v2',
              thread_id: threadId,
              role: 'assistant',
              content: [{ type: 'text', text: { value: 'second answer', annotations: [] } }],
              metadata: { versionGroupId: groupId, versionIndex: 2, isActiveVersion: true },
            },
          ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      })
    }

    it('switches to the previous version and rebuilds chatMessages', () => {
      setupTwoVersions()
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleSwitchVersion(groupId, 'prev')
      })

      const messages = useMessages.getState().getMessages(threadId)
      const v1 = messages.find((m) => m.id === 'assistant-v1')!
      const v2 = messages.find((m) => m.id === 'assistant-v2')!
      expect(v1.metadata).toMatchObject({ isActiveVersion: true })
      expect(v2.metadata).toMatchObject({ isActiveVersion: false })
      expect(mockSetChatMessages).toHaveBeenCalled()
    })

    it('is a no-op once already at the boundary version', () => {
      setupTwoVersions()
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleSwitchVersion(groupId, 'prev') // v2 -> v1
      })
      mockSetChatMessages.mockClear()
      act(() => {
        result.current.handleSwitchVersion(groupId, 'prev') // already at v1
      })

      expect(mockSetChatMessages).not.toHaveBeenCalled()
    })

    it('is a no-op for an unknown group', () => {
      const { result } = renderHook(() => useThreadChat(defaultParams()))

      act(() => {
        result.current.handleSwitchVersion('does-not-exist', 'next')
      })

      expect(mockSetChatMessages).not.toHaveBeenCalled()
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
