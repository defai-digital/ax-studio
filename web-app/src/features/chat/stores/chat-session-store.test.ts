import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatSessions, isSessionBusy } from './chat-session-store'

vi.mock('@/lib/custom-chat-transport', () => ({
  CustomChatTransport: vi.fn(),
}))

const makeChat = (status = 'idle') => ({
  status,
  messages: [],
  stop: vi.fn(),
  '~registerStatusCallback': vi.fn().mockReturnValue(vi.fn()),
})

const makeTransport = () => ({} as any)

beforeEach(() => {
  useChatSessions.setState({
    sessions: {},
    standaloneData: {},
    activeConversationId: undefined,
  })
})

describe('useChatSessions — initial state', () => {
  it('starts with empty sessions and no active conversation', () => {
    const state = useChatSessions.getState()
    expect(state.sessions).toEqual({})
    expect(state.standaloneData).toEqual({})
    expect(state.activeConversationId).toBeUndefined()
  })
})

describe('setActiveConversationId', () => {
  it('sets the active conversation', () => {
    useChatSessions.getState().setActiveConversationId('s1')
    expect(useChatSessions.getState().activeConversationId).toBe('s1')
  })

  it('clears the active conversation', () => {
    useChatSessions.getState().setActiveConversationId('s1')
    useChatSessions.getState().setActiveConversationId(undefined)
    expect(useChatSessions.getState().activeConversationId).toBeUndefined()
  })
})

describe('ensureSession', () => {
  it('creates a new session and sets it as active', () => {
    const chat = makeChat()
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any, 'My Chat')
    const state = useChatSessions.getState()
    expect(state.sessions['s1']).toBeDefined()
    expect(state.sessions['s1'].title).toBe('My Chat')
    expect(state.activeConversationId).toBe('s1')
  })

  it('returns the existing chat if session already exists', () => {
    const chat = makeChat()
    const first = useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    const second = useChatSessions.getState().ensureSession('s1', makeTransport(), () => makeChat() as any)
    expect(first).toBe(second)
  })

  it('updates transport and title when they change on an existing session', () => {
    const chat = makeChat()
    const transport1 = makeTransport()
    const transport2 = makeTransport()
    useChatSessions.getState().ensureSession('s1', transport1, () => chat as any, 'Title1')
    useChatSessions.getState().ensureSession('s1', transport2, () => chat as any, 'Title2')
    const session = useChatSessions.getState().sessions['s1']
    expect(session.transport).toBe(transport2)
    expect(session.title).toBe('Title2')
  })

  it('promotes standalone data into the new session', () => {
    const standaloneData = useChatSessions.getState().getSessionData('s1')
    const chat = makeChat()
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    expect(useChatSessions.getState().sessions['s1'].data).toBe(standaloneData)
    expect(useChatSessions.getState().standaloneData['s1']).toBeUndefined()
  })

  it('registers the status callback on the chat', () => {
    const chat = makeChat()
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    expect(chat['~registerStatusCallback']).toHaveBeenCalled()
  })
})

describe('getSessionData', () => {
  it('returns data for an active session', () => {
    const chat = makeChat()
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    const data = useChatSessions.getState().getSessionData('s1')
    expect(data.tools).toEqual([])
    expect(data.messages).toEqual([])
    expect(data.idMap).toBeInstanceOf(Map)
  })

  it('creates standalone data for an unknown session id', () => {
    const data = useChatSessions.getState().getSessionData('unknown')
    expect(data).toBeDefined()
    expect(useChatSessions.getState().standaloneData['unknown']).toBe(data)
  })

  it('returns the same standalone data object on repeated calls', () => {
    const d1 = useChatSessions.getState().getSessionData('s2')
    const d2 = useChatSessions.getState().getSessionData('s2')
    expect(d1).toBe(d2)
  })
})

describe('updateStatus', () => {
  it('updates status and sets isStreaming true for streaming', () => {
    const chat = makeChat('idle')
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    useChatSessions.getState().updateStatus('s1', 'streaming')
    const session = useChatSessions.getState().sessions['s1']
    expect(session.status).toBe('streaming')
    expect(session.isStreaming).toBe(true)
  })

  it('sets isStreaming true for submitted status', () => {
    const chat = makeChat('idle')
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    useChatSessions.getState().updateStatus('s1', 'submitted')
    expect(useChatSessions.getState().sessions['s1'].isStreaming).toBe(true)
  })

  it('sets isStreaming false for idle status', () => {
    const chat = makeChat('streaming')
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    useChatSessions.getState().updateStatus('s1', 'idle')
    expect(useChatSessions.getState().sessions['s1'].isStreaming).toBe(false)
  })

  it('is a no-op for an unknown session', () => {
    const sessionsBefore = useChatSessions.getState().sessions
    useChatSessions.getState().updateStatus('ghost', 'streaming')
    expect(useChatSessions.getState().sessions).toBe(sessionsBefore)
  })

  it('skips the update when status and isStreaming are unchanged', () => {
    const chat = makeChat('idle')
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    const sessionBefore = useChatSessions.getState().sessions['s1']
    useChatSessions.getState().updateStatus('s1', 'idle')
    expect(useChatSessions.getState().sessions['s1']).toBe(sessionBefore)
  })
})

describe('setSessionTitle', () => {
  it('updates the session title', () => {
    const chat = makeChat()
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any, 'Old')
    useChatSessions.getState().setSessionTitle('s1', 'New')
    expect(useChatSessions.getState().sessions['s1'].title).toBe('New')
  })

  it('is a no-op when title is undefined', () => {
    const chat = makeChat()
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any, 'Title')
    useChatSessions.getState().setSessionTitle('s1', undefined)
    expect(useChatSessions.getState().sessions['s1'].title).toBe('Title')
  })

  it('is a no-op when title is unchanged', () => {
    const chat = makeChat()
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any, 'Same')
    const sessionBefore = useChatSessions.getState().sessions['s1']
    useChatSessions.getState().setSessionTitle('s1', 'Same')
    expect(useChatSessions.getState().sessions['s1']).toBe(sessionBefore)
  })
})

describe('removeSession', () => {
  it('removes the session and calls unsubscribers and stop', () => {
    const unsubscribe = vi.fn()
    const chat = makeChat()
    chat['~registerStatusCallback'] = vi.fn().mockReturnValue(unsubscribe)
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    useChatSessions.getState().removeSession('s1')
    expect(useChatSessions.getState().sessions['s1']).toBeUndefined()
    expect(unsubscribe).toHaveBeenCalled()
    expect(chat.stop).toHaveBeenCalled()
  })

  it('removes standalone data when no session exists', () => {
    useChatSessions.getState().getSessionData('solo')
    useChatSessions.getState().removeSession('solo')
    expect(useChatSessions.getState().standaloneData['solo']).toBeUndefined()
  })

  it('handles errors in unsubscribers gracefully', () => {
    const chat = makeChat()
    chat['~registerStatusCallback'] = vi.fn().mockReturnValue(() => {
      throw new Error('unsub error')
    })
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    expect(() => useChatSessions.getState().removeSession('s1')).not.toThrow()
  })

  it('handles errors in chat.stop gracefully', () => {
    const chat = makeChat()
    chat.stop = vi.fn().mockImplementation(() => { throw new Error('stop error') })
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => chat as any)
    expect(() => useChatSessions.getState().removeSession('s1')).not.toThrow()
  })
})

describe('clearSessions', () => {
  it('removes all sessions and resets state', () => {
    const c1 = makeChat()
    const c2 = makeChat()
    useChatSessions.getState().ensureSession('s1', makeTransport(), () => c1 as any)
    useChatSessions.getState().ensureSession('s2', makeTransport(), () => c2 as any)
    useChatSessions.getState().clearSessions()
    const state = useChatSessions.getState()
    expect(state.sessions).toEqual({})
    expect(state.standaloneData).toEqual({})
    expect(state.activeConversationId).toBeUndefined()
    expect(c1.stop).toHaveBeenCalled()
    expect(c2.stop).toHaveBeenCalled()
  })

  it('is safe to call when there are no sessions', () => {
    expect(() => useChatSessions.getState().clearSessions()).not.toThrow()
  })
})

describe('isSessionBusy', () => {
  it('returns false for undefined', () => {
    expect(isSessionBusy(undefined)).toBe(false)
  })

  it('returns true when streaming', () => {
    expect(isSessionBusy({ isStreaming: true, data: { tools: [] } } as any)).toBe(true)
  })

  it('returns true when there are pending tools', () => {
    expect(isSessionBusy({ isStreaming: false, data: { tools: ['tool1'] } } as any)).toBe(true)
  })

  it('returns false when not streaming and no tools', () => {
    expect(isSessionBusy({ isStreaming: false, data: { tools: [] } } as any)).toBe(false)
  })
})
