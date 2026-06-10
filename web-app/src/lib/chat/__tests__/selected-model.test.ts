import { describe, expect, it } from 'vitest'
import { resolveEffectiveSelectedModel } from '../selected-model'

const createProvider = (
  provider: string,
  models: Model[]
): ModelProvider => ({
  active: true,
  provider,
  settings: [],
  models,
})

describe('resolveEffectiveSelectedModel', () => {
  it('prefers thread model metadata from the matching provider', () => {
    const threadModel: Model = { id: 'thread-model', capabilities: ['vision'] }
    const fallbackModel: Model = { id: 'fallback-model', capabilities: ['tools'] }

    const selectedModel = resolveEffectiveSelectedModel({
      model: { id: 'thread-model', provider: 'zai-coding' },
      providers: [createProvider('zai-coding', [threadModel])],
      selectedProvider: 'llamacpp',
      selectedModelFromStore: fallbackModel,
    })

    expect(selectedModel).toBe(threadModel)
  })

  it('prefers active provider metadata over stale selected model metadata', () => {
    const staleModel: Model = { id: 'Qwen3_5-9B-IQ4_XS', capabilities: [] }
    const providerModel: Model = {
      id: 'Qwen3_5-9B-IQ4_XS',
      capabilities: ['tools', 'vision'],
    }

    const selectedModel = resolveEffectiveSelectedModel({
      providers: [createProvider('llamacpp', [providerModel])],
      selectedProvider: 'llamacpp',
      selectedModelFromStore: staleModel,
    })

    expect(selectedModel).toBe(providerModel)
    expect(selectedModel?.capabilities).toEqual(['tools', 'vision'])
  })

  it('falls back to the selected store model when provider metadata is missing', () => {
    const fallbackModel: Model = { id: 'offline-model', capabilities: ['tools'] }

    const selectedModel = resolveEffectiveSelectedModel({
      providers: [createProvider('llamacpp', [])],
      selectedProvider: 'llamacpp',
      selectedModelFromStore: fallbackModel,
    })

    expect(selectedModel).toBe(fallbackModel)
  })

  it('returns undefined when no model information exists', () => {
    expect(
      resolveEffectiveSelectedModel({
        providers: [],
      })
    ).toBeUndefined()
  })
})
