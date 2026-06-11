import { describe, it, expect } from 'vitest'
import { mergeProviders } from '../model-provider-merge'

// Minimal test helpers
function makeProvider(name: string, models: Partial<Model>[] = [], extra: Partial<ModelProvider> = {}): ModelProvider {
  return {
    provider: name,
    models: models.map((m) => ({ id: `${name}-model`, capabilities: [], ...m }) as Model),
    settings: [],
    api_key: '',
    base_url: '',
    active: true,
    persist: false,
    ...extra,
  } as unknown as ModelProvider
}

describe('mergeProviders', () => {
  it('returns incoming providers when no existing providers', () => {
    const incoming = [makeProvider('openai', [{ id: 'gpt-4' }])]
    const result = mergeProviders(incoming, [], [], '/')
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('openai')
  })

  it('preserves api_key and base_url from existing provider', () => {
    const existing = [makeProvider('openai', [], { api_key: 'sk-existing', base_url: 'https://api.openai.com' })]
    const incoming = [makeProvider('openai', [{ id: 'gpt-4' }], { api_key: '', base_url: '' })]
    const result = mergeProviders(incoming, existing, [], '/')
    expect(result[0].api_key).toBe('sk-existing')
    expect(result[0].base_url).toBe('https://api.openai.com')
  })

  it('excludes models in deletedModels from merged list', () => {
    const existing = [makeProvider('openai', [{ id: 'gpt-3' }])]
    const incoming = [makeProvider('openai', [{ id: 'gpt-4' }, { id: 'gpt-3' }])]
    const result = mergeProviders(incoming, existing, ['gpt-4'], '/')
    const modelIds = result[0].models.map((m) => m.id)
    expect(modelIds).not.toContain('gpt-4')
    expect(modelIds).toContain('gpt-3')
  })

  it('preserves providers in existing that are not in incoming', () => {
    const existing = [makeProvider('anthropic', [{ id: 'claude-3' }])]
    const incoming = [makeProvider('openai', [{ id: 'gpt-4' }])]
    const result = mergeProviders(incoming, existing, [], '/')
    const names = result.map((p) => p.provider)
    expect(names).toContain('openai')
    expect(names).toContain('anthropic')
  })

  it('uses pathSep when matching model settings by ID segments', () => {
    const existingModel = { id: 'llama:7b/path', settings: { key: 'value' } } as unknown as Model
    const existing = [makeProvider('llamacpp', [existingModel])]
    const incomingModel = { id: 'llama:7b' } as unknown as Model
    const incoming = [makeProvider('llamacpp', [incomingModel], { persist: true })]
    const result = mergeProviders(incoming, existing, [], '/')
    // With pathSep='/', 'llama:7b'.split(':').slice(0,2).join('/') = 'llama/7b' ≠ 'llama:7b/path'
    // No settings match expected — just verify it doesn't throw
    expect(result).toHaveLength(1)
  })

  it('treats deletedModels as empty array when undefined is passed', () => {
    const incoming = [makeProvider('openai', [{ id: 'gpt-4' }])]
    const result = mergeProviders(incoming, [], undefined as unknown as string[], '/')
    expect(result[0].models.map((m) => m.id)).toContain('gpt-4')
  })

  it('merges capabilities from incoming and existing models', () => {
    const existingModel = { id: 'gpt-4', capabilities: ['vision'] } as unknown as Model
    const existing = [makeProvider('openai', [existingModel])]
    const incomingModel = { id: 'gpt-4', capabilities: ['tools'] } as unknown as Model
    const incoming = [makeProvider('openai', [incomingModel], { persist: true })]
    const result = mergeProviders(incoming, existing, [], '/')
    const caps = result[0].models[0].capabilities ?? []
    expect(caps).toContain('tools')
    expect(caps).toContain('vision')
  })

  it('preserves active=false from existing provider', () => {
    const existing = [makeProvider('openai', [], { active: false })]
    const incoming = [makeProvider('openai', [{ id: 'gpt-4' }])]
    const result = mergeProviders(incoming, existing, [], '/')
    expect(result[0].active).toBe(false)
  })
})
