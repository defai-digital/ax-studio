import { describe, it, expect } from 'vitest'
import { deepLinkPayloadSchema } from '../events.schema'

describe('deepLinkPayloadSchema', () => {
  it('should validate a string', () => {
    const result = deepLinkPayloadSchema.safeParse('ax-studio://open?url=test')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('ax-studio://open?url=test')
    }
  })

  it('should validate an empty string', () => {
    const result = deepLinkPayloadSchema.safeParse('')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('')
    }
  })

  it('should fail when given a number', () => {
    const result = deepLinkPayloadSchema.safeParse(123)
    expect(result.success).toBe(false)
  })

  it('should fail when given null', () => {
    const result = deepLinkPayloadSchema.safeParse(null)
    expect(result.success).toBe(false)
  })

  it('should fail when given undefined', () => {
    const result = deepLinkPayloadSchema.safeParse(undefined)
    expect(result.success).toBe(false)
  })

  it('should fail when given an object', () => {
    const result = deepLinkPayloadSchema.safeParse({ url: 'test' })
    expect(result.success).toBe(false)
  })

  it('should fail when given a boolean', () => {
    const result = deepLinkPayloadSchema.safeParse(true)
    expect(result.success).toBe(false)
  })

  it('should validate a long string', () => {
    const longStr = 'a'.repeat(10000)
    const result = deepLinkPayloadSchema.safeParse(longStr)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(10000)
    }
  })
})
