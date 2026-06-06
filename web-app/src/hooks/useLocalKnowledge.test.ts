import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useLocalKnowledge } from './useLocalKnowledge'

describe('useLocalKnowledge', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    act(() => {
      useLocalKnowledge.setState({
        localKnowledgeEnabled: false,
        localKnowledgeEnabledPerThread: {},
      })
    })
  })

  // --- PHASE 1: Default state ---

  it('should initialize with local knowledge disabled', () => {
    const state = useLocalKnowledge.getState()
    expect(state.localKnowledgeEnabled).toBe(false)
  })

  it('should initialize with empty per-thread map', () => {
    const state = useLocalKnowledge.getState()
    expect(state.localKnowledgeEnabledPerThread).toEqual({})
  })

  // --- toggleLocalKnowledge ---

  it('should toggle global local knowledge from false to true', () => {
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledge()
    })
    expect(useLocalKnowledge.getState().localKnowledgeEnabled).toBe(true)
  })

  it('should toggle global local knowledge from true to false', () => {
    act(() => {
      useLocalKnowledge.setState({ localKnowledgeEnabled: true })
    })
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledge()
    })
    expect(useLocalKnowledge.getState().localKnowledgeEnabled).toBe(false)
  })

  it('should toggle global back and forth consistently', () => {
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledge()
    })
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledge()
    })
    expect(useLocalKnowledge.getState().localKnowledgeEnabled).toBe(false)
  })

  // --- isLocalKnowledgeEnabledForThread ---

  it('should fall back to global setting when thread has no override', () => {
    const result =
      useLocalKnowledge.getState().isLocalKnowledgeEnabledForThread('thread-1')
    expect(result).toBe(false)
  })

  it('should fall back to global=true when thread has no override', () => {
    act(() => {
      useLocalKnowledge.setState({ localKnowledgeEnabled: true })
    })
    const result =
      useLocalKnowledge.getState().isLocalKnowledgeEnabledForThread('thread-1')
    expect(result).toBe(true)
  })

  it('should return thread-specific override when set', () => {
    act(() => {
      useLocalKnowledge.setState({
        localKnowledgeEnabledPerThread: { 'thread-1': true },
      })
    })
    const result =
      useLocalKnowledge.getState().isLocalKnowledgeEnabledForThread('thread-1')
    expect(result).toBe(true)
  })

  it('should return thread override even when it equals false explicitly', () => {
    act(() => {
      useLocalKnowledge.setState({
        localKnowledgeEnabled: true,
        localKnowledgeEnabledPerThread: { 'thread-1': false },
      })
    })
    const result =
      useLocalKnowledge.getState().isLocalKnowledgeEnabledForThread('thread-1')
    expect(result).toBe(false)
  })

  // --- toggleLocalKnowledgeForThread ---

  it('should toggle thread from global default false to true', () => {
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledgeForThread('thread-1')
    })
    expect(
      useLocalKnowledge.getState().localKnowledgeEnabledPerThread['thread-1']
    ).toBe(true)
  })

  it('should toggle thread from global default true to false', () => {
    act(() => {
      useLocalKnowledge.setState({ localKnowledgeEnabled: true })
    })
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledgeForThread('thread-1')
    })
    expect(
      useLocalKnowledge.getState().localKnowledgeEnabledPerThread['thread-1']
    ).toBe(false)
  })

  it('should toggle existing thread override from true to false', () => {
    act(() => {
      useLocalKnowledge.setState({
        localKnowledgeEnabledPerThread: { 'thread-1': true },
      })
    })
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledgeForThread('thread-1')
    })
    expect(
      useLocalKnowledge.getState().localKnowledgeEnabledPerThread['thread-1']
    ).toBe(false)
  })

  // --- Per-thread isolation ---

  it('should not affect other threads when toggling one thread', () => {
    act(() => {
      useLocalKnowledge.setState({
        localKnowledgeEnabledPerThread: { 'thread-2': true },
      })
    })
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledgeForThread('thread-1')
    })
    expect(
      useLocalKnowledge.getState().localKnowledgeEnabledPerThread['thread-2']
    ).toBe(true)
    expect(
      useLocalKnowledge.getState().localKnowledgeEnabledPerThread['thread-1']
    ).toBe(true)
  })

  it('should not affect global setting when toggling a thread', () => {
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledgeForThread('thread-1')
    })
    expect(useLocalKnowledge.getState().localKnowledgeEnabled).toBe(false)
  })

  // --- Adversarial: empty string threadId ---

  it('should handle empty string threadId', () => {
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledgeForThread('')
    })
    expect(
      useLocalKnowledge.getState().localKnowledgeEnabledPerThread['']
    ).toBe(true)
    expect(
      useLocalKnowledge.getState().isLocalKnowledgeEnabledForThread('')
    ).toBe(true)
  })

  // --- Property: toggle is always idempotent (double toggle = identity) ---

  it('should return to original state after double toggle for thread', () => {
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledgeForThread('thread-1')
    })
    act(() => {
      useLocalKnowledge.getState().toggleLocalKnowledgeForThread('thread-1')
    })
    // After two toggles from global default false, thread override is false
    expect(
      useLocalKnowledge.getState().isLocalKnowledgeEnabledForThread('thread-1')
    ).toBe(false)
  })
})
