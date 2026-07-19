import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useThreadEffects, type ThreadEffectsInput } from '../use-thread-effects'
import { defaultAssistant } from '@/hooks/chat/useAssistant'

vi.mock('@/constants/chat', () => ({
  SESSION_STORAGE_KEY: {
    INITIAL_MESSAGE_TEMPORARY: 'initial-message-temporary',
    NEW_THREAD_PROMPT: 'new-thread-prompt',
    SPLIT_VIEW_INFO: 'split-view-info',
  },
  SESSION_STORAGE_PREFIX: {
    INITIAL_MESSAGE: 'initial-message-',
  },
}))

describe('useThreadEffects', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  const threadId = 'thread-1'
  let defaultInput: ThreadEffectsInput

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sessionStorage.clear()

    defaultInput = {
      threadId,
      thread: {
        id: threadId,
        title: 'Test',
        updated: Date.now() / 1000,
        metadata: {},
        assistants: [],
      } as unknown as Thread,
      chatMessages: [],
      persistedMessages: [],
      messagesLoaded: true,
      status: 'idle',
      assistants: [],
      selectedModel: undefined,
      reasoningContainerRef: { current: null },
      setCurrentThreadId: vi.fn(),
      setCurrentAssistant: vi.fn(),
      processAndSendMessage: vi.fn(),
      updateThread: vi.fn(),
      setThreadPromptDraft: vi.fn(),
    }
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('calls setCurrentThreadId with threadId on mount', () => {
    renderHook(() => useThreadEffects(defaultInput))

    expect(defaultInput.setCurrentThreadId).toHaveBeenCalledWith(threadId)
  })

  it('calls setCurrentThreadId with undefined on unmount', () => {
    const { unmount } = renderHook(() => useThreadEffects(defaultInput))

    unmount()

    expect(defaultInput.setCurrentThreadId).toHaveBeenCalledWith(undefined)
  })

  it('syncs thread prompt draft from thread metadata', () => {
    defaultInput.thread = {
      ...defaultInput.thread!,
      metadata: { threadPrompt: 'Custom prompt' },
    } as unknown as Thread

    renderHook(() => useThreadEffects(defaultInput))

    expect(defaultInput.setThreadPromptDraft).toHaveBeenCalledWith('Custom prompt')
  })

  it('sets empty thread prompt draft when metadata has no threadPrompt', () => {
    renderHook(() => useThreadEffects(defaultInput))

    expect(defaultInput.setThreadPromptDraft).toHaveBeenCalledWith('')
  })

  it('sends initial message from sessionStorage', async () => {
    const initialMsg = JSON.stringify({ text: 'Hello from session' })
    sessionStorage.setItem(`initial-message-${threadId}`, initialMsg)

    renderHook(() => useThreadEffects(defaultInput))

    // Wait for async dispatch
    await vi.waitFor(() => {
      expect(defaultInput.processAndSendMessage).toHaveBeenCalledWith(
        'Hello from session'
      )
    })
  })

  it('removes initial message from sessionStorage after queuing it', async () => {
    sessionStorage.setItem(
      `initial-message-${threadId}`,
      JSON.stringify({ text: 'temp' })
    )

    renderHook(() => useThreadEffects(defaultInput))

    await vi.waitFor(() => {
      expect(sessionStorage.getItem(`initial-message-${threadId}`)).toBeNull()
    })
  })

  it('sends pending initial message from thread metadata when sessionStorage is empty', async () => {
    defaultInput.thread = {
      ...defaultInput.thread!,
      metadata: {
        pendingInitialMessage: 'Hello from metadata',
        threadPrompt: 'Keep this prompt',
      },
    } as unknown as Thread

    renderHook(() => useThreadEffects(defaultInput))

    await vi.waitFor(() => {
      expect(defaultInput.processAndSendMessage).toHaveBeenCalledWith(
        'Hello from metadata'
      )
    })
    expect(defaultInput.updateThread).toHaveBeenCalledWith(threadId, {
      metadata: { threadPrompt: 'Keep this prompt' },
    })
  })

  it('waits for message history before consuming an initial message', async () => {
    sessionStorage.setItem(
      `initial-message-${threadId}`,
      JSON.stringify({ text: 'wait for history' })
    )
    defaultInput.messagesLoaded = false

    const { rerender } = renderHook(() => useThreadEffects(defaultInput))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(defaultInput.processAndSendMessage).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(`initial-message-${threadId}`)).not.toBeNull()

    defaultInput.messagesLoaded = true
    rerender()

    await vi.waitFor(() => {
      expect(defaultInput.processAndSendMessage).toHaveBeenCalledWith(
        'wait for history'
      )
    })
  })

  it('consumes a stale handoff without replaying an existing user message', async () => {
    sessionStorage.setItem(
      `initial-message-${threadId}`,
      JSON.stringify({ text: 'already sent' })
    )
    defaultInput.persistedMessages = [
      {
        id: 'user-1',
        role: 'user',
        content: [
          {
            type: 'text',
            text: { value: 'already sent', annotations: [] },
          },
        ],
      },
    ] as unknown as ThreadEffectsInput['persistedMessages']

    renderHook(() => useThreadEffects(defaultInput))

    await vi.waitFor(() => {
      expect(sessionStorage.getItem(`initial-message-${threadId}`)).toBeNull()
    })
    expect(defaultInput.processAndSendMessage).not.toHaveBeenCalled()
  })

  it('consumes the initial message before asynchronous queuing finishes', async () => {
    const initialMsg = JSON.stringify({ text: 'retry me' })
    let finishQueuing: (() => void) | undefined
    defaultInput.processAndSendMessage = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        finishQueuing = resolve
      })
    )
    sessionStorage.setItem(`initial-message-${threadId}`, initialMsg)

    renderHook(() => useThreadEffects(defaultInput))

    await vi.waitFor(() => {
      expect(defaultInput.processAndSendMessage).toHaveBeenCalledWith('retry me')
    })
    expect(sessionStorage.getItem(`initial-message-${threadId}`)).toBeNull()
    finishQueuing?.()
  })

  it('does not restore a consumed initial message when queuing fails', async () => {
    sessionStorage.setItem(
      `initial-message-${threadId}`,
      JSON.stringify({ text: 'send once' })
    )
    defaultInput.processAndSendMessage = vi
      .fn()
      .mockRejectedValue(new Error('not ready'))

    renderHook(() => useThreadEffects(defaultInput))

    await vi.waitFor(() => {
      expect(defaultInput.processAndSendMessage).toHaveBeenCalledWith('send once')
    })
    expect(sessionStorage.getItem(`initial-message-${threadId}`)).toBeNull()
  })

  it('does not mark an initial message sent when StrictMode cleanup cancels the dispatch timer', async () => {
    const initialMsg = JSON.stringify({ text: 'strict mode first message' })
    sessionStorage.setItem(`initial-message-${threadId}`, initialMsg)

    const { unmount } = renderHook(() => useThreadEffects(defaultInput))
    unmount()

    renderHook(() => useThreadEffects(defaultInput))

    await vi.waitFor(() => {
      expect(defaultInput.processAndSendMessage).toHaveBeenCalledWith(
        'strict mode first message'
      )
    })
  })

  it('applies thread prompt from sessionStorage', () => {
    sessionStorage.setItem('new-thread-prompt', 'Stored prompt')

    renderHook(() => useThreadEffects(defaultInput))

    expect(defaultInput.updateThread).toHaveBeenCalledWith(
      threadId,
      expect.objectContaining({
        metadata: expect.objectContaining({
          threadPrompt: 'Stored prompt',
        }),
      })
    )
    expect(defaultInput.setThreadPromptDraft).toHaveBeenCalledWith('Stored prompt')
  })

  it('removes thread prompt from sessionStorage after applying', () => {
    sessionStorage.setItem('new-thread-prompt', 'Stored prompt')

    renderHook(() => useThreadEffects(defaultInput))

    expect(sessionStorage.getItem('new-thread-prompt')).toBeNull()
  })

  it('sets current assistant when matching assistant found', () => {
    const assistant = { id: 'a1', name: 'Test Assistant' } as unknown as Assistant
    defaultInput.assistants = [assistant]
    defaultInput.thread = {
      ...defaultInput.thread!,
      assistants: [{ id: 'a1' }],
    } as unknown as Thread

    renderHook(() => useThreadEffects(defaultInput))

    expect(defaultInput.setCurrentAssistant).toHaveBeenCalledWith(assistant)
  })

  it('resets to defaultAssistant when no matching assistant', () => {
    defaultInput.assistants = [
      { id: 'a2', name: 'Other' } as unknown as Assistant,
    ]
    defaultInput.thread = {
      ...defaultInput.thread!,
      assistants: [{ id: 'a1' }],
    } as unknown as Thread

    renderHook(() => useThreadEffects(defaultInput))

    expect(defaultInput.setCurrentAssistant).toHaveBeenCalledWith(defaultAssistant)
  })

  it('resets to defaultAssistant when thread has no assistants (user selected None)', () => {
    const customAssistant = { id: 'a1', name: 'Custom' } as unknown as Assistant
    defaultInput.assistants = [customAssistant]
    defaultInput.thread = {
      ...defaultInput.thread!,
      assistants: [],
    } as unknown as Thread

    renderHook(() => useThreadEffects(defaultInput))

    expect(defaultInput.setCurrentAssistant).toHaveBeenCalledWith(defaultAssistant)
  })

  it('resets to defaultAssistant when thread assistants is undefined', () => {
    const customAssistant = { id: 'a1', name: 'Custom' } as unknown as Assistant
    defaultInput.assistants = [customAssistant]
    defaultInput.thread = {
      ...defaultInput.thread!,
    } as unknown as Thread

    renderHook(() => useThreadEffects(defaultInput))

    expect(defaultInput.setCurrentAssistant).toHaveBeenCalledWith(defaultAssistant)
  })

  // NOTE: The reasoning scroll effect and team token loading via Tauri invoke
  // require a running DOM and Tauri runtime respectively. These are better
  // tested in integration/e2e tests rather than unit tests.
})
