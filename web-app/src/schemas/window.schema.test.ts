import { describe, it, expect } from 'vitest'
import { themeStorageSchema } from './window.schema'

describe('themeStorageSchema', () => {
  it('should validate a full valid object', () => {
    const result = themeStorageSchema.safeParse({
      state: {
        activeTheme: 'dark',
        isDark: true,
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state?.activeTheme).toBe('dark')
      expect(result.data.state?.isDark).toBe(true)
    }
  })

  it('should validate with activeTheme "auto"', () => {
    const result = themeStorageSchema.safeParse({
      state: { activeTheme: 'auto' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state?.activeTheme).toBe('auto')
    }
  })

  it('should validate with activeTheme "light"', () => {
    const result = themeStorageSchema.safeParse({
      state: { activeTheme: 'light' },
    })
    expect(result.success).toBe(true)
  })

  it('should validate an empty object', () => {
    const result = themeStorageSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state).toBeUndefined()
    }
  })

  it('should validate with empty state object', () => {
    const result = themeStorageSchema.safeParse({ state: {} })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state?.activeTheme).toBeUndefined()
      expect(result.data.state?.isDark).toBeUndefined()
    }
  })

  it('should fail when activeTheme is invalid enum', () => {
    const result = themeStorageSchema.safeParse({
      state: { activeTheme: 'midnight' },
    })
    expect(result.success).toBe(false)
  })

  it('should fail when isDark is not a boolean', () => {
    const result = themeStorageSchema.safeParse({
      state: { isDark: 'yes' },
    })
    expect(result.success).toBe(false)
  })

  it('should fail when given null', () => {
    const result = themeStorageSchema.safeParse(null)
    expect(result.success).toBe(false)
  })

  it('should fail when given a non-object', () => {
    const result = themeStorageSchema.safeParse('dark')
    expect(result.success).toBe(false)
  })

  it('should validate all theme enum values', () => {
    for (const theme of ['auto', 'dark', 'light']) {
      const result = themeStorageSchema.safeParse({
        state: { activeTheme: theme },
      })
      expect(result.success).toBe(true)
    }
  })
})
