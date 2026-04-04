import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSessionData,
  isSessionBusy,
  createSession,
  applyStatusUpdate,
  destroySession,
  STREAMING_STATUSES,
} from './chat-session-controller'
import type { ChatSession } from './chat-session-types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeChat = (status = 'idle') => ({
  status,
  messages: [],
  stop: vi.fn(),
  '~registerStatusCallback': vi.fn().mockReturnValue(vi.fn()),
})

const makeTransport = () => ({} as any)

const makeSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  chat: makeChat() as any,
  transport: makeTransport(),
  status: 'idle',
  isStreaming: false,
  unsubscribers: [],
  data: createSessionData(),
  ...overrides,
})

// ─── createSessionData ────────────────────────────────────────────────────────

describe('createSessionData', () => {
  it('returns empty tools, messages, and a fresh idMap', () => {
    const data = createSessionData()
    expect(data.tools).toEqual([])
    expect(data.messages).toEqual([])
    expect(data.idMap).toBeInstanceOf(Map)
    expect(data.idMap.size).toBe(0)
  })

  it('returns a new object on each call', () => {
    const a = createSessionData()
    const b = createSessionData()
    expect(a).not.toBe(b)
    expect(a.idMap).not.toBe(b.idMap)
  })
})

// ─── STREAMING_STATUSES ───────────────────────────────────────────────────────

describe('STREAMING_STATUSES', () => {
  it('includes submitted and streaming', () => {
    expect(STREAMING_STATUSES).toContain('submitted')
    expect(STREAMING_STATUSES).toContain('streaming')
  })
})

// ─── isSessionBusy ───────────────────────────────────────────────────────────

describe('isSessionBusy', () => {
  it('returns false for undefined', () => {
    expect(isSessionBusy(undefined)).toBe(false)
  })

  it('returns true when isStreaming is true', () => {
    expect(isSessionBusy(makeSession({ isStreaming: true }))).toBe(true)
  })

  it('returns true when there are pending tools', () => {
    const session = makeSession({ data: { tools: ['t1'], messages: [], idMap: new Map() } })
    expect(isSessionBusy(session)).toBe(true)
  })

  it('returns false when not streaming and no tools', () => {
    expect(isSessionBusy(makeSession({ isStreaming: false }))).toBe(false)
  })
})

// ─── createSession ───────────────────────────────────────────────────────────

describe('createSession', () => {
  it('creates a session using the provided chat factory', () => {
    const chat = makeChat('idle')
    const onStatusChange = vi.fn()
    const session = createSession('s1', makeTransport(), () => chat as any, 'Title', undefined, onStatusChange)
    expect(session.chat).toBe(chat)
    expect(session.title).toBe('Title')
    expect(session.status).toBe('idle')
    expect(session.isStreaming).toBe(false)
  })

  it('sets isStreaming true when initial chat status is streaming', () => {
    const chat = makeChat('streaming')
    const session = createSession('s1', makeTransport(), () => chat as any, undefined, undefined, vi.fn())
    expect(session.isStreaming).toBe(true)
  })

  it('sets isStreaming true when initial chat status is submitted', () => {
    const chat = makeChat('submitted')
    const session = createSession('s1', makeTransport(), () => chat as any, undefined, undefined, vi.fn())
    expect(session.isStreaming).toBe(true)
  })

  it('registers the status callback and stores the unsubscriber', () => {
    const unsubscribe = vi.fn()
    const chat = makeChat()
    chat['~registerStatusCallback'] = vi.fn().mockReturnValue(unsubscribe)
    const session = createSession('s1', makeTransport(), () => chat as any, undefined, undefined, vi.fn())
    expect(chat['~registerStatusCallback']).toHaveBeenCalled()
    expect(session.unsubscribers).toContain(unsubscribe)
  })

  it('handles missing ~registerStatusCallback gracefully', () => {
    const chat = makeChat() as any
    delete chat['~registerStatusCallback']
    const session = createSession('s1', makeTransport(), () => chat, undefined, undefined, vi.fn())
    expect(session.unsubscribers).toHaveLength(0)
  })

  it('calls onStatusChange when the status callback fires', () => {
    let capturedCallback: (() => void) | undefined
    const chat = makeChat() as any
    chat['~registerStatusCallback'] = vi.fn().mockImplementation((cb: () => void) => {
      capturedCallback = cb
      return vi.fn()
    })
    const onStatusChange = vi.fn()
    createSession('s1', makeTransport(), () => chat, undefined, undefined, onStatusChange)
    capturedCallback?.()
    expect(onStatusChange).toHaveBeenCalledWith('s1', 'idle')
  })

  it('uses existingData when provided', () => {
    const existingData = createSessionData()
    existingData.tools.push({ toolName: 'existing' } as any)
    const session = createSession('s1', makeTransport(), () => makeChat() as any, undefined, existingData, vi.fn())
    expect(session.data).toBe(existingData)
  })

  it('creates new session data when existingData is undefined', () => {
    const session = createSession('s1', makeTransport(), () => makeChat() as any, undefined, undefined, vi.fn())
    expect(session.data.tools).toEqual([])
    expect(session.data.idMap).toBeInstanceOf(Map)
  })
})

// ─── applyStatusUpdate ───────────────────────────────────────────────────────

describe('applyStatusUpdate', () => {
  it('returns null when status and isStreaming are unchanged', () => {
    const session = makeSession({ status: 'idle', isStreaming: false })
    expect(applyStatusUpdate(session, 'idle')).toBeNull()
  })

  it('returns updated session when status changes', () => {
    const session = makeSession({ status: 'idle', isStreaming: false })
    const updated = applyStatusUpdate(session, 'streaming')
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('streaming')
    expect(updated!.isStreaming).toBe(true)
  })

  it('returns updated session when transitioning to submitted', () => {
    const session = makeSession({ status: 'idle', isStreaming: false })
    const updated = applyStatusUpdate(session, 'submitted')
    expect(updated!.isStreaming).toBe(true)
  })

  it('returns updated session when streaming stops', () => {
    const session = makeSession({ status: 'streaming', isStreaming: true })
    const updated = applyStatusUpdate(session, 'idle')
    expect(updated!.status).toBe('idle')
    expect(updated!.isStreaming).toBe(false)
  })

  it('does not mutate the original session', () => {
    const session = makeSession({ status: 'idle', isStreaming: false })
    const updated = applyStatusUpdate(session, 'streaming')
    expect(session.status).toBe('idle')
    expect(session).not.toBe(updated)
  })
})

// ─── destroySession ───────────────────────────────────────────────────────────

describe('destroySession', () => {
  it('calls all unsubscribers', () => {
    const unsub1 = vi.fn()
    const unsub2 = vi.fn()
    destroySession(makeSession({ unsubscribers: [unsub1, unsub2] }))
    expect(unsub1).toHaveBeenCalled()
    expect(unsub2).toHaveBeenCalled()
  })

  it('calls chat.stop()', () => {
    const chat = makeChat()
    destroySession(makeSession({ chat: chat as any }))
    expect(chat.stop).toHaveBeenCalled()
  })

  it('does not throw when an unsubscriber throws', () => {
    const badUnsub = vi.fn().mockImplementation(() => { throw new Error('unsub error') })
    expect(() => destroySession(makeSession({ unsubscribers: [badUnsub] }))).not.toThrow()
  })

  it('does not throw when chat.stop() throws', () => {
    const chat = makeChat()
    chat.stop = vi.fn().mockImplementation(() => { throw new Error('stop error') })
    expect(() => destroySession(makeSession({ chat: chat as any }))).not.toThrow()
  })

  it('continues calling remaining unsubscribers after one throws', () => {
    const badUnsub = vi.fn().mockImplementation(() => { throw new Error('fail') })
    const goodUnsub = vi.fn()
    destroySession(makeSession({ unsubscribers: [badUnsub, goodUnsub] }))
    expect(goodUnsub).toHaveBeenCalled()
  })
})
