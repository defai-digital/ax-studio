import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTheme } from './useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTheme.setState({
      activeTheme: 'auto',
      isDark: false,
    })
  })

  it('does not notify subscribers when setIsDark receives the current value', () => {
    const listener = vi.fn()
    const unsubscribe = useTheme.subscribe(listener)

    useTheme.getState().setIsDark(false)

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('does not notify subscribers when setTheme keeps the same auto theme state', async () => {
    const listener = vi.fn()
    const unsubscribe = useTheme.subscribe(listener)

    await useTheme.getState().setTheme('auto')

    expect(listener).not.toHaveBeenCalled()
    expect(useTheme.getState().activeTheme).toBe('auto')
    expect(useTheme.getState().isDark).toBe(false)
    unsubscribe()
  })
})
