import { describe, expect, it } from 'vitest'
import {
  evaluateCoverageGate,
  normalizeGateMode,
  runCoverageGate,
} from './module-coverage-gate.mjs'

const thresholds = {
  modules: {
    services: { lines: 75, functions: 75 },
  },
}

describe('module coverage gate', () => {
  it('reports passing modules without failures', () => {
    const audit = {
      modules: {
        services: {
          lines: { pct: 80 },
          functions: { pct: 90 },
        },
      },
    }

    expect(evaluateCoverageGate(audit, thresholds).failures).toEqual([])
  })

  it('keeps advisory mode non-blocking when a module is below threshold', () => {
    const audit = {
      modules: {
        services: {
          lines: { pct: 70 },
          functions: { pct: 80 },
        },
      },
    }

    const exitCode = runCoverageGate({
      audit,
      thresholds,
      mode: 'advisory',
      stdout: () => {},
      stderr: () => {},
    })

    expect(exitCode).toBe(0)
  })

  it.each(['blocking', 'strict'])(
    'treats %s mode as blocking when a module is below threshold',
    (mode) => {
      const audit = {
        modules: {
          services: {
            lines: { pct: 70 },
            functions: { pct: 80 },
          },
        },
      }

      const exitCode = runCoverageGate({
        audit,
        thresholds,
        mode,
        stdout: () => {},
        stderr: () => {},
      })

      expect(exitCode).toBe(1)
      expect(normalizeGateMode(mode)).toBe('blocking')
    }
  )

  it('rejects unsupported modes instead of silently running advisory', () => {
    expect(() => normalizeGateMode('warn-only')).toThrow(
      /Unsupported coverage gate mode/
    )
  })
})
