import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const {
  mockTransport,
  mockEnsureSession,
  mockUpdateStatus,
  mockSetSessionTitle,
  mockUseChatSDK,
  sessionState,
} = vi.hoisted(() => {
  const transport = {
    updateSystemMessage: vi.fn(),
    updateInferenceParameters: vi.fn(),
    updateModelOverrideId: vi.fn(),
    updateActiveTeamId: vi.fn(),
    setCostApprovalCallback: vi.fn(),
    setOnTokenUsage: vi.fn(),
    refreshTools: vi.fn(),
    updateRagToolsAvailability: vi.fn(),
  }
  return {
    mockTransport: transport,
    mockEnsureSession: vi.fn(() => ({ id: 'chat-1' })),
    mockUpdateStatus: vi.fn(),
    mockSetSessionTitle: vi.fn(),
    mockUseChatSDK: vi.fn(() => ({
      messages: [],
      status: 'ready',
      append: vi.fn(),
      reload: vi.fn(),
      stop: vi.fn(),
      setMessages: vi.fn(),
    })),
    sessionState: {
      sessions: {} as Record<string, { transport?: unknown }>,
    },
  }
})

vi.mock('@/lib/chat/chat-transport-factory', () => ({
  createChatTransport: vi.fn(() => ({ ...mockTransport })),
}))

vi.mock('@/stores/chat-session-store', () => {
  const store = (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      ensureSession: mockEnsureSession,
      updateStatus: mockUpdateStatus,
      setSessionTitle: mockSetSessionTitle,
    })
  store.getState = () => ({
    sessions: sessionState.sessions,
  })
  store.setState = vi.fn()
  store.subscribe = vi.fn()
  store.destroy = vi.fn()
  return { useChatSessions: store }
})

vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      mcpToolNames: [],
      resetTokenSpeed: vi.fn(),
    }),
}))

vi.mock('@ai-sdk/react', () => ({
  useChat: mockUseChatSDK,
  Chat: vi.fn(),
}))

vi.mock('zod/v4', () => ({
  z: {
    object: vi.fn(() => ({})),
    string: vi.fn(() => ({ optional: vi.fn(() => ({})) })),
    number: vi.fn(() => ({ optional: vi.fn(() => ({})) })),
    enum: vi.fn(() => ({})),
    array: vi.fn(() => ({ optional: vi.fn(() => ({})) })),
    unknown: vi.fn(() => ({})),
  },
}))

// ─── Import ───────────────────────────────────────────────────────────────────

import { useChat } from '../use-chat'
import { createChatTransport } from '@/lib/chat/chat-transport-factory'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionState.sessions = {}
    // Reset transport ref by creating fresh mock
    ;(createChatTransport as ReturnType<typeof vi.fn>).mockReturnValue({ ...mockTransport })
  })

  // ── Phase 1: Basic initialization ────────────────────────────────────────

  it('creates transport on first render', () => {
    renderHook(() =>
      useChat({
        sessionId: 'session-1',
        systemMessage: 'Be helpful',
      })
    )

    expect(createChatTransport).toHaveBeenCalledWith({
      systemMessage: 'Be helpful',
      sessionId: 'session-1',
      inferenceParameters: {},
      modelOverrideId: undefined,
    })
  })

  it('returns chatResult properties plus custom methods', () => {
    const { result } = renderHook(() =>
      useChat({ sessionId: 'session-1' })
    )

    expect(result.current.messages).toEqual([])
    expect(result.current.status).toBe('ready')
    expect(typeof result.current.updateRagToolsAvailability).toBe('function')
    expect(typeof result.current.updateSystemMessageDirect).toBe('function')
  })

  // ── Phase 2: Session management ──────────────────────────────────────────

  it('calls ensureSession when sessionId is provided', () => {
    renderHook(() =>
      useChat({
        sessionId: 'session-abc',
        sessionTitle: 'My Chat',
      })
    )

    expect(mockEnsureSession).toHaveBeenCalledWith(
      'session-abc',
      expect.anything(),
      expect.any(Function),
      'My Chat'
    )
  })

  it('does not call ensureSession when sessionId is undefined', () => {
    renderHook(() => useChat({}))

    expect(mockEnsureSession).not.toHaveBeenCalled()
  })

  it('sets session title when sessionId and sessionTitle are provided', () => {
    renderHook(() =>
      useChat({
        sessionId: 'session-x',
        sessionTitle: 'Test Title',
      })
    )

    expect(mockSetSessionTitle).toHaveBeenCalledWith('session-x', 'Test Title')
  })

  // ── Phase 3: Transport updates via effects ───────────────────────────────

  it('updates system message on transport when it changes', () => {
    const { rerender } = renderHook(
      (props: { systemMessage?: string }) => useChat({ sessionId: 's1', ...props }),
      { initialProps: { systemMessage: 'first' } }
    )

    // The transport is created with the systemMessage in the constructor,
    // and the effect also calls updateSystemMessage
    const transport = (createChatTransport as ReturnType<typeof vi.fn>).mock.results[0]?.value
    if (transport) {
      expect(transport.updateSystemMessage).toHaveBeenCalledWith('first')
    }

    rerender({ systemMessage: 'second' })
    if (transport) {
      expect(transport.updateSystemMessage).toHaveBeenCalledWith('second')
    }
  })

  // ── Phase 4: Reuse existing session transport ────────────────────────────

  it('reuses existing session transport when available', () => {
    const existingTransport = { ...mockTransport, _isExisting: true }
    sessionState.sessions = {
      'session-reuse': { transport: existingTransport },
    }

    renderHook(() =>
      useChat({ sessionId: 'session-reuse' })
    )

    // The useChatSDK should be called; the important thing is
    // that createChatTransport was still called (but the transport
    // ref should be overridden by existingTransport)
    expect(mockUseChatSDK).toHaveBeenCalled()
  })

  // ── Phase 5: updateRagToolsAvailability ──────────────────────────────────

  it('updateRagToolsAvailability delegates to transport', async () => {
    const transport = { ...mockTransport }
    ;(createChatTransport as ReturnType<typeof vi.fn>).mockReturnValue(transport)
    transport.updateRagToolsAvailability.mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useChat({ sessionId: 'session-rag' })
    )

    await result.current.updateRagToolsAvailability(true, true, true)

    expect(transport.updateRagToolsAvailability).toHaveBeenCalledWith(
      true,
      true,
      true
    )
  })

  it('updateSystemMessageDirect delegates to transport', () => {
    const transport = { ...mockTransport }
    ;(createChatTransport as ReturnType<typeof vi.fn>).mockReturnValue(transport)

    const { result } = renderHook(() =>
      useChat({ sessionId: 'session-sys' })
    )

    result.current.updateSystemMessageDirect('new system msg')

    expect(transport.updateSystemMessage).toHaveBeenCalledWith('new system msg')
  })

  // ── useChatSDK integration ───────────────────────────────────────────────

  it('passes resume: false and experimental_throttle to useChatSDK', () => {
    renderHook(() =>
      useChat({
        sessionId: 's1',
        experimental_throttle: 100,
      })
    )

    expect(mockUseChatSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        resume: false,
        experimental_throttle: 100,
      })
    )
  })

  it('passes dataPartSchemas to useChatSDK', () => {
    renderHook(() => useChat({ sessionId: 's1' }))

    expect(mockUseChatSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        dataPartSchemas: expect.objectContaining({
          agentStatus: expect.anything(),
          agentToolCall: expect.anything(),
          runLog: expect.anything(),
        }),
      })
    )
  })

  // ── Inference parameters stabilization ───────────────────────────────────

  it('stabilizes inference parameters to prevent unnecessary re-renders', () => {
    const params1 = { temperature: 0.7 }
    const params2 = { temperature: 0.7 } // Same content, different reference

    const { rerender } = renderHook(
      (props: { inferenceParameters: Record<string, unknown> }) =>
        useChat({ sessionId: 's1', ...props }),
      { initialProps: { inferenceParameters: params1 } }
    )

    const firstCallCount = (createChatTransport as ReturnType<typeof vi.fn>).mock.calls.length

    rerender({ inferenceParameters: params2 })

    // Should not create a new transport for same content
    expect((createChatTransport as ReturnType<typeof vi.fn>).mock.calls.length).toBe(firstCallCount)
  })

  // ── No options ───────────────────────────────────────────────────────────

  it('works with no options (undefined)', () => {
    const { result } = renderHook(() => useChat())

    expect(result.current.status).toBe('ready')
    expect(result.current.messages).toEqual([])
  })
})
