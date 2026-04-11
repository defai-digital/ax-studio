import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useArtifactPanel } from '@/hooks/ui/useArtifactPanel'
import { useThreadArtifacts } from '../use-thread-artifacts'

describe('useThreadArtifacts', () => {
  beforeEach(() => {
    act(() => {
      useArtifactPanel.setState({
        pinnedByThread: {},
        historyByThread: {},
      })
    })
  })

  it('returns null pinnedArtifact when nothing is pinned', () => {
    const { result } = renderHook(() => useThreadArtifacts('thread-1'))
    expect(result.current.pinnedArtifact).toBeNull()
  })

  it('returns the pinned artifact for the given thread', () => {
    act(() => {
      useArtifactPanel.getState().pinArtifact('thread-1', 'html', '<p>test</p>')
    })

    const { result } = renderHook(() => useThreadArtifacts('thread-1'))
    expect(result.current.pinnedArtifact).not.toBeNull()
    expect(result.current.pinnedArtifact!.type).toBe('html')
    expect(result.current.pinnedArtifact!.source).toBe('<p>test</p>')
  })

  it('does not return artifacts from other threads', () => {
    act(() => {
      useArtifactPanel.getState().pinArtifact('thread-2', 'svg', '<svg/>')
    })

    const { result } = renderHook(() => useThreadArtifacts('thread-1'))
    expect(result.current.pinnedArtifact).toBeNull()
  })

  it('clearArtifact removes the pinned artifact for a thread', () => {
    act(() => {
      useArtifactPanel.getState().pinArtifact('thread-1', 'html', 'src')
    })

    const { result } = renderHook(() => useThreadArtifacts('thread-1'))
    expect(result.current.pinnedArtifact).not.toBeNull()

    act(() => {
      result.current.clearArtifact('thread-1')
    })

    expect(result.current.pinnedArtifact).toBeNull()
  })

  it('clearArtifact is a function', () => {
    const { result } = renderHook(() => useThreadArtifacts('thread-1'))
    expect(typeof result.current.clearArtifact).toBe('function')
  })
})
