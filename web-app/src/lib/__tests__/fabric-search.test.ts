import { describe, expect, it } from 'vitest'
import {
  fabricSearchHasResults,
  formatFabricToolText,
  parseFabricSearchResults,
} from '../fabric-search'

const toolResult = (text: string) => ({
  content: [{ type: 'text', text }],
})

describe('fabric search helpers', () => {
  it('detects JSON search hits', () => {
    expect(fabricSearchHasResults(toolResult('{"results":[{"source":"a.md"}]}'))).toBe(true)
    expect(fabricSearchHasResults(toolResult('{"results":[]}'))).toBe(false)
  })

  it('formats text content from tool results and string fallbacks', () => {
    expect(formatFabricToolText({
      content: [
        { type: 'text', text: ' first ' },
        { type: 'image', text: 'skip' },
        { type: 'text', text: 'second' },
      ],
    })).toBe('first\n\n---\n\nsecond')
    expect(formatFabricToolText('raw text')).toBe('raw text')
  })

  it('parses search result records defensively', () => {
    expect(parseFabricSearchResults(toolResult(JSON.stringify({
      results: [
        { source: 'a.md', content: 'A', score: 0.9 },
        { source: 123, content: null, score: 'bad' },
      ],
    })))).toEqual([
      { source: 'a.md', content: 'A', score: 0.9 },
      { source: null, content: '', score: undefined },
    ])
  })
})
