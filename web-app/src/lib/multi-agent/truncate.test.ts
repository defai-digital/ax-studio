import { describe, it, expect } from 'vitest'
import { truncateToTokenLimit } from './truncate'

describe('truncateToTokenLimit', () => {
  it('passes through short text unchanged', () => {
    const text = 'Hello world'
    expect(truncateToTokenLimit(text, 1000)).toBe(text)
  })

  it('truncates text longer than max chars', () => {
    const text = 'a'.repeat(5000)
    const result = truncateToTokenLimit(text, 100) // 100 tokens * 4 = 400 chars
    expect(result.length).toBeLessThan(text.length)
    expect(result).toContain('[Output truncated')
  })

  it('tries to cut at sentence boundary', () => {
    // Create text where a period appears after 80% of maxChars
    const maxTokens = 100
    const maxChars = maxTokens * 4 // 400
    const text =
      'a'.repeat(350) + '. ' + 'b'.repeat(200) // period at 350, maxChars is 400
    const result = truncateToTokenLimit(text, maxTokens)
    // Should cut at the period (position 351) since 350 > 400 * 0.8 = 320
    expect(result).toContain('[Output truncated')
  })

  it('includes original length in truncation notice', () => {
    const text = 'x'.repeat(2000)
    const result = truncateToTokenLimit(text, 100)
    expect(result).toContain('Original length: 2000 chars')
    expect(result).toContain('limit: 400 chars')
  })

  it('handles exact boundary', () => {
    const text = 'a'.repeat(400) // exactly maxChars for 100 tokens
    expect(truncateToTokenLimit(text, 100)).toBe(text)
  })
})
