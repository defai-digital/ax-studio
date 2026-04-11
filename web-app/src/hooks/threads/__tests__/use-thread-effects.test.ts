import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useThreadEffects, type ThreadEffectsInput } from '../use-thread-effects'
import { defaultAssistant } from '@/hooks/chat/useAssistant'

// Mock Tauri invoke (used for team token loading)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}))

// Mock constants
vi.mock('@/constants/chat', () => ({
  SESSION_STORAGE_KEY: {
    INITIAL_MESSAGE_TEMPORARY: 'initial-message-temporary',
    NEW_THREAD_PROMPT: 'new-thread-prompt',
    NEW_THREAD_TEAM_ID: 'new-thread-team-id',
    SPLIT_VIEW_INFO: 'split-view-info',
  },
  SESSION_STORAGE_PREFIX: {
    INITIAL_MESSAGE: 'initial-message-',
  },
}))

describe('useThreadEffects', () => {
  const threadId = 'thread-1'
  let defaultInput: ThreadEffectsInput

  beforeEach(() => {
    vi.clearAllMocks()
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
      status: 'idle',
      assistants: [],
      selectedModel: undefined,
      activeTeamId: undefined,
      setTeamTokensUsed: vi.fn(),
      reasoningContainerRef: { current: null },
      setCurrentThreadId: vi.fn(),
      setCurrentAssistant: vi.fn(),
      processAndSendMessage: vi.fn(),
      handleResearchCommand: vi.fn().mockReturnValue(false),
      cancelResearch: vi.fn(),
      updateThread: vi.fn(),
      setThreadPromptDraft: vi.fn(),
    }
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

  it('resets team tokens to 0 when no activeTeamId', () => {
    renderHook(() => useThreadEffects(defaultInput))

    expect(defaultInput.setTeamTokensUsed).toHaveBeenCalledWith(0)
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

  it('removes initial message from sessionStorage after reading', () => {
    sessionStorage.setItem(
      `initial-message-${threadId}`,
      JSON.stringify({ text: 'temp' })
    )

    renderHook(() => useThreadEffects(defaultInput))

    expect(sessionStorage.getItem(`initial-message-${threadId}`)).toBeNull()
  })

  it('routes /research initial message through handleResearchCommand', async () => {
    defaultInput.handleResearchCommand = vi.fn().mockReturnValue(true)
    sessionStorage.setItem(
      `initial-message-${threadId}`,
      JSON.stringify({ text: '/research quantum computing' })
    )

    renderHook(() => useThreadEffects(defaultInput))

    await vi.waitFor(() => {
      expect(defaultInput.handleResearchCommand).toHaveBeenCalledWith(
        '/research quantum computing'
      )
    })

    // processAndSendMessage should NOT be called when research command returns true
    expect(defaultInput.processAndSendMessage).not.toHaveBeenCalled()
  })

  it('cancels research started from the initial message on unmount', async () => {
    defaultInput.handleResearchCommand = vi.fn().mockReturnValue(true)
    sessionStorage.setItem(
      `initial-message-${threadId}`,
      JSON.stringify({ text: '/research ai agents' })
    )

    const { unmount } = renderHook(() => useThreadEffects(defaultInput))

    await vi.waitFor(() => {
      expect(defaultInput.handleResearchCommand).toHaveBeenCalledWith(
        '/research ai agents'
      )
    })

    unmount()

    expect(defaultInput.cancelResearch).toHaveBeenCalled()
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

  it('applies agent team from sessionStorage', () => {
    sessionStorage.setItem('new-thread-team-id', 'team-1')

    renderHook(() => useThreadEffects(defaultInput))

    expect(defaultInput.updateThread).toHaveBeenCalledWith(
      threadId,
      expect.objectContaining({
        metadata: expect.objectContaining({
          agent_team_id: 'team-1',
        }),
      })
    )
  })

  it('removes agent team from sessionStorage after applying', () => {
    sessionStorage.setItem('new-thread-team-id', 'team-1')

    renderHook(() => useThreadEffects(defaultInput))

    expect(sessionStorage.getItem('new-thread-team-id')).toBeNull()
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
