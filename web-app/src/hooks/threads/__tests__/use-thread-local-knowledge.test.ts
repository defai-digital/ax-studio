import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'
import { useThreadLocalKnowledge } from '../use-thread-local-knowledge'

const mockServiceHub = vi.hoisted(() => ({
  callTool: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    mcp: () => ({
      callTool: mockServiceHub.callTool,
    }),
  }),
}))

describe('useThreadLocalKnowledge', () => {
  const threadId = 'thread-1'

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('prepareLocalKnowledge returns empty context when disabled', async () => {
    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))

    let knowledge: { context: string } = { context: 'initial' }
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge('test query')
    })

    expect(knowledge).toEqual({ context: '' })
    expect(mockServiceHub.callTool).not.toHaveBeenCalled()
  })

  it('searches and extracts local knowledge when enabled', async () => {
    useLocalKnowledge.setState({
      localKnowledgeEnabled: true,
      localKnowledgeEnabledPerThread: { 'thread-1': true },
    })

    mockServiceHub.callTool
      .mockResolvedValueOnce({
        error: '',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              layer: 'raw',
              results: [
                {
                  chunkId: 'chunk-1',
                  score: 1,
                  source: '/Users/devop/Documents/akidb-testing/coding-interview-university.md',
                  content:
                    'After going through this study plan, I got hired as a Software Development Engineer at Amazon.',
                },
              ],
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        error: '',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              text: 'After going through this study plan, I got hired as a Software Development Engineer at Amazon.',
            }),
          },
        ],
      })

    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))

    let knowledge: Awaited<ReturnType<typeof result.current.prepareLocalKnowledge>> = { context: '' }
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge('What real-world hiring outcome did the author achieve?')
    })

    expect(mockServiceHub.callTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        toolName: 'fabric_search',
        arguments: expect.objectContaining({
          mode: 'hybrid',
          top_k: 5,
        }),
      })
    )
    expect(mockServiceHub.callTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        toolName: 'fabric_extract',
        arguments: expect.objectContaining({
          file_path: '/Users/devop/Documents/akidb-testing/coding-interview-university.md',
        }),
      })
    )
    expect(knowledge.context).toContain('Local Knowledge Base')
    expect(knowledge.context).toContain('Software Development Engineer at Amazon')
    expect(knowledge.retrieval).toMatchObject({
      searched: true,
      extracted: true,
      source: '/Users/devop/Documents/akidb-testing/coding-interview-university.md',
    })
  })

  it('skips search for local-knowledge meta questions', async () => {
    useLocalKnowledge.setState({
      localKnowledgeEnabled: true,
      localKnowledgeEnabledPerThread: { 'thread-1': true },
    })

    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))

    let knowledge: { context: string } = { context: 'initial' }
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge('Is this answer from local knowledge?')
    })

    expect(knowledge).toEqual({ context: '' })
    expect(mockServiceHub.callTool).not.toHaveBeenCalled()
  })

  it('returns prepareLocalKnowledge as a function', () => {
    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))
    expect(typeof result.current.prepareLocalKnowledge).toBe('function')
  })
})
