import { describe, expect, it, vi } from 'vitest'
import {
  isLocalProvider,
  prepareProviderForChat,
} from '../model-session'

function makeProvider(
  provider: string,
  extra: Partial<ProviderObject> = {}
): ProviderObject {
  return {
    provider,
    api_key: '',
    models: [],
    settings: [],
    active: true,
    persist: false,
    ...extra,
  } as ProviderObject
}

describe('model-session', () => {
  it('identifies local providers', () => {
    expect(isLocalProvider(makeProvider('llamacpp'))).toBe(true)
    expect(isLocalProvider(makeProvider('mlx'))).toBe(true)
    expect(isLocalProvider(makeProvider('openai'))).toBe(false)
  })

  it('requires an api key for remote providers', async () => {
    const serviceHub = {
      models: () => ({ startModel: vi.fn() }),
    } as unknown as import('@/services').ServiceHub

    await expect(
      prepareProviderForChat(serviceHub, makeProvider('openai'), 'gpt-4.1')
    ).rejects.toThrow(
      'No API key configured'
    )
  })

  it('allows local providers without an api key', async () => {
    const startModel = vi.fn().mockResolvedValue(undefined)
    const serviceHub = {
      models: () => ({ startModel }),
    } as unknown as import('@/services').ServiceHub

    await expect(
      prepareProviderForChat(serviceHub, makeProvider('llamacpp'), 'model-a')
    ).resolves.toBeUndefined()
    await expect(
      prepareProviderForChat(serviceHub, makeProvider('mlx'), 'model-b')
    ).resolves.toBeUndefined()
  })

  it('starts local providers before chat', async () => {
    const startModel = vi.fn().mockResolvedValue(undefined)
    const serviceHub = {
      models: () => ({ startModel }),
    } as unknown as import('@/services').ServiceHub

    await prepareProviderForChat(serviceHub, makeProvider('llamacpp'), 'model-a')

    expect(startModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'llamacpp' }),
      'model-a'
    )
  })

  it('does not start remote providers when key is present', async () => {
    const startModel = vi.fn()
    const serviceHub = {
      models: () => ({ startModel }),
    } as unknown as import('@/services').ServiceHub

    await prepareProviderForChat(
      serviceHub,
      makeProvider('openai', { api_key: 'sk-test' }),
      'gpt-4.1'
    )

    expect(startModel).not.toHaveBeenCalled()
  })
})
