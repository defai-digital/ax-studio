import { describe, it, expect } from 'vitest'
import {
  parseExaTextResults,
  parseExaResults,
  parsePlan,
  parseDrillDown,
} from '../research-parsers'
import type { MCPToolCallResult } from '../research-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mcpResult(text: string, error = ''): MCPToolCallResult {
  return { error, content: [{ text }] }
}

// ---------------------------------------------------------------------------
// PHASE 1–5: parseExaTextResults
// ---------------------------------------------------------------------------

describe('parseExaTextResults', () => {
  // --- A: Spec tests ---

  it('parses a single result with Title, URL, and Text', () => {
    const input = 'Title: Hello World URL: https://example.com Text: Some body text here'
    const results = parseExaTextResults(input)
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://example.com')
    expect(results[0].title).toBe('Hello World')
    expect(results[0].snippet).toBe('Some body text here')
  })

  it('parses multiple results separated by new Title fields', () => {
    const input = [
      'Title: First URL: https://a.com Text: A body',
      'Title: Second URL: https://b.com Text: B body',
    ].join(' ')
    const results = parseExaTextResults(input)
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('First')
    expect(results[1].title).toBe('Second')
  })

  it('uses Summary as snippet fallback when Text is missing', () => {
    const input = 'Title: Foo URL: https://foo.com Summary: A summary'
    const results = parseExaTextResults(input)
    expect(results).toHaveLength(1)
    expect(results[0].snippet).toBe('A summary')
  })

  it('uses Highlights as snippet fallback when Text and Summary are missing', () => {
    const input = 'Title: Foo URL: https://foo.com Highlights: Highlighted text'
    const results = parseExaTextResults(input)
    expect(results).toHaveLength(1)
    expect(results[0].snippet).toBe('Highlighted text')
  })

  it('returns empty snippet when no Text, Summary, or Highlights', () => {
    const input = 'Title: Foo URL: https://foo.com'
    const results = parseExaTextResults(input)
    expect(results).toHaveLength(1)
    expect(results[0].snippet).toBe('')
  })

  it('truncates snippet to 300 characters', () => {
    const longText = 'x'.repeat(500)
    const input = `Title: Foo URL: https://foo.com Text: ${longText}`
    const results = parseExaTextResults(input)
    expect(results[0].snippet).toHaveLength(300)
  })

  it('includes Author and Published Date fields without breaking parsing', () => {
    const input =
      'Title: Article Author: John Published Date: 2024-01-01 URL: https://example.com Text: Content'
    const results = parseExaTextResults(input)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Article')
    expect(results[0].url).toBe('https://example.com')
  })

  // --- B: Attack / adversarial tests ---

  it('returns empty array for empty string', () => {
    expect(parseExaTextResults('')).toEqual([])
  })

  it('returns empty array for random text with no fields', () => {
    expect(parseExaTextResults('just some random gibberish')).toEqual([])
  })

  it('skips results that have no URL', () => {
    const input = 'Title: No Link Text: Body without URL'
    expect(parseExaTextResults(input)).toEqual([])
  })

  it('filters out results with non-http URLs', () => {
    const input = 'Title: Bad URL: ftp://example.com Text: Body'
    expect(parseExaTextResults(input)).toEqual([])
  })

  it('filters out results with relative URLs', () => {
    const input = 'Title: Relative URL: /path/to/page Text: Body'
    expect(parseExaTextResults(input)).toEqual([])
  })

  it('handles field values containing colons', () => {
    // The URL itself contains a colon — this should still work
    const input = 'Title: My Title URL: https://example.com:8080/path Text: Some text'
    const results = parseExaTextResults(input)
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://example.com:8080/path')
  })

  it('handles multiline Text values', () => {
    const input = 'Title: Multi URL: https://example.com Text: Line1\nLine2\nLine3'
    const results = parseExaTextResults(input)
    expect(results).toHaveLength(1)
    expect(results[0].snippet).toContain('Line1')
  })

  it('handles Title appearing mid-text as a new result boundary', () => {
    const input =
      'Title: First URL: https://a.com Text: first body Title: Second URL: https://b.com Text: second body'
    const results = parseExaTextResults(input)
    expect(results).toHaveLength(2)
    expect(results[0].url).toBe('https://a.com')
    expect(results[1].url).toBe('https://b.com')
  })

  // --- C: Property tests ---

  it('all returned URLs start with http', () => {
    const input = [
      'Title: A URL: https://a.com',
      'Title: B URL: http://b.com',
      'Title: C URL: ftp://c.com',
    ].join(' ')
    const results = parseExaTextResults(input)
    for (const r of results) {
      expect(r.url.startsWith('http')).toBe(true)
    }
  })

  it('never returns a snippet longer than 300 chars', () => {
    const longText = 'a'.repeat(1000)
    const input = `Title: X URL: https://x.com Text: ${longText}`
    const results = parseExaTextResults(input)
    for (const r of results) {
      expect(r.snippet.length).toBeLessThanOrEqual(300)
    }
  })
})

// ---------------------------------------------------------------------------
// PHASE 1–5: parseExaResults
// ---------------------------------------------------------------------------

describe('parseExaResults', () => {
  // --- A: Spec tests ---

  it('returns error message when result.error is set', () => {
    const res = parseExaResults({ error: 'rate limit', content: [] })
    expect(res.sources).toEqual([])
    expect(res.debugMsg).toBe('Exa error: rate limit')
  })

  it('returns empty when content is empty array', () => {
    const res = parseExaResults({ error: '', content: [] })
    expect(res.sources).toEqual([])
    expect(res.debugMsg).toBe('Exa returned empty content')
  })

  it('parses JSON array of ExaResult objects', () => {
    const data = [
      { url: 'https://a.com', title: 'A', text: 'body A' },
      { url: 'https://b.com', title: 'B', highlights: ['highlight B'] },
    ]
    const res = parseExaResults(mcpResult(JSON.stringify(data)))
    expect(res.sources).toHaveLength(2)
    expect(res.sources[0].url).toBe('https://a.com')
    expect(res.sources[0].title).toBe('A')
    expect(res.sources[0].snippet).toBe('body A'.slice(0, 200))
    expect(res.sources[1].snippet).toBe('highlight B')
    expect(res.debugMsg).toBe('Exa: 2 results')
  })

  it('parses JSON object with results array', () => {
    const data = {
      results: [{ url: 'https://c.com', title: 'C' }],
    }
    const res = parseExaResults(mcpResult(JSON.stringify(data)))
    expect(res.sources).toHaveLength(1)
    expect(res.sources[0].url).toBe('https://c.com')
  })

  it('falls back to text parsing when JSON has empty results', () => {
    const text = 'Title: Fallback URL: https://fallback.com Text: body'
    const res = parseExaResults(mcpResult(text))
    expect(res.sources).toHaveLength(1)
    expect(res.sources[0].url).toBe('https://fallback.com')
  })

  it('falls back to text parsing when JSON is malformed', () => {
    const text = '{bad json Title: Recover URL: https://recover.com Text: ok'
    const res = parseExaResults(mcpResult(text))
    expect(res.sources).toHaveLength(1)
    expect(res.sources[0].url).toBe('https://recover.com')
  })

  it('returns 0 results with raw preview when nothing parseable', () => {
    const res = parseExaResults(mcpResult('totally unparseable gibberish'))
    expect(res.sources).toEqual([])
    expect(res.debugMsg).toContain('Exa: 0 results parsed')
    expect(res.debugMsg).toContain('totally unparseable gibberish')
  })

  it('uses id as url fallback when url is missing from JSON result', () => {
    const data = [{ id: 'https://via-id.com', title: 'ID fallback' }]
    const res = parseExaResults(mcpResult(JSON.stringify(data)))
    expect(res.sources).toHaveLength(1)
    expect(res.sources[0].url).toBe('https://via-id.com')
  })

  it('filters out results with falsy url from JSON', () => {
    const data = [
      { url: '', title: 'No URL' },
      { url: 'https://good.com', title: 'Good' },
    ]
    const res = parseExaResults(mcpResult(JSON.stringify(data)))
    expect(res.sources).toHaveLength(1)
    expect(res.sources[0].url).toBe('https://good.com')
  })

  it('prefers highlights[0] over text for snippet in JSON mode', () => {
    const data = [
      {
        url: 'https://x.com',
        title: 'X',
        highlights: ['highlight first'],
        text: 'text second',
      },
    ]
    const res = parseExaResults(mcpResult(JSON.stringify(data)))
    expect(res.sources[0].snippet).toBe('highlight first')
  })

  it('uses snippet field as last resort in JSON mode', () => {
    const data = [{ url: 'https://x.com', title: 'X', snippet: 'the snippet' }]
    const res = parseExaResults(mcpResult(JSON.stringify(data)))
    expect(res.sources[0].snippet).toBe('the snippet')
  })

  it('truncates text to 200 chars for snippet in JSON mode', () => {
    const longText = 'z'.repeat(400)
    const data = [{ url: 'https://x.com', title: 'X', text: longText }]
    const res = parseExaResults(mcpResult(JSON.stringify(data)))
    expect(res.sources[0].snippet).toHaveLength(200)
  })

  it('includes score when present in JSON results', () => {
    const data = [{ url: 'https://x.com', title: 'X', score: 0.95 }]
    const res = parseExaResults(mcpResult(JSON.stringify(data)))
    expect(res.sources[0].score).toBe(0.95)
  })

  // --- B: Attack tests ---

  it('handles content with undefined text gracefully', () => {
    const res = parseExaResults({ error: '', content: [{ text: undefined as unknown as string }] })
    expect(res.sources).toEqual([])
  })

  it('handles JSON object that is not array and has no results key', () => {
    const res = parseExaResults(mcpResult(JSON.stringify({ foo: 'bar' })))
    // rawResults will be [] → length 0 → falls through to text parse → fails → 0 results
    expect(res.sources).toEqual([])
    expect(res.debugMsg).toContain('0 results parsed')
  })

  it('truncates raw text in debug message to 120 chars', () => {
    const longGarbage = 'g'.repeat(200)
    const res = parseExaResults(mcpResult(longGarbage))
    // debugMsg contains raw text sliced to 120
    expect(res.debugMsg.length).toBeLessThanOrEqual('Exa: 0 results parsed — raw: '.length + 120)
  })

  // --- C: Property tests ---

  it('never throws regardless of input', () => {
    const inputs: MCPToolCallResult[] = [
      { error: '', content: [] },
      { error: 'err', content: [] },
      mcpResult(''),
      mcpResult('{}'),
      mcpResult('null'),
      mcpResult('[null]'),
      mcpResult('[[[]]]'),
    ]
    for (const input of inputs) {
      expect(() => parseExaResults(input)).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// PHASE 1–5: parsePlan
// ---------------------------------------------------------------------------

describe('parsePlan', () => {
  // --- A: Spec tests ---

  it('parses a JSON array of strings', () => {
    const input = '["step one", "step two", "step three"]'
    expect(parsePlan(input)).toEqual(['step one', 'step two', 'step three'])
  })

  it('extracts JSON array embedded in surrounding text', () => {
    const input = 'Here is the plan: ["a", "b", "c"] end of plan'
    expect(parsePlan(input)).toEqual(['a', 'b', 'c'])
  })

  it('falls back to line-based parsing on non-JSON input', () => {
    const input = '1. First step\n2. Second step\n3. Third step'
    const result = parsePlan(input)
    expect(result).toEqual(['First step', 'Second step', 'Third step'])
  })

  it('handles bullet point lists in fallback', () => {
    const input = '- Do this\n- Do that\n- Do other'
    const result = parsePlan(input)
    expect(result).toEqual(['Do this', 'Do that', 'Do other'])
  })

  it('handles asterisk lists in fallback', () => {
    const input = '* Step A\n* Step B'
    const result = parsePlan(input)
    expect(result).toEqual(['Step A', 'Step B'])
  })

  it('limits fallback results to 5 items', () => {
    const input = Array.from({ length: 10 }, (_, i) => `${i + 1}. item ${i}`).join('\n')
    const result = parsePlan(input)
    expect(result).toHaveLength(5)
  })

  it('filters empty lines in fallback', () => {
    const input = '1. First\n\n\n2. Second\n\n'
    const result = parsePlan(input)
    expect(result).toEqual(['First', 'Second'])
  })

  it('handles whitespace-only input in fallback', () => {
    const input = '   \n   \n   '
    const result = parsePlan(input)
    expect(result).toEqual([])
  })

  // --- B: Attack tests ---

  it('handles empty string', () => {
    expect(parsePlan('')).toEqual([])
  })

  it('handles JSON array with non-string elements', () => {
    // Returns whatever JSON.parse produces — numbers etc.
    const input = '[1, 2, 3]'
    const result = parsePlan(input)
    expect(result).toEqual([1, 2, 3])
  })

  it('handles nested JSON arrays — extracts outermost match', () => {
    const input = '[["nested"], "flat"]'
    const result = parsePlan(input)
    expect(result).toEqual([['nested'], 'flat'])
  })

  it('strips leading numbers and punctuation from fallback lines', () => {
    const input = '1) First\n2) Second\n3. Third'
    const result = parsePlan(input)
    expect(result).toEqual(['First', 'Second', 'Third'])
  })

  it('trims whitespace around JSON array', () => {
    const input = '   ["a", "b"]   '
    expect(parsePlan(input)).toEqual(['a', 'b'])
  })

  // --- C: Property tests ---

  it('never throws', () => {
    const inputs = ['', 'null', 'undefined', '[[', '{]', 'plain text']
    for (const input of inputs) {
      expect(() => parsePlan(input)).not.toThrow()
    }
  })

  // DISCOVERED BUG: parsePlan('{}') returns a plain object {} instead of string[].
  // JSON.parse('{}') succeeds, the regex match for [...] fails, so it falls through
  // to JSON.parse(trimmed) which returns {} — a non-array. The return type says
  // string[] but the actual return is an object.
  it('BUG: returns non-array for valid JSON objects like "{}"', () => {
    const result = parsePlan('{}')
    expect(Array.isArray(result)).toBe(false)
  })

  it('fallback result length is always <= 5', () => {
    const longInput = Array.from({ length: 20 }, (_, i) => `- item ${i}`).join('\n')
    expect(parsePlan(longInput).length).toBeLessThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// PHASE 1–5: parseDrillDown
// ---------------------------------------------------------------------------

describe('parseDrillDown', () => {
  // --- A: Spec tests ---

  it('returns at most 2 items from a JSON array', () => {
    const input = '["a", "b", "c", "d"]'
    const result = parseDrillDown(input)
    expect(result).toEqual(['a', 'b'])
  })

  it('returns fewer than 2 if input has fewer items', () => {
    const input = '["only one"]'
    const result = parseDrillDown(input)
    expect(result).toEqual(['only one'])
  })

  it('works with fallback line-based parsing', () => {
    const input = '1. First\n2. Second\n3. Third'
    const result = parseDrillDown(input)
    expect(result).toHaveLength(2)
    expect(result).toEqual(['First', 'Second'])
  })

  it('returns empty array for empty input', () => {
    expect(parseDrillDown('')).toEqual([])
  })

  // --- C: Property tests ---

  it('result length is always <= 2', () => {
    const inputs = [
      '["a","b","c","d","e"]',
      '1. one\n2. two\n3. three\n4. four',
      '',
      '["single"]',
    ]
    for (const input of inputs) {
      expect(parseDrillDown(input).length).toBeLessThanOrEqual(2)
    }
  })

  it('never throws for non-JSON and malformed inputs', () => {
    const safeInputs = ['', 'garbage', '[[']
    for (const input of safeInputs) {
      expect(() => parseDrillDown(input)).not.toThrow()
    }
  })

  // DISCOVERED BUG: parsePlan('{}') returns a plain object via JSON.parse,
  // then parseDrillDown calls .slice(0, 2) on it, which throws TypeError.
  // parsePlan should validate that JSON.parse result is an array.
  it('BUG: throws when parsePlan returns non-array JSON (e.g. "{}")', () => {
    expect(() => parseDrillDown('{}')).toThrow(TypeError)
  })
})
