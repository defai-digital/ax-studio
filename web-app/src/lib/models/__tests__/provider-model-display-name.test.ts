import { describe, expect, it } from 'vitest'
import { getProviderModelDisplayName } from '../provider-model-display-name'

describe('getProviderModelDisplayName', () => {
  it.each(['ax-engine', 'mlx'])(
    'removes the repository owner for the %s provider',
    (providerId) => {
      expect(
        getProviderModelDisplayName(
          {
            id: 'AutomatosX/AX-Qwen3-Coder-Next-MLX-OptiQ-4bit',
          } as Model,
          providerId
        )
      ).toBe('AX-Qwen3-Coder-Next-MLX-OptiQ-4bit')

      expect(
        getProviderModelDisplayName(
          {
            id: 'mlx-community/Qwen3.6-35B-A3B-OptiQ-4bit',
          } as Model,
          providerId
        )
      ).toBe('Qwen3.6-35B-A3B-OptiQ-4bit')
    }
  )

  it('preserves namespaced IDs for non-AX Engine providers', () => {
    expect(
      getProviderModelDisplayName(
        { id: 'openrouter/model-name' } as Model,
        'openrouter'
      )
    ).toBe('openrouter/model-name')
  })

  it('prefers an existing display name', () => {
    expect(
      getProviderModelDisplayName(
        {
          id: 'AutomatosX/model-name',
          displayName: 'Friendly model name',
        } as Model,
        'ax-engine'
      )
    ).toBe('Friendly model name')
  })
})
