import { describe, it, expect } from 'vitest'
import { assistantSchema, assistantsSchema } from './assistants.schema'

describe('assistantSchema', () => {
  const validAssistant = {
    id: 'asst-1',
    name: 'Test Assistant',
    created_at: 1700000000,
  }

  it('should validate a minimal valid assistant', () => {
    const result = assistantSchema.safeParse(validAssistant)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('asst-1')
      expect(result.data.name).toBe('Test Assistant')
      expect(result.data.created_at).toBe(1700000000)
    }
  })

  it('should validate an assistant with all optional fields', () => {
    const full = {
      ...validAssistant,
      avatar: 'https://example.com/avatar.png',
      description: 'A helpful assistant',
      instructions: 'You are a helpful assistant',
      parameters: { temperature: 0.7 },
      type: 'agent' as const,
      role: 'researcher',
      goal: 'Find information',
      model_override_id: 'gpt-4',
      tool_scope: {
        mode: 'include' as const,
        tool_keys: ['tool1', 'tool2'],
      },
      max_steps: 10,
      timeout: { total_ms: 30000, step_ms: 5000 },
      max_result_tokens: 4096,
      optional: true,
    }
    const result = assistantSchema.safeParse(full)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('agent')
      expect(result.data.tool_scope?.mode).toBe('include')
      expect(result.data.tool_scope?.tool_keys).toEqual(['tool1', 'tool2'])
      expect(result.data.timeout?.total_ms).toBe(30000)
      expect(result.data.max_steps).toBe(10)
    }
  })

  it('should fail when id is missing', () => {
    const result = assistantSchema.safeParse({ name: 'Test', created_at: 123 })
    expect(result.success).toBe(false)
  })

  it('should fail when name is missing', () => {
    const result = assistantSchema.safeParse({ id: '1', created_at: 123 })
    expect(result.success).toBe(false)
  })

  it('should fail when created_at is missing', () => {
    const result = assistantSchema.safeParse({ id: '1', name: 'Test' })
    expect(result.success).toBe(false)
  })

  it('should fail when id is not a string', () => {
    const result = assistantSchema.safeParse({ id: 123, name: 'Test', created_at: 123 })
    expect(result.success).toBe(false)
  })

  it('should fail when created_at is a string', () => {
    const result = assistantSchema.safeParse({ id: '1', name: 'Test', created_at: '123' })
    expect(result.success).toBe(false)
  })

  it('should fail when type is an invalid enum value', () => {
    const result = assistantSchema.safeParse({
      ...validAssistant,
      type: 'bot',
    })
    expect(result.success).toBe(false)
  })

  it('should validate type enum values', () => {
    for (const type of ['assistant', 'agent']) {
      const result = assistantSchema.safeParse({ ...validAssistant, type })
      expect(result.success).toBe(true)
    }
  })

  it('should fail when tool_scope has invalid mode', () => {
    const result = assistantSchema.safeParse({
      ...validAssistant,
      tool_scope: { mode: 'invalid', tool_keys: [] },
    })
    expect(result.success).toBe(false)
  })

  it('should fail when tool_scope.tool_keys is not an array', () => {
    const result = assistantSchema.safeParse({
      ...validAssistant,
      tool_scope: { mode: 'all', tool_keys: 'not-array' },
    })
    expect(result.success).toBe(false)
  })

  it('should accept empty string for name', () => {
    const result = assistantSchema.safeParse({
      id: '1',
      name: '',
      created_at: 0,
    })
    expect(result.success).toBe(true)
  })

  it('should strip unknown fields', () => {
    const result = assistantSchema.safeParse({
      ...validAssistant,
      unknownField: 'value',
    })
    // Zod v4 strips unknown by default in objects
    expect(result.success).toBe(true)
  })
})

describe('assistantsSchema', () => {
  it('should validate an array of assistants', () => {
    const result = assistantsSchema.safeParse([
      { id: '1', name: 'A1', created_at: 100 },
      { id: '2', name: 'A2', created_at: 200 },
    ])
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(2)
      expect(result.data[0].id).toBe('1')
    }
  })

  it('should validate an empty array', () => {
    const result = assistantsSchema.safeParse([])
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(0)
    }
  })

  it('should fail if any element is invalid', () => {
    const result = assistantsSchema.safeParse([
      { id: '1', name: 'A1', created_at: 100 },
      { name: 'Missing ID' },
    ])
    expect(result.success).toBe(false)
  })

  it('should fail when given a non-array', () => {
    const result = assistantsSchema.safeParse({ id: '1' })
    expect(result.success).toBe(false)
  })
})
