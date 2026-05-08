import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'
import { useThreadLocalKnowledge } from '../use-thread-local-knowledge'

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

    let knowledge = 'initial'
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge('test query')
    })

    expect(knowledge).toBe('')
  })

  it('prepareLocalKnowledge does not inject local knowledge context when enabled', async () => {
    useLocalKnowledge.setState({
      localKnowledgeEnabled: true,
      localKnowledgeEnabledPerThread: { 'thread-1': true },
    })

    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))

    let knowledge = 'initial'
    await act(async () => {
      knowledge = await result.current.prepareLocalKnowledge('What real-world hiring outcome did the author achieve?')
    })

    expect(knowledge).toBe('')
  })

  it('returns prepareLocalKnowledge as a function', () => {
    const { result } = renderHook(() => useThreadLocalKnowledge(threadId))
    expect(typeof result.current.prepareLocalKnowledge).toBe('function')
  })
})
