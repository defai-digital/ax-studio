import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'
import { useThreadLocalKnowledge } from '../use-thread-local-knowledge'

const mockServiceHub = vi.hoisted(() => ({
  callTool: vi.fn(),
}))

const searchResult = (results: Array<Record<string, unknown>>) => ({
  error: '',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        layer: 'raw',
        results,
      }),
    },
  ],
})

const extractResult = (text: string) => ({
  error: '',
  content: [
    {
      type: 'text',
      text: JSON.stringify({ text }),
    },
  ],
})

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
      .mockResolvedValueOnce(searchResult([
        {
          chunkId: 'chunk-1',
          score: 1,
          source: '/Users/devop/Documents/akidb-testing/coding-interview-university.md',
          content:
            'After going through this study plan, I got hired as a Software Development Engineer at Amazon.',
        },
      ]))
      .mockResolvedValueOnce(extractResult(
        'After going through this study plan, I got hired as a Software Development Engineer at Amazon.',
      ))

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

  it('uses expanded keyword fallback queries when semantic search misses', async () => {
    useLocalKnowledge.setState({
      localKnowledgeEnabled: true,
      localKnowledgeEnabledPerThread: { 'thread-1': true },
    })

    mockServiceHub.callTool.mockImplementation(async ({ toolName, arguments: args }) => {
      if (toolName === 'fabric_extract') {
        return extractResult('Array types can be written as number[] or Array<number>.')
      }

      if (args.query === 'array TypeScript') {
        return searchResult([
          {
            chunkId: 'chunk-1',
            score: 1,
            source: '/Users/devop/Documents/akidb-testing/typescript-basics.md',
            content: 'Array types can be written in one of two ways.',
          },
        ])
      }

      return searchResult([])
    })

    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))

    let knowledge: Awaited<ReturnType<typeof result.current.prepareLocalKnowledge>> = { context: '' }
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge(
        'What are the two syntaxes for declaring an array of numbers in TypeScript?'
      )
    })

    expect(mockServiceHub.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'fabric_search',
        arguments: expect.objectContaining({
          query: 'array TypeScript',
          mode: 'keyword',
          layer: 'raw',
        }),
      })
    )
    expect(knowledge.context).toContain('number[] or Array<number>')
    expect(knowledge.retrieval).toMatchObject({
      searched: true,
      extracted: true,
      source: '/Users/devop/Documents/akidb-testing/typescript-basics.md',
    })
  })

  it('retries recoverable MCP transport errors before giving up', async () => {
    useLocalKnowledge.setState({
      localKnowledgeEnabled: true,
      localKnowledgeEnabledPerThread: { 'thread-1': true },
    })

    mockServiceHub.callTool
      .mockResolvedValueOnce({ error: 'Transport closed', content: [] })
      .mockResolvedValueOnce(searchResult([
        {
          chunkId: 'chunk-1',
          score: 1,
          source: '/Users/devop/Documents/akidb-testing/system-design-primer.md',
          content: 'Learn how to design large-scale systems.',
        },
      ]))
      .mockResolvedValueOnce(extractResult('Learn how to design large-scale systems.'))

    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))

    let knowledge: Awaited<ReturnType<typeof result.current.prepareLocalKnowledge>> = { context: '' }
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge(
        'What is the stated motivation of the System Design Primer repository?'
      )
    })

    expect(mockServiceHub.callTool).toHaveBeenCalledTimes(3)
    expect(knowledge.context).toContain('Learn how to design large-scale systems.')
    expect(knowledge.retrieval).toMatchObject({
      searched: true,
      extracted: true,
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
