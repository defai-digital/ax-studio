import { describe, it, expect } from 'vitest'
import { highlightMatch } from '../highlight'

describe('highlight utility', () => {
  describe('highlightMatch', () => {
    it('should highlight characters at specified range', () => {
      const text = 'Hello World'
      const indices: [number, number][] = [[0, 0], [6, 6]]
      const result = highlightMatch(text, indices)

      expect(result).toBe('<span class="search-highlight">H</span>ello <span class="search-highlight">W</span>orld')
    })

    it('should handle empty indices array', () => {
      const text = 'Hello World'
      const result = highlightMatch(text, [])

      expect(result).toBe('Hello World')
    })

    it('should handle empty text', () => {
      const result = highlightMatch('', [[0, 1]])

      expect(result).toBe('')
    })

    it('should handle custom highlight class', () => {
      const result = highlightMatch('Hello World', [[0, 0]], 'custom-highlight')

      expect(result).toBe('<span class="custom-highlight">H</span>ello World')
    })

    it('should highlight a contiguous range', () => {
      const result = highlightMatch('Hello', [[0, 2]])

      expect(result).toBe('<span class="search-highlight">Hel</span>lo')
    })

    it('should escape HTML in text', () => {
      const result = highlightMatch('<b>Hello</b>', [[3, 7]])

      expect(result).toBe('&lt;b&gt;<span class="search-highlight">Hello</span>&lt;/b&gt;')
    })
  })
})
