import { beforeEach, describe, expect, it } from 'vitest'
import { useGuardrails } from '../useGuardrails'

describe('useGuardrails', () => {
  beforeEach(() => {
    useGuardrails.setState({
      dataMode: 'local-only',
      allowWebSearch: true,
      alwaysCiteSources: true,
      flagLowConfidence: true,
      requireApprovalBeforeEdits: false,
    })
  })

  it('has privacy-friendly defaults', () => {
    const state = useGuardrails.getState()

    expect(state.dataMode).toBe('local-only')
    expect(state.allowWebSearch).toBe(true)
    expect(state.alwaysCiteSources).toBe(true)
    expect(state.flagLowConfidence).toBe(true)
    expect(state.requireApprovalBeforeEdits).toBe(false)
  })

  it('sanitizes malformed persisted state during merge', () => {
    const current = useGuardrails.getState()
    const merge = useGuardrails.persist.getOptions().merge

    const merged = merge?.(
      {
        dataMode: 'remote-all',
        allowWebSearch: 'false',
        alwaysCiteSources: 1,
        flagLowConfidence: null,
        requireApprovalBeforeEdits: true,
      },
      current
    )

    expect(merged).toEqual(
      expect.objectContaining({
        dataMode: 'local-only',
        allowWebSearch: true,
        alwaysCiteSources: true,
        flagLowConfidence: true,
        requireApprovalBeforeEdits: true,
      })
    )
  })

  it('hydrates valid persisted state during merge', () => {
    const current = useGuardrails.getState()
    const merge = useGuardrails.persist.getOptions().merge

    const merged = merge?.(
      {
        dataMode: 'hybrid',
        allowWebSearch: false,
        alwaysCiteSources: false,
        flagLowConfidence: false,
        requireApprovalBeforeEdits: true,
      },
      current
    )

    expect(merged).toEqual(
      expect.objectContaining({
        dataMode: 'hybrid',
        allowWebSearch: false,
        alwaysCiteSources: false,
        flagLowConfidence: false,
        requireApprovalBeforeEdits: true,
      })
    )
  })

  it('ignores invalid runtime setter values', () => {
    const setDataMode = useGuardrails.getState().setDataMode as (
      value: unknown
    ) => void
    const setAllowWebSearch = useGuardrails.getState().setAllowWebSearch as (
      value: unknown
    ) => void

    setDataMode('remote-all')
    setAllowWebSearch('false')

    const state = useGuardrails.getState()
    expect(state.dataMode).toBe('local-only')
    expect(state.allowWebSearch).toBe(true)
  })
})
