import { beforeEach, describe, expect, it } from 'vitest'
import { useAxBiLiveNavigation } from '../useAxBiLiveNavigation'

describe('useAxBiLiveNavigation', () => {
  beforeEach(() => {
    useAxBiLiveNavigation.setState({ enabled: true })
  })

  it('has live navigation enabled by default', () => {
    expect(useAxBiLiveNavigation.getState().enabled).toBe(true)
  })

  it('sets enabled state', () => {
    useAxBiLiveNavigation.getState().setEnabled(false)
    expect(useAxBiLiveNavigation.getState().enabled).toBe(false)

    useAxBiLiveNavigation.getState().setEnabled(true)
    expect(useAxBiLiveNavigation.getState().enabled).toBe(true)
  })

  it('sanitizes malformed persisted state during merge', () => {
    const current = useAxBiLiveNavigation.getState()
    const merge = useAxBiLiveNavigation.persist.getOptions().merge

    const merged = merge?.(
      {
        enabled: 'false',
      },
      current
    )

    expect(merged).toEqual(
      expect.objectContaining({
        enabled: true,
      })
    )
  })

  it('hydrates valid persisted state during merge', () => {
    const current = useAxBiLiveNavigation.getState()
    const merge = useAxBiLiveNavigation.persist.getOptions().merge

    const merged = merge?.(
      {
        enabled: false,
      },
      current
    )

    expect(merged).toEqual(
      expect.objectContaining({
        enabled: false,
      })
    )
  })

  it('ignores invalid runtime setter values', () => {
    const setEnabled = useAxBiLiveNavigation.getState().setEnabled as (
      value: unknown
    ) => void

    setEnabled('false')
    expect(useAxBiLiveNavigation.getState().enabled).toBe(true)
  })
})
