import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Chat, UIMessage } from '@ai-sdk/react'
import type { CustomChatTransport } from '@/lib/custom-chat-transport'
import type { ChatSession } from '../chat-session-store'
import { useChatSessions, isSessionBusy } from '../chat-session-store'

vi.mock('@/lib/custom-chat-transport', () => ({
  CustomChatTransport: vi.fn(),
}))

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

type TestChat = Chat<UIMessage> & {
  'stop': ReturnType<typeof vi.fn>
  '~registerStatusCallback': ReturnType<typeof vi.fn>
}

const makeChat = (status = 'idle'): TestChat =>
  ({
    status,
    'messages': [],
    'stop': vi.fn(),
    '~registerStatusCallback': vi.fn().mockReturnValue(vi.fn()),
  }) as unknown as TestChat

const createChat =
  (chat = makeChat()) =>
  () =>
    chat

const makeTransport = (): CustomChatTransport =>
  ({}) as unknown as CustomChatTransport

const makeBusySession = ({
  isStreaming,
  tools,
}: {
  isStreaming: boolean
  tools: unknown[]
}): ChatSession =>
  ({
    isStreaming,
    data: { tools },
  }) as ChatSession

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useChatSessions.setState({
    sessions: {},
    standaloneData: {},
    activeConversationId: undefined,
  })
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
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
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat), 'My Chat')
    const state = useChatSessions.getState()
    expect(state.sessions['s1']).toBeDefined()
    expect(state.sessions['s1'].title).toBe('My Chat')
    expect(state.activeConversationId).toBe('s1')
  })

  it('returns the existing chat if session already exists', () => {
    const chat = makeChat()
    const transport = makeTransport()
    const first = useChatSessions
      .getState()
      .ensureSession('s1', transport, createChat(chat))
    const second = useChatSessions
      .getState()
      .ensureSession('s1', transport, createChat())
    expect(first).toBe(second)
  })

  it('updates transport and title when they change on an existing session', () => {
    const chat = makeChat()
    const transport1 = makeTransport()
    const transport2 = makeTransport()
    useChatSessions
      .getState()
      .ensureSession('s1', transport1, createChat(chat), 'Title1')
    useChatSessions
      .getState()
      .ensureSession('s1', transport2, createChat(chat), 'Title2')
    const session = useChatSessions.getState().sessions['s1']
    expect(session.transport).toBe(transport2)
    expect(session.title).toBe('Title2')
  })

  it('promotes standalone data into the new session', () => {
    const standaloneData = useChatSessions.getState().ensureSessionData('s1')
    const chat = makeChat()
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat))
    expect(useChatSessions.getState().sessions['s1'].data).toBe(standaloneData)
    expect(useChatSessions.getState().standaloneData['s1']).toBeUndefined()
  })

  it('registers the status callback on the chat', () => {
    const chat = makeChat()
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat))
    expect(chat['~registerStatusCallback']).toHaveBeenCalled()
  })
})

describe('getSessionData', () => {
  it('returns data for an active session', () => {
    const chat = makeChat()
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat))
    const data = useChatSessions.getState().getSessionData('s1')
    expect(data.tools).toEqual([])
    expect(data.messages).toEqual([])
    expect(data.idMap).toBeInstanceOf(Map)
  })

  it('returns null for an unknown session id', () => {
    const data = useChatSessions.getState().getSessionData('unknown')
    expect(data).toBeNull()
    expect(useChatSessions.getState().standaloneData['unknown']).toBeUndefined()
  })

  it('returns the same standalone data object on repeated ensure calls', () => {
    const d1 = useChatSessions.getState().ensureSessionData('s2')
    const d2 = useChatSessions.getState().ensureSessionData('s2')
    expect(d1).toBe(d2)
  })
})

describe('updateStatus', () => {
  it('updates status and sets isStreaming true for streaming', () => {
    const chat = makeChat('idle')
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat))
    useChatSessions.getState().updateStatus('s1', 'streaming')
    const session = useChatSessions.getState().sessions['s1']
    expect(session.status).toBe('streaming')
    expect(session.isStreaming).toBe(true)
  })

  it('sets isStreaming true for submitted status', () => {
    const chat = makeChat('idle')
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat))
    useChatSessions.getState().updateStatus('s1', 'submitted')
    expect(useChatSessions.getState().sessions['s1'].isStreaming).toBe(true)
  })

  it('sets isStreaming false for idle status', () => {
    const chat = makeChat('streaming')
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat))
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
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat))
    const sessionBefore = useChatSessions.getState().sessions['s1']
    useChatSessions.getState().updateStatus('s1', 'idle')
    expect(useChatSessions.getState().sessions['s1']).toBe(sessionBefore)
  })
})

describe('setSessionTitle', () => {
  it('updates the session title', () => {
    const chat = makeChat()
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat), 'Old')
    useChatSessions.getState().setSessionTitle('s1', 'New')
    expect(useChatSessions.getState().sessions['s1'].title).toBe('New')
  })

  it('is a no-op when title is undefined', () => {
    const chat = makeChat()
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat), 'Title')
    useChatSessions.getState().setSessionTitle('s1', undefined)
    expect(useChatSessions.getState().sessions['s1'].title).toBe('Title')
  })

  it('is a no-op when title is unchanged', () => {
    const chat = makeChat()
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat), 'Same')
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
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat))
    useChatSessions.getState().removeSession('s1')
    expect(useChatSessions.getState().sessions['s1']).toBeUndefined()
    expect(unsubscribe).toHaveBeenCalled()
    expect(chat.stop).toHaveBeenCalled()
  })

  it('removes standalone data when no session exists', () => {
    useChatSessions.getState().ensureSessionData('solo')
    useChatSessions.getState().removeSession('solo')
    expect(useChatSessions.getState().standaloneData['solo']).toBeUndefined()
  })

  it('handles errors in unsubscribers gracefully', () => {
    const chat = makeChat()
    chat['~registerStatusCallback'] = vi.fn().mockReturnValue(() => {
      throw new Error('unsub error')
    })
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat))
    expect(() => useChatSessions.getState().removeSession('s1')).not.toThrow()
  })

  it('handles errors in chat.stop gracefully', () => {
    const chat = makeChat()
    chat.stop = vi.fn().mockImplementation(() => {
      throw new Error('stop error')
    })
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(chat))
    expect(() => useChatSessions.getState().removeSession('s1')).not.toThrow()
  })
})

describe('clearSessions', () => {
  it('removes all sessions and resets state', () => {
    const c1 = makeChat()
    const c2 = makeChat()
    useChatSessions
      .getState()
      .ensureSession('s1', makeTransport(), createChat(c1))
    useChatSessions
      .getState()
      .ensureSession('s2', makeTransport(), createChat(c2))
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
    expect(
      isSessionBusy(makeBusySession({ isStreaming: true, tools: [] }))
    ).toBe(true)
  })

  it('returns true when there are pending tools', () => {
    expect(
      isSessionBusy(makeBusySession({ isStreaming: false, tools: ['tool1'] }))
    ).toBe(true)
  })

  it('returns false when not streaming and no tools', () => {
    expect(
      isSessionBusy(makeBusySession({ isStreaming: false, tools: [] }))
    ).toBe(false)
  })
})
