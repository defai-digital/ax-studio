import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentType, MessageStatus, type ThreadMessage } from '@ax-studio/core'

const mocks = vi.hoisted(() => ({
  fetchMessages: vi.fn(),
  cachedMessages: {} as Record<string, ThreadMessage[] | undefined>,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    messages: () => ({ fetchMessages: mocks.fetchMessages }),
  }),
}))

vi.mock('@/hooks/chat/useMessages', () => ({
  useMessages: {
    getState: () => ({ messages: mocks.cachedMessages }),
  },
}))

import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import {
  ensureMessageSearchIndex,
  getMessageSearchContent,
  getMessageSearchIndexSnapshot,
  resetMessageSearchIndex,
  subscribeMessageSearchIndex,
} from '../message-search-index'

const TEMPORARY = TEMPORARY_CHAT_ID

const textMessage = (threadId: string, text: string): ThreadMessage => ({
  id: `msg-${threadId}-${text}`,
  thread_id: threadId,
  role: 'user',
  content: [{ type: ContentType.Text, text: { value: text, annotations: [] } }],
  status: MessageStatus.Ready,
  created_at: 1,
  completed_at: 1,
})

const makeThreads = (count: number, updated = 100): Record<string, Thread> => {
  const threads: Record<string, Thread> = {}
  for (let i = 1; i <= count; i += 1) {
    threads[`thread-${i}`] = {
      id: `thread-${i}`,
      title: `Thread ${i}`,
      updated,
      metadata: {},
    }
  }
  return threads
}

describe('message-search-index', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.fetchMessages.mockReset()
    mocks.fetchMessages.mockImplementation((threadId: string) =>
      Promise.resolve([textMessage(threadId, `hello from ${threadId}`)])
    )
    mocks.cachedMessages = {}
    resetMessageSearchIndex()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds one concatenated text document per non-temporary thread', async () => {
    const threads = makeThreads(3)
    threads[TEMPORARY] = {
      id: TEMPORARY,
      title: 'Temporary',
      updated: 999,
      metadata: {},
    }
    mocks.fetchMessages.mockImplementation((threadId: string) =>
      Promise.resolve([
        {
          ...textMessage(threadId, 'first part'),
          content: [
            {
              type: ContentType.Reasoning,
              text: { value: 'skip reasoning', annotations: [] },
            },
            {
              type: ContentType.Text,
              text: { value: 'first part', annotations: [] },
            },
            {
              type: ContentType.Text,
              text: { value: 'second part', annotations: [] },
            },
          ],
        },
      ])
    )

    const promise = ensureMessageSearchIndex(threads)
    await vi.runAllTimersAsync()
    await promise

    expect(getMessageSearchContent('thread-1')).toBe('first part\nsecond part')
    expect(mocks.fetchMessages).not.toHaveBeenCalledWith(TEMPORARY)
    expect(getMessageSearchContent(TEMPORARY)).toBeUndefined()
    expect(getMessageSearchIndexSnapshot().status).toBe('ready')
  })

  it('reuses messages cached in useMessages instead of refetching', async () => {
    mocks.cachedMessages = {
      'thread-1': [textMessage('thread-1', 'cached content')],
    }
    const threads = makeThreads(2)

    const promise = ensureMessageSearchIndex(threads)
    await vi.runAllTimersAsync()
    await promise

    expect(mocks.fetchMessages).toHaveBeenCalledTimes(1)
    expect(mocks.fetchMessages).toHaveBeenCalledWith('thread-2')
    expect(getMessageSearchContent('thread-1')).toBe('cached content')
  })

  it('fetches in batches of 10 and yields between batches', async () => {
    const threads = makeThreads(25)

    const promise = ensureMessageSearchIndex(threads)
    // First batch is kicked off synchronously, then the build parks on a
    // setTimeout(0) yield before touching the next batch.
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(10)

    await Promise.resolve()
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(10)

    await vi.runAllTimersAsync()
    await promise

    expect(mocks.fetchMessages).toHaveBeenCalledTimes(25)
    expect(getMessageSearchIndexSnapshot().documents.size).toBe(25)
  })

  it('skips rebuilding while the fingerprint is unchanged', async () => {
    const threads = makeThreads(2)

    let promise = ensureMessageSearchIndex(threads)
    await vi.runAllTimersAsync()
    await promise
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(2)

    promise = ensureMessageSearchIndex(threads)
    await vi.runAllTimersAsync()
    await promise
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(2)
  })

  it('rebuilds when the fingerprint changes (thread added or bumped)', async () => {
    const threads = makeThreads(2)

    let promise = ensureMessageSearchIndex(threads)
    await vi.runAllTimersAsync()
    await promise

    const bumped = {
      ...threads,
      'thread-1': { ...threads['thread-1'], updated: 500 },
    }
    promise = ensureMessageSearchIndex(bumped)
    await vi.runAllTimersAsync()
    await promise
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(4)

    const added = { ...threads, ...makeThreads(3, 100) }
    promise = ensureMessageSearchIndex(added)
    await vi.runAllTimersAsync()
    await promise
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(7)
  })

  it('rebuilds when a non-maximum thread changes or a thread is replaced', async () => {
    const threads = makeThreads(2)
    threads['thread-2'] = { ...threads['thread-2'], updated: 500 }

    let promise = ensureMessageSearchIndex(threads)
    await vi.runAllTimersAsync()
    await promise
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(2)

    const bumpedBelowMaximum = {
      ...threads,
      'thread-1': { ...threads['thread-1'], updated: 200 },
    }
    promise = ensureMessageSearchIndex(bumpedBelowMaximum)
    await vi.runAllTimersAsync()
    await promise
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(4)

    const { 'thread-1': _removed, ...withoutThreadOne } = bumpedBelowMaximum
    const replaced = {
      ...withoutThreadOne,
      replacement: {
        id: 'replacement',
        title: 'Replacement',
        updated: 200,
        metadata: {},
      },
    }
    promise = ensureMessageSearchIndex(replaced)
    await vi.runAllTimersAsync()
    await promise
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(6)
    expect(getMessageSearchContent('thread-1')).toBeUndefined()
    expect(getMessageSearchContent('replacement')).toBe(
      'hello from replacement'
    )
  })

  it('queues a rebuild requested while another build is in flight', async () => {
    const threads = makeThreads(11)

    const promise = ensureMessageSearchIndex(threads)
    expect(getMessageSearchIndexSnapshot().status).toBe('indexing')

    const changed = {
      ...threads,
      'thread-1': { ...threads['thread-1'], updated: 777 },
    }
    mocks.fetchMessages.mockClear()
    mocks.fetchMessages.mockImplementation((threadId: string) =>
      Promise.resolve([textMessage(threadId, `v2 ${threadId}`)])
    )
    await ensureMessageSearchIndex(changed)

    await vi.runAllTimersAsync()
    await promise

    // The superseded build is discarded and the queued build runs instead.
    expect(getMessageSearchContent('thread-1')).toBe('v2 thread-1')
    expect(getMessageSearchIndexSnapshot().status).toBe('ready')
  })

  it('degrades silently to title-only for threads whose fetch fails', async () => {
    const threads = makeThreads(3)
    mocks.fetchMessages.mockImplementation((threadId: string) =>
      threadId === 'thread-2'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve([textMessage(threadId, `ok ${threadId}`)])
    )

    const promise = ensureMessageSearchIndex(threads)
    await vi.runAllTimersAsync()
    await promise

    const snapshot = getMessageSearchIndexSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.documents.get('thread-1')).toBe('ok thread-1')
    expect(snapshot.documents.get('thread-2')).toBeUndefined()
    expect(snapshot.documents.get('thread-3')).toBe('ok thread-3')
  })

  it('publishes immutable snapshots to subscribers on transitions', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMessageSearchIndex(listener)

    const before = getMessageSearchIndexSnapshot()
    const promise = ensureMessageSearchIndex(makeThreads(1))
    expect(getMessageSearchIndexSnapshot().status).toBe('indexing')

    await vi.runAllTimersAsync()
    await promise

    const after = getMessageSearchIndexSnapshot()
    expect(after.status).toBe('ready')
    expect(after).not.toBe(before)
    expect(after.version).toBe(before.version + 1)
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2)

    unsubscribe()
    listener.mockClear()
    resetMessageSearchIndex()
    expect(listener).not.toHaveBeenCalled()
  })
})
