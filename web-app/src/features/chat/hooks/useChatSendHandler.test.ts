import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// All mock variables used inside vi.mock must use vi.hoisted to avoid
// "Cannot access before initialization" errors due to vi.mock hoisting.
const {
  mockNavigate,
  mockCreateThread,
  mockUpdateThread,
  mockGetProjectById,
} = vi.hoisted(() => ({
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
    NEW_THREAD_TEAM_ID: 'new-thread-team-id',
  },
  SESSION_STORAGE_PREFIX: {
    INITIAL_MESSAGE: 'initial-message-',
  },
}))

vi.mock('@/lib/models', () => ({
  defaultModel: vi.fn(() => 'default-model-id'),
}))

vi.mock('@/features/threads/hooks/useThreads', () => {
  const store = (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ createThread: mockCreateThread })
  store.getState = () => ({ updateThread: mockUpdateThread })
  return { useThreads: store }
})

vi.mock('@/features/models/hooks/useModelProvider', () => ({
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
  isServiceHubInitialized: () => true,
}))

// ─── Import under test ───────────────────────────────────────────────────────

import { useChatSendHandler } from './useChatSendHandler'

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
  beforeEach(() => {
    vi.clearAllMocks()
    modelState.selectedModel = { id: 'model-1' }
    modelState.selectedProvider = 'openai'
    sessionStorage.clear()
    // Reset window.location.search
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    })
  })

  // ── Phase 1: Guard branches ──────────────────────────────────────────────

  it('sets message and returns early when no model is selected', async () => {
    modelState.selectedModel = null
    const input = defaultInput()
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('hello')
    })

    expect(input.setMessage).toHaveBeenCalledWith(
      'Please select a model to start chatting.'
    )
    expect(input.setPrompt).not.toHaveBeenCalled()
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

  it('navigates to temporary chat and stores message in sessionStorage', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?temporary-chat=true' },
      writable: true,
    })
    const input = defaultInput()
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('temp prompt')
    })

    expect(sessionStorage.getItem('initial-message-temporary')).toBe(
      JSON.stringify({ text: 'temp prompt' })
    )
    expect(sessionStorage.getItem('temp-chat-nav')).toBe('true')
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/threads/$threadId',
      params: { threadId: 'temporary-chat' },
    })
    expect(input.setPrompt).toHaveBeenCalledWith('')
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

    const projectAssistant = { id: 'assistant-1', name: 'Project Assistant' } as Assistant
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

  it('handles stored team ID by updating thread metadata', async () => {
    const newThread = { id: 'thread-team', metadata: { existing: true } }
    mockCreateThread.mockResolvedValue(newThread)
    sessionStorage.setItem('new-thread-team-id', 'team-xyz')

    const input = defaultInput()
    const { result } = renderHook(() => useChatSendHandler(input))

    await act(async () => {
      await result.current.handleSendMessage('team prompt')
    })

    expect(mockUpdateThread).toHaveBeenCalledWith('thread-team', {
      metadata: { existing: true, agent_team_id: 'team-xyz' },
    })
    // Team ID should be removed from sessionStorage
    expect(sessionStorage.getItem('new-thread-team-id')).toBeNull()
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
