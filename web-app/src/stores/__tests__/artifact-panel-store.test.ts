import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useArtifactPanel } from '../artifact-panel-store'

describe('artifact-panel-store', () => {
  beforeEach(() => {
    useArtifactPanel.setState({ panels: {} })
  })

  it('starts with no panels', () => {
    expect(useArtifactPanel.getState().panels).toEqual({})
  })

  it('openPanel opens a panel and sets the active artifact', () => {
    act(() => {
      useArtifactPanel.getState().openPanel('t1', 'm1:0')
    })
    expect(useArtifactPanel.getState().panels['t1']).toEqual({
      open: true,
      activeArtifactId: 'm1:0',
    })
  })

  it('openPanel without an artifact id keeps the previous active artifact', () => {
    act(() => {
      useArtifactPanel.getState().openPanel('t1', 'm1:0')
      useArtifactPanel.getState().closePanel('t1')
      useArtifactPanel.getState().openPanel('t1')
    })
    expect(useArtifactPanel.getState().panels['t1']).toEqual({
      open: true,
      activeArtifactId: 'm1:0',
    })
  })

  it('openPanel without an artifact id and no prior entry leaves active unset', () => {
    act(() => {
      useArtifactPanel.getState().openPanel('t1')
    })
    expect(useArtifactPanel.getState().panels['t1']).toEqual({ open: true })
  })

  it('closePanel closes but preserves the active artifact for the session', () => {
    act(() => {
      useArtifactPanel.getState().openPanel('t1', 'm1:0')
      useArtifactPanel.getState().closePanel('t1')
    })
    expect(useArtifactPanel.getState().panels['t1']).toEqual({
      open: false,
      activeArtifactId: 'm1:0',
    })
  })

  it('closePanel on an unknown thread is a no-op', () => {
    const before = useArtifactPanel.getState().panels
    act(() => {
      useArtifactPanel.getState().closePanel('missing')
    })
    expect(useArtifactPanel.getState().panels).toBe(before)
  })

  it('setActive switches the active artifact of an open panel', () => {
    act(() => {
      useArtifactPanel.getState().openPanel('t1', 'm1:0')
      useArtifactPanel.getState().setActive('t1', 'm1:1')
    })
    expect(useArtifactPanel.getState().panels['t1']).toEqual({
      open: true,
      activeArtifactId: 'm1:1',
    })
  })

  it('setActive on an unknown thread creates an open entry', () => {
    act(() => {
      useArtifactPanel.getState().setActive('t2', 'm9:0')
    })
    expect(useArtifactPanel.getState().panels['t2']).toEqual({
      open: true,
      activeArtifactId: 'm9:0',
    })
  })

  it('setActive does not reopen a closed panel', () => {
    act(() => {
      useArtifactPanel.getState().openPanel('t1', 'm1:0')
      useArtifactPanel.getState().closePanel('t1')
      useArtifactPanel.getState().setActive('t1', 'm1:2')
    })
    expect(useArtifactPanel.getState().panels['t1']).toEqual({
      open: false,
      activeArtifactId: 'm1:2',
    })
  })

  it('keeps panels isolated per threadId (split view)', () => {
    act(() => {
      useArtifactPanel.getState().openPanel('t1', 'm1:0')
      useArtifactPanel.getState().openPanel('t2', 'm2:3')
      useArtifactPanel.getState().closePanel('t1')
    })
    const { panels } = useArtifactPanel.getState()
    expect(panels['t1']).toEqual({ open: false, activeArtifactId: 'm1:0' })
    expect(panels['t2']).toEqual({ open: true, activeArtifactId: 'm2:3' })
  })

  it('is session-only (no persisted storage)', () => {
    expect((useArtifactPanel as { persist?: unknown }).persist).toBeUndefined()
  })
})
