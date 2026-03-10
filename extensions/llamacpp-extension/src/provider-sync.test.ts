import { describe, expect, it } from 'vitest'
import { decideLocalProviderSync } from './provider-sync'

describe('decideLocalProviderSync', () => {
  it('unregisters when no models are loaded', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: [],
        llamacppModels: [],
        axServingModels: [],
        axServingPort: 0,
      })
    ).toEqual({ action: 'unregister' })
  })

  it('prefers the explicit preferred port and key', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a'],
        llamacppModels: ['model-a'],
        axServingModels: [],
        axServingPort: 0,
        preferred: { port: 8080, apiKey: 'secret', models: ['model-a'] },
      })
    ).toEqual({
      action: 'register',
      port: 8080,
      apiKey: 'secret',
      models: ['model-a'],
    })
  })

  it('falls back to ax-serving when active', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a', 'model-b'],
        llamacppModels: ['model-a'],
        axServingModels: ['model-b'],
        axServingPort: 1337,
      })
    ).toEqual({
      action: 'register',
      port: 1337,
      apiKey: '',
      models: ['model-b'],
    })
  })

  it('uses a fallback llama.cpp session when available', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a'],
        llamacppModels: ['model-a'],
        axServingModels: [],
        axServingPort: 0,
        fallbackSession: { port: 8081, api_key: 'llama-key' },
      })
    ).toEqual({
      action: 'register',
      port: 8081,
      apiKey: 'llama-key',
      models: ['model-a'],
    })
  })

  it('limits process-based llama.cpp registration to one reachable model by default', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a', 'model-b'],
        llamacppModels: ['model-a', 'model-b'],
        axServingModels: [],
        axServingPort: 0,
        fallbackSession: { port: 8081, api_key: 'llama-key' },
      })
    ).toEqual({ action: 'unregister' })
  })

  it('skips when models exist but no active port can be determined', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a'],
        llamacppModels: ['model-a'],
        axServingModels: [],
        axServingPort: 0,
        fallbackSession: null,
      })
    ).toEqual({ action: 'skip' })
  })

  it('keeps preferred models scoped to the selected engine', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['llama-model', 'ax-model'],
        llamacppModels: ['llama-model'],
        axServingModels: ['ax-model'],
        axServingPort: 1337,
        preferred: { port: 8080, apiKey: 'secret', models: ['llama-model'] },
      })
    ).toEqual({
      action: 'register',
      port: 8080,
      apiKey: 'secret',
      models: ['llama-model'],
    })
  })

  it('keeps a single reachable process model registered when it is the only option', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a'],
        llamacppModels: ['model-a'],
        axServingModels: [],
        axServingPort: 0,
        fallbackSession: { port: 8081, api_key: 'llama-key' },
      })
    ).toEqual({
      action: 'register',
      port: 8081,
      apiKey: 'llama-key',
      models: ['model-a'],
    })
  })

  it('normalizes model ids to a stable sorted unique list', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-b', 'model-a', 'model-a'],
        llamacppModels: ['model-b', 'model-a', 'model-a'],
        axServingModels: [],
        axServingPort: 0,
        preferred: { port: 8080, apiKey: 'secret' },
        fallbackSession: { port: 8081, api_key: 'ignored' },
      })
    ).toEqual({
      action: 'register',
      port: 8080,
      apiKey: 'secret',
      models: ['model-a', 'model-b'],
    })
  })
})
