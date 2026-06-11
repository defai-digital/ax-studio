import { describe, expect, it } from 'vitest'
import { decideLocalProviderSync } from './provider-sync'

describe('decideLocalProviderSync', () => {
  it('unregisters when no models are loaded', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: [],
      })
    ).toEqual({ action: 'unregister' })
  })

  it('prefers the explicit preferred port and key', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a'],
        preferred: { port: 8080, apiKey: 'secret', models: ['model-a'] },
      })
    ).toEqual({
      action: 'register',
      port: 8080,
      apiKey: 'secret',
      models: ['model-a'],
    })
  })

  it('defaults preferred models to all loaded models', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-b', 'model-a'],
        preferred: { port: 9000 },
      })
    ).toEqual({
      action: 'register',
      port: 9000,
      apiKey: '',
      models: ['model-a', 'model-b'],
    })
  })

  it('registers the single loaded model via the fallback session', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a'],
        fallbackSession: { port: 7777, api_key: 'key-a' },
      })
    ).toEqual({
      action: 'register',
      port: 7777,
      apiKey: 'key-a',
      models: ['model-a'],
    })
  })

  it('unregisters when multiple models are loaded without a preference', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a', 'model-b'],
        fallbackSession: { port: 7777, api_key: 'key-a' },
      })
    ).toEqual({ action: 'unregister' })
  })

  it('skips when models are loaded but no port is known', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a'],
      })
    ).toEqual({ action: 'skip' })

    expect(
      decideLocalProviderSync({
        loadedModels: ['model-a'],
        fallbackSession: null,
      })
    ).toEqual({ action: 'skip' })
  })

  it('deduplicates and sorts model ids', () => {
    expect(
      decideLocalProviderSync({
        loadedModels: ['model-b', 'model-a', 'model-b'],
        preferred: { port: 8080, models: ['model-b', 'model-b', 'model-a'] },
      })
    ).toEqual({
      action: 'register',
      port: 8080,
      apiKey: '',
      models: ['model-a', 'model-b'],
    })
  })
})
