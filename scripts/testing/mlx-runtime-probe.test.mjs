import { describe, it, expect } from 'vitest'
import { createMlxHandlers, probeMlxRuntime } from '../../electron/dist/commands/mlx.js'

describe('mlx_runtime_probe Electron bridge', () => {
  it('registers mlx_runtime_probe on the command map', () => {
    const handlers = createMlxHandlers()
    expect(typeof handlers.mlx_runtime_probe).toBe('function')
  })

  it('returns host/metal capability shape from the shipped handler', () => {
    const handlers = createMlxHandlers()
    const probe = handlers.mlx_runtime_probe()
    expect(probe).toEqual(
      expect.objectContaining({
        host: expect.objectContaining({
          supported_mlx_runtime: expect.any(Boolean),
        }),
        metal: expect.objectContaining({
          fully_available: expect.any(Boolean),
        }),
      })
    )
    // Cross-check pure export matches handler
    expect(probeMlxRuntime()).toEqual(probe)
  })
})
