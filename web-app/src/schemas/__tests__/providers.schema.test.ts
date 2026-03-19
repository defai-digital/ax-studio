import { describe, it, expect } from 'vitest'
import {
  openaiModelsResponseSchema,
  altModelsResponseSchema,
  providerModelsResponseSchema,
} from '../providers.schema'

describe('openaiModelsResponseSchema', () => {
  it('should validate a valid response with model objects', () => {
    const result = openaiModelsResponseSchema.safeParse({
      data: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data).toHaveLength(2)
      expect(result.data.data[0].id).toBe('gpt-4')
    }
  })

  it('should validate with empty data array', () => {
    const result = openaiModelsResponseSchema.safeParse({ data: [] })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data).toHaveLength(0)
    }
  })

  it('should fail when data is missing', () => {
    const result = openaiModelsResponseSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should fail when data items lack id', () => {
    const result = openaiModelsResponseSchema.safeParse({
      data: [{ name: 'gpt-4' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('altModelsResponseSchema', () => {
  it('should validate with string model items', () => {
    const result = altModelsResponseSchema.safeParse({
      models: ['model-a', 'model-b'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.models).toEqual(['model-a', 'model-b'])
    }
  })

  it('should validate with object model items', () => {
    const result = altModelsResponseSchema.safeParse({
      models: [{ id: 'model-a' }, { id: 'model-b' }],
    })
    expect(result.success).toBe(true)
  })

  it('should validate with mixed string and object items', () => {
    const result = altModelsResponseSchema.safeParse({
      models: ['model-a', { id: 'model-b' }],
    })
    expect(result.success).toBe(true)
  })

  it('should fail when models is missing', () => {
    const result = altModelsResponseSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should validate with empty models array', () => {
    const result = altModelsResponseSchema.safeParse({ models: [] })
    expect(result.success).toBe(true)
  })
})

describe('providerModelsResponseSchema', () => {
  it('should accept openai format', () => {
    const result = providerModelsResponseSchema.safeParse({
      data: [{ id: 'gpt-4' }],
    })
    expect(result.success).toBe(true)
  })

  it('should accept alt format', () => {
    const result = providerModelsResponseSchema.safeParse({
      models: ['model-a'],
    })
    expect(result.success).toBe(true)
  })

  it('should accept bare array of strings', () => {
    const result = providerModelsResponseSchema.safeParse(['model-a', 'model-b'])
    expect(result.success).toBe(true)
  })

  it('should accept bare array of objects', () => {
    const result = providerModelsResponseSchema.safeParse([{ id: 'model-a' }])
    expect(result.success).toBe(true)
  })

  it('should accept empty bare array', () => {
    const result = providerModelsResponseSchema.safeParse([])
    expect(result.success).toBe(true)
  })

  it('should fail when given a plain string', () => {
    const result = providerModelsResponseSchema.safeParse('gpt-4')
    expect(result.success).toBe(false)
  })

  it('should fail when given a number', () => {
    const result = providerModelsResponseSchema.safeParse(42)
    expect(result.success).toBe(false)
  })

  it('should fail when given null', () => {
    const result = providerModelsResponseSchema.safeParse(null)
    expect(result.success).toBe(false)
  })
})
