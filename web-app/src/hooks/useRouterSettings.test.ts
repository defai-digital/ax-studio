import { describe, it, expect, beforeEach } from 'vitest'
import { useRouterSettings } from './useRouterSettings'

describe('useRouterSettings', () => {
  beforeEach(() => {
    useRouterSettings.getState().resetToDefaults()
  })

  it('has correct defaults', () => {
    const state = useRouterSettings.getState()
    expect(state.enabled).toBe(false)
    expect(state.routerModelId).toBeNull()
    expect(state.routerProviderId).toBeNull()
    expect(state.timeout).toBe(15000)
    expect(state.threadOverrides).toEqual({})
  })

  it('sets enabled state', () => {
    useRouterSettings.getState().setEnabled(true)
    expect(useRouterSettings.getState().enabled).toBe(true)
  })

  it('sets router model', () => {
    useRouterSettings.getState().setRouterModel('gpt-4o-mini', 'openai')
    const state = useRouterSettings.getState()
    expect(state.routerModelId).toBe('gpt-4o-mini')
    expect(state.routerProviderId).toBe('openai')
  })

  it('clears router model', () => {
    useRouterSettings.getState().setRouterModel('gpt-4o-mini', 'openai')
    useRouterSettings.getState().clearRouterModel()
    const state = useRouterSettings.getState()
    expect(state.routerModelId).toBeNull()
    expect(state.routerProviderId).toBeNull()
  })

  it('clamps timeout to valid range', () => {
    useRouterSettings.getState().setTimeoutMs(100)
    expect(useRouterSettings.getState().timeout).toBe(500) // min 500

    useRouterSettings.getState().setTimeoutMs(99999)
    expect(useRouterSettings.getState().timeout).toBe(30000) // max 30000
  })

  it('sets and clears thread overrides', () => {
    useRouterSettings.getState().setThreadOverride('thread-1', true)
    expect(useRouterSettings.getState().threadOverrides['thread-1']).toBe(true)

    useRouterSettings.getState().setThreadOverride('thread-1', false)
    expect(useRouterSettings.getState().threadOverrides['thread-1']).toBe(false)

    useRouterSettings.getState().clearThreadOverride('thread-1')
    expect('thread-1' in useRouterSettings.getState().threadOverrides).toBe(false)
  })

  describe('isAutoRouteEnabled', () => {
    it('returns false when globally disabled', () => {
      expect(useRouterSettings.getState().isAutoRouteEnabled('thread-1')).toBe(false)
    })

    it('returns false when no router model configured', () => {
      useRouterSettings.getState().setEnabled(true)
      expect(useRouterSettings.getState().isAutoRouteEnabled('thread-1')).toBe(false)
    })

    it('returns true when enabled with router model', () => {
      useRouterSettings.getState().setEnabled(true)
      useRouterSettings.getState().setRouterModel('gpt-4o-mini', 'openai')
      expect(useRouterSettings.getState().isAutoRouteEnabled('thread-1')).toBe(true)
    })

    it('respects thread override = false', () => {
      useRouterSettings.getState().setEnabled(true)
      useRouterSettings.getState().setRouterModel('gpt-4o-mini', 'openai')
      useRouterSettings.getState().setThreadOverride('thread-1', false)
      expect(useRouterSettings.getState().isAutoRouteEnabled('thread-1')).toBe(false)
    })

    it('respects thread override = true', () => {
      useRouterSettings.getState().setEnabled(true)
      useRouterSettings.getState().setRouterModel('gpt-4o-mini', 'openai')
      useRouterSettings.getState().setThreadOverride('thread-1', true)
      expect(useRouterSettings.getState().isAutoRouteEnabled('thread-1')).toBe(true)
    })

    it('falls back to global when no thread override', () => {
      useRouterSettings.getState().setEnabled(true)
      useRouterSettings.getState().setRouterModel('gpt-4o-mini', 'openai')
      expect(useRouterSettings.getState().isAutoRouteEnabled('thread-2')).toBe(true)
    })
  })

  it('cleans up stale thread overrides', () => {
    useRouterSettings.getState().setThreadOverride('thread-1', true)
    useRouterSettings.getState().setThreadOverride('thread-2', false)
    useRouterSettings.getState().setThreadOverride('thread-3', true)

    useRouterSettings.getState().cleanupStaleOverrides(new Set(['thread-1', 'thread-3']))

    const overrides = useRouterSettings.getState().threadOverrides
    expect(overrides['thread-1']).toBe(true)
    expect(overrides['thread-3']).toBe(true)
    expect('thread-2' in overrides).toBe(false)
  })

  it('caps thread overrides at 200', () => {
    for (let i = 0; i < 210; i++) {
      useRouterSettings.getState().setThreadOverride(`thread-${i}`, true)
    }
    const keys = Object.keys(useRouterSettings.getState().threadOverrides)
    expect(keys.length).toBeLessThanOrEqual(200)
  })

  it('resets to defaults', () => {
    useRouterSettings.getState().setEnabled(true)
    useRouterSettings.getState().setRouterModel('gpt-4o-mini', 'openai')
    useRouterSettings.getState().setTimeoutMs(5000)
    useRouterSettings.getState().setThreadOverride('t1', true)

    useRouterSettings.getState().resetToDefaults()

    const state = useRouterSettings.getState()
    expect(state.enabled).toBe(false)
    expect(state.routerModelId).toBeNull()
    expect(state.timeout).toBe(15000)
    expect(state.threadOverrides).toEqual({})
  })
})
