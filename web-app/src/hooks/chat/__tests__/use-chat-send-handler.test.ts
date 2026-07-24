import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// All mock variables used inside vi.mock must use vi.hoisted to avoid
// "Cannot access before initialization" errors due to vi.mock hoisting.
const { mockNavigate, mockCreateThread, mockUpdateThread, mockGetProjectById } =
  vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockCreateThread: vi.fn(),
    mockUpdateThread: vi.fn(),
    mockGetProjectById: vi.fn(),
  }))

// Mutable state for model provider — cannot use vi.hoisted for these
// because they need reassignment in tests. We use a shared object instead.
const modelState = vi.hoisted(() => ({
  selectedModel: { id: 'model-1' } as { id: string } | null,
  selectedProvider: 'openai',
}))

// Threads already present in the store (getState().threads)
const threadsState = vi.hoisted(() => ({
  threads: {} as Record<string, unknown>,
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
}))

vi.mock('@/constants/routes', () => ({
  route: { threadsDetail: '/threads/$threadId' },
}))

vi.mock('@/constants/chat', () => ({
  TEMPORARY_CHAT_ID: 'temporary-chat',
  TEMPORARY_CHAT_QUERY_ID: 'temporary-chat',
  SESSION_STORAGE_KEY: {
    INITIAL_MESSAGE_TEMPORARY: 'initial-message-temporary',
  },
  SESSION_STORAGE_PREFIX: {
    INITIAL_MESSAGE: 'initial-message-',
  },
}))

vi.mock('@/lib/models', () => ({
  defaultModel: vi.fn(() => 'default-model-id'),
}))

vi.mock('@/hooks/threads/useThreads', () => {
  const store = (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ createThread: mockCreateThread })
  store.getState = () => ({
    updateThread: mockUpdateThread,
    threads: threadsState.threads,
  })
  return { useThreads: store }
})

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      selectedModel: modelState.selectedModel,
      selectedProvider: modelState.selectedProvider,
    }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    projects: () => ({ getProjectById: mockGetProjectById }),
  }),
  getServiceHub: () => ({}),
  initializeServiceHubStore: vi.fn(),
}))

// ─── Import under test ───────────────────────────────────────────────────────

import { useChatSendHandler } from '../use-chat-send-handler'
import { useTemporaryChat } from '@/hooks/chat/useTemporaryChat'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/chat/useChatAttachments'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultInput() {
  return {
    onSubmit: undefined as ((text: string) => void) | undefined,
    projectId: undefined as string | undefined,
    assistants: [] as Assistant[],
    selectedAssistant: undefined as Assistant | undefined,
    setSelectedAssistant: vi.fn(),
    setMessage: vi.fn(),
    setPrompt: vi.fn(),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useChatSendHandler', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    modelState.selectedModel = { id: 'model-1' }
    modelState.selectedProvider = 'openai'
    threadsState.threads = {}
    useTemporaryChat.setState({ temporaryChatEnabled: false })
    useChatAttachments.setState({ attachmentsByThread: {} })
    sessionStorage.clear()
    // Reset window.location.search
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    })
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  // ── Phase 1: Guard branches ──────────────────────────────────────────────

  it('uses the provider default model when selected model has not hydrated yet', async () => {
    modelState.selectedModel = null
    const newThread = { id: 'fallback-thread', metadata: {} }
    mockCreateThread.mockResolvedValue(newThread)
    const input = defaultInput()
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('hello')
    })

    expect(mockCreateThread).toHaveBeenCalledWith(
      { id: 'default-model-id', provider: 'openai' },
      'hello',
      undefined,
      undefined
    )
    expect(input.setMessage).not.toHaveBeenCalledWith(
      'Please select a model to start chatting.'
    )
  })

  it('returns early for empty / whitespace-only prompt', async () => {
    const input = defaultInput()
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('   ')
    })

    expect(input.setMessage).not.toHaveBeenCalled()
    expect(input.setPrompt).not.toHaveBeenCalled()
  })

  it('submits a ready attachment without typed prompt text', async () => {
    const onSubmit = vi.fn()
    useChatAttachments.getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, [
      {
        name: 'notes.md',
        type: 'document',
        processed: true,
        injectionMode: 'inline',
        inlineContent: '# Notes',
      },
    ])
    const input = { ...defaultInput(), onSubmit }
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('   ')
    })

    expect(onSubmit).toHaveBeenCalledWith('Please use the attached file.')
    expect(input.setMessage).toHaveBeenCalledWith('')
    expect(input.setPrompt).toHaveBeenCalledWith('')
  })

  // ── Phase 2: onSubmit (AI SDK) path ──────────────────────────────────────

  it('calls onSubmit, clears message and prompt when onSubmit is provided', async () => {
    const onSubmit = vi.fn()
    const input = { ...defaultInput(), onSubmit }
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('hi there')
    })

    expect(onSubmit).toHaveBeenCalledWith('hi there')
    expect(input.setMessage).toHaveBeenCalledWith('')
    expect(input.setPrompt).toHaveBeenCalledWith('')
    // Should NOT navigate or create a thread
    expect(mockCreateThread).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  // ── Phase 3: Temporary chat path ─────────────────────────────────────────

  it('navigates to temporary chat and stores message in sessionStorage (legacy query param)', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?temporary-chat=true' },
      writable: true,
    })
    const input = defaultInput()
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('temp prompt')
    })

    // Initial message is written under the per-thread key that
    // useThreadEffects consumes for TEMPORARY_CHAT_ID.
    expect(sessionStorage.getItem('initial-message-temporary-chat')).toBe(
      JSON.stringify({ text: 'temp prompt' })
    )
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/threads/$threadId',
      params: { threadId: 'temporary-chat' },
    })
    expect(input.setPrompt).toHaveBeenCalledWith('')
  })

  it('routes to the temporary-chat path when the composer toggle is enabled', async () => {
    useTemporaryChat.setState({ temporaryChatEnabled: true })
    const input = defaultInput()
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('secret stuff')
    })

    // No persisted thread is created — the only createThread call is the
    // in-memory temporary one (isTemporary=true, filtered from the sidebar
    // list and skipped by the persistence service).
    expect(mockCreateThread).toHaveBeenCalledTimes(1)
    expect(mockCreateThread).toHaveBeenCalledWith(
      { id: 'model-1', provider: 'openai' },
      undefined,
      undefined,
      undefined,
      true
    )
    expect(sessionStorage.getItem('initial-message-temporary-chat')).toBe(
      JSON.stringify({ text: 'secret stuff' })
    )
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/threads/$threadId',
      params: { threadId: 'temporary-chat' },
    })
    expect(input.setPrompt).toHaveBeenCalledWith('')
  })

  it('reuses the existing temporary thread instead of recreating it', async () => {
    useTemporaryChat.setState({ temporaryChatEnabled: true })
    threadsState.threads = {
      'temporary-chat': { id: 'temporary-chat', metadata: { isTemporary: true } },
    }
    const input = defaultInput()
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('follow up')
    })

    expect(mockCreateThread).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('initial-message-temporary-chat')).toBe(
      JSON.stringify({ text: 'follow up' })
    )
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/threads/$threadId',
      params: { threadId: 'temporary-chat' },
    })
  })

  it('creates a normal persisted thread when the toggle is off', async () => {
    const newThread = { id: 'normal-thread-1', metadata: {} }
    mockCreateThread.mockResolvedValue(newThread)
    const input = defaultInput()
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('regular prompt')
    })

    // isTemporary is not set → persisted thread path
    expect(mockCreateThread).toHaveBeenCalledWith(
      { id: 'model-1', provider: 'openai' },
      'regular prompt',
      undefined,
      undefined
    )
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/threads/$threadId',
      params: { threadId: 'normal-thread-1' },
    })
  })

  // ── Phase 4: New thread path (no project) ────────────────────────────────

  it('creates a new thread, stores initial message, and navigates', async () => {
    const newThread = { id: 'new-thread-1', metadata: {} }
    mockCreateThread.mockResolvedValue(newThread)

    const input = defaultInput()
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('hello world')
    })

    expect(mockCreateThread).toHaveBeenCalledWith(
      { id: 'model-1', provider: 'openai' },
      'hello world',
      undefined,
      undefined
    )

    expect(sessionStorage.getItem('initial-message-new-thread-1')).toBe(
      JSON.stringify({ text: 'hello world' })
    )

    expect(mockUpdateThread).toHaveBeenCalledWith('new-thread-1', {
      metadata: { pendingInitialMessage: 'hello world' },
    })
    expect(input.setSelectedAssistant).toHaveBeenCalledWith(undefined)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/threads/$threadId',
      params: { threadId: 'new-thread-1' },
    })
    expect(input.setPrompt).toHaveBeenCalledWith('')
  })

  // ── Phase 5: New thread with project ─────────────────────────────────────

  it('fetches project metadata and uses project assistant when projectId is given', async () => {
    const project = {
      id: 'proj-1',
      name: 'My Project',
      updated_at: 1000,
      logo: 'logo.png',
      projectPrompt: 'Be helpful',
      assistantId: 'assistant-1',
    }
    mockGetProjectById.mockResolvedValue(project)

    const projectAssistant = {
      id: 'assistant-1',
      name: 'Project Assistant',
    } as Assistant
    const otherAssistant = { id: 'assistant-2', name: 'Other' } as Assistant

    const newThread = { id: 'thread-proj', metadata: {} }
    mockCreateThread.mockResolvedValue(newThread)

    const input = {
      ...defaultInput(),
      projectId: 'proj-1',
      assistants: [projectAssistant, otherAssistant],
      selectedAssistant: otherAssistant,
    }
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('project prompt')
    })

    // Should use project assistant, not selectedAssistant
    expect(mockCreateThread).toHaveBeenCalledWith(
      { id: 'model-1', provider: 'openai' },
      'project prompt',
      projectAssistant,
      {
        id: 'proj-1',
        name: 'My Project',
        updated_at: 1000,
        logo: 'logo.png',
        projectPrompt: 'Be helpful',
      }
    )
  })

  it('gracefully handles project fetch failure', async () => {
    mockGetProjectById.mockRejectedValue(new Error('Network error'))
    const newThread = { id: 'thread-fallback', metadata: {} }
    mockCreateThread.mockResolvedValue(newThread)

    const input = {
      ...defaultInput(),
      projectId: 'proj-fail',
      selectedAssistant: { id: 'a1', name: 'A1' } as Assistant,
    }
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('test')
    })

    // Should still create thread with selectedAssistant (no project assistant)
    expect(mockCreateThread).toHaveBeenCalledWith(
      { id: 'model-1', provider: 'openai' },
      'test',
      input.selectedAssistant,
      undefined
    )
  })
})
