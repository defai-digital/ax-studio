import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalKnowledge } from '@/hooks/useLocalKnowledge'
import { useThreadLocalKnowledge } from '../use-thread-local-knowledge'

vi.mock('zustand/middleware', async () => {
  const actual = await vi.importActual('zustand/middleware')
  return {
    ...actual,
    persist: (fn: (...args: unknown[]) => unknown) => fn,
    createJSONStorage: () => ({
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }),
  }
})

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    localKnowledgeStore: 'local-knowledge-store',
  },
}))

describe('useThreadLocalKnowledge', () => {
  const threadId = 'thread-1'

  beforeEach(() => {
    useLocalKnowledge.setState({
      localKnowledgeEnabled: false,
      localKnowledgeEnabledPerThread: {},
    })
  })

  it('returns isEnabled as false when local knowledge is disabled globally', () => {
    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))
    expect(result.current.isEnabled).toBe(false)
  })

  it('returns isEnabled as true when local knowledge is enabled globally', () => {
    useLocalKnowledge.setState({ localKnowledgeEnabled: true })
    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))
    expect(result.current.isEnabled).toBe(true)
  })

  it('respects per-thread override when set', () => {
    useLocalKnowledge.setState({
      localKnowledgeEnabled: false,
      localKnowledgeEnabledPerThread: { 'thread-1': true },
    })
    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))
    expect(result.current.isEnabled).toBe(true)
  })

  it('prepareLocalKnowledge returns empty string when disabled', async () => {
    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))

    let knowledge = ''
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge('test query')
    })

    expect(knowledge).toBe('')
  })

  it('prepareLocalKnowledge returns context string when enabled and results found', async () => {
    useLocalKnowledge.setState({
      localKnowledgeEnabled: true,
      localKnowledgeEnabledPerThread: { 'thread-1': true },
    })

    // The serviceHub.mcp().callTool is already mocked in setup.ts
    // to return { error: '', content: [] }
    // We need to mock it to return actual content for this test
    const { useServiceHub } = await import('@/hooks/useServiceHub')
    const hub = useServiceHub()
    const callToolMock = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Relevant knowledge about the query' }],
    })
    vi.spyOn(hub, 'mcp').mockReturnValue({
      ...hub.mcp(),
      callTool: callToolMock,
    })

    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))

    let knowledge = ''
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge('test query')
    })

    expect(knowledge).toContain('Local Knowledge Mode (ACTIVE)')
    expect(knowledge).toContain('Relevant knowledge about the query')
    expect(callToolMock).toHaveBeenCalledWith({
      toolName: 'fabric_search',
      arguments: { query: 'test query' },
    })
  })

  it('prepareLocalKnowledge returns empty string when callTool returns error', async () => {
    useLocalKnowledge.setState({
      localKnowledgeEnabled: true,
      localKnowledgeEnabledPerThread: { 'thread-1': true },
    })

    const { useServiceHub } = await import('@/hooks/useServiceHub')
    const hub = useServiceHub()
    vi.spyOn(hub, 'mcp').mockReturnValue({
      ...hub.mcp(),
      callTool: vi.fn().mockResolvedValue({ error: 'Not found' }),
    })

    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))

    let knowledge = ''
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge('test query')
    })

    expect(knowledge).toBe('')
  })

  it('prepareLocalKnowledge returns empty string when callTool throws', async () => {
    useLocalKnowledge.setState({
      localKnowledgeEnabled: true,
      localKnowledgeEnabledPerThread: { 'thread-1': true },
    })

    const { useServiceHub } = await import('@/hooks/useServiceHub')
    const hub = useServiceHub()
    vi.spyOn(hub, 'mcp').mockReturnValue({
      ...hub.mcp(),
      callTool: vi.fn().mockRejectedValue(new Error('Connection failed')),
    })

    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))

    let knowledge = ''
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge('test query')
    })

    expect(knowledge).toBe('')
  })

  it('returns prepareLocalKnowledge as a function', () => {
    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))
    expect(typeof result.current.prepareLocalKnowledge).toBe('function')
  })
})
