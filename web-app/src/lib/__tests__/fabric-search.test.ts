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
    expect(
      fabricSearchHasResults(toolResult('{"results":[{"source":"a.md"}]}'))
    ).toBe(true)
    expect(fabricSearchHasResults(toolResult('{"results":[]}'))).toBe(false)
  })

  it('does not treat non-JSON error prose as a knowledge hit', () => {
    expect(fabricSearchHasResults(toolResult('Connection refused'))).toBe(
      false
    )
    expect(
      fabricSearchHasResults(toolResult('<html>Internal Server Error</html>'))
    ).toBe(false)
  })

  it('formats text content from tool results and string fallbacks', () => {
    expect(
      formatFabricToolText({
        content: [
          { type: 'text', text: ' first ' },
          { type: 'image', text: 'skip' },
          { type: 'text', text: 'second' },
        ],
      })
    ).toBe('first\n\n---\n\nsecond')
    expect(formatFabricToolText('raw text')).toBe('raw text')
  })

  it('parses search result records defensively', () => {
    expect(
      parseFabricSearchResults(
        toolResult(
          JSON.stringify({
            results: [
              { source: 'a.md', content: 'A', score: 0.9 },
              { source: 123, content: null, score: 'bad' },
            ],
          })
        )
      )
    ).toEqual([
      { source: 'a.md', content: 'A', score: 0.9 },
      { source: null, content: '', score: undefined },
    ])
  })

  it('finds JSON hits when a non-JSON text part comes first', () => {
    const multiPart = {
      content: [
        { type: 'text', text: 'Searching knowledge base…' },
        {
          type: 'text',
          text: JSON.stringify({
            results: [{ source: 'a.md', content: 'hit', score: 0.8 }],
          }),
        },
      ],
    }

    expect(fabricSearchHasResults(multiPart)).toBe(true)
    expect(parseFabricSearchResults(multiPart)).toEqual([
      { source: 'a.md', content: 'hit', score: 0.8 },
    ])
  })

  it('still rejects multi-part content with only non-JSON prose', () => {
    expect(
      fabricSearchHasResults({
        content: [
          { type: 'text', text: 'Searching…' },
          { type: 'text', text: 'Connection refused' },
        ],
      })
    ).toBe(false)
    expect(
      parseFabricSearchResults({
        content: [
          { type: 'text', text: 'Searching…' },
          { type: 'text', text: 'Connection refused' },
        ],
      })
    ).toEqual([])
  })
})
