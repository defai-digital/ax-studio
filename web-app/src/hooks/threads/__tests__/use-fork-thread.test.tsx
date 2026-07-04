import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useForkThread } from '@/hooks/threads/use-fork-thread'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

vi.mock('ulidx', () => {
  let n = 0
  return { ulid: () => `new-id-${++n}` }
})

const createThread = vi.fn()
const updateThread = vi.fn()
const addMessage = vi.fn()

const threadsState = {
  threads: {} as Record<string, unknown>,
  createThread,
  updateThread,
}
const messagesState = {
  getMessages: vi.fn(),
  addMessage,
}

vi.mock('@/hooks/threads/useThreads', () => {
  const useThreads = (selector: (s: typeof threadsState) => unknown) =>
    selector(threadsState)
  useThreads.getState = () => threadsState
  return { useThreads }
})

vi.mock('@/hooks/chat/useMessages', () => {
  const useMessages = (selector: (s: typeof messagesState) => unknown) =>
    selector(messagesState)
  useMessages.getState = () => messagesState
  return { useMessages }
})

// ─── Fixtures ──────────────────────────────────────────────────────────────

const sourceThread = {
  id: 'src',
  title: 'Original chat',
  model: { provider: 'openai', id: 'gpt-4o' },
  assistants: [{ id: 'a1', name: 'Helper' }],
  metadata: {},
}

const sourceMessages = [
  { id: 'm1', thread_id: 'src', role: 'user', content: [], created_at: 1 },
  { id: 'm2', thread_id: 'src', role: 'assistant', content: [], created_at: 2 },
  { id: 'm3', thread_id: 'src', role: 'user', content: [], created_at: 3 },
  { id: 'm4', thread_id: 'src', role: 'assistant', content: [], created_at: 4 },
]

beforeEach(() => {
  vi.clearAllMocks()
  threadsState.threads = { src: sourceThread }
  messagesState.getMessages.mockReturnValue(sourceMessages)
  createThread.mockResolvedValue({ id: 'forked', metadata: {} })
})

describe('useForkThread', () => {
  it('creates a new thread with the source model, title and assistant', async () => {
    const { result } = renderHook(() => useForkThread())
    await result.current('src', 'm2')

    expect(createThread).toHaveBeenCalledWith(
      sourceThread.model,
      'Original chat',
      sourceThread.assistants[0]
    )
  })

  it('copies messages up to and including the fork point, with new ids + thread_id', async () => {
    const { result } = renderHook(() => useForkThread())
    await result.current('src', 'm2')

    // m1 and m2 only (through the clicked message)
    expect(addMessage).toHaveBeenCalledTimes(2)
    const copies = addMessage.mock.calls.map((c) => c[0])
    expect(copies.map((m) => m.thread_id)).toEqual(['forked', 'forked'])
    // fresh, unique ids that differ from the originals
    const ids = copies.map((m) => m.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain('m1')
    expect(ids).not.toContain('m2')
    // original created_at preserved for ordering
    expect(copies.map((m) => m.created_at)).toEqual([1, 2])
    // original messages are untouched
    expect(sourceMessages[0].id).toBe('m1')
  })

  it('stamps fork provenance so the BranchBanner renders', async () => {
    const { result } = renderHook(() => useForkThread())
    await result.current('src', 'm4')

    expect(updateThread).toHaveBeenCalledWith('forked', {
      metadata: {
        forkedFrom: 'Original chat',
        parentThreadId: 'src',
      },
    })
    // all four messages copied when forking from the last message
    expect(addMessage).toHaveBeenCalledTimes(4)
  })

  it('navigates to the forked thread', async () => {
    const { result } = renderHook(() => useForkThread())
    await result.current('src', 'm2')

    expect(navigate).toHaveBeenCalledWith({
      to: '/threads/$threadId',
      params: { threadId: 'forked' },
    })
  })

  it('is a no-op when the message id is not found', async () => {
    const { result } = renderHook(() => useForkThread())
    const returned = await result.current('src', 'does-not-exist')

    expect(returned).toBeUndefined()
    expect(createThread).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('is a no-op when the source thread has no model', async () => {
    threadsState.threads = { src: { ...sourceThread, model: undefined } }
    const { result } = renderHook(() => useForkThread())
    const returned = await result.current('src', 'm2')

    expect(returned).toBeUndefined()
    expect(createThread).not.toHaveBeenCalled()
  })
})
