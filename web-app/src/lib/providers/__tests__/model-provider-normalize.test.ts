import { describe, it, expect } from 'vitest'
import { filterValidModels } from '../model-provider-normalize'

describe('filterValidModels', () => {
  it('keeps models with a valid string id', () => {
    const models = [
      { id: 'gpt-4' },
      { id: 'llama-7b' },
    ]
    expect(filterValidModels(models)).toHaveLength(2)
  })

  it('keeps models with a valid string model field when id is absent', () => {
    const models = [{ model: 'gpt-3.5-turbo' }]
    expect(filterValidModels(models)).toHaveLength(1)
  })

  it('removes models where id is not a string', () => {
    const models = [
      { id: 'valid' },
      { id: 42 as unknown as string },
    ]
    expect(filterValidModels(models)).toHaveLength(1)
    expect(filterValidModels(models)[0].id).toBe('valid')
  })

  it('removes models without id or model field', () => {
    const models = [{ name: 'orphan' } as unknown as { id?: string }]
    expect(filterValidModels(models)).toHaveLength(0)
  })

  it('returns empty array for empty input', () => {
    expect(filterValidModels([])).toHaveLength(0)
  })
})
