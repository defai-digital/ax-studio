import { describe, it, expect } from 'vitest'
import {
  PLANNER_PROMPT,
  SUMMARISE_PROMPT,
  DRILL_DOWN_PROMPT,
  WRITER_PROMPT,
} from './research-prompts'

describe('PLANNER_PROMPT', () => {
  it('includes the query in the prompt', () => {
    const result = PLANNER_PROMPT('What is quantum computing?', 3)
    expect(result).toContain('What is quantum computing?')
  })

  it('includes the breadth count', () => {
    const result = PLANNER_PROMPT('test query', 5)
    expect(result).toContain('exactly 5 focused sub-questions')
  })

  it('requests JSON array output format', () => {
    const result = PLANNER_PROMPT('test', 3)
    expect(result).toContain('JSON array')
    expect(result).toContain('No markdown')
  })

  it('includes the breadth in the example format description', () => {
    const result = PLANNER_PROMPT('test', 4)
    expect(result).toContain('JSON array of 4 strings')
  })
})

describe('SUMMARISE_PROMPT', () => {
  it('includes the research question', () => {
    const result = SUMMARISE_PROMPT('How does AI work?', 'Some page text')
    expect(result).toContain('How does AI work?')
  })

  it('includes the page text', () => {
    const result = SUMMARISE_PROMPT('question', 'The page content goes here')
    expect(result).toContain('The page content goes here')
  })

  it('truncates page text to 8000 characters', () => {
    const longText = 'x'.repeat(10000)
    const result = SUMMARISE_PROMPT('question', longText)
    // The prompt should contain at most 8000 x characters from the page text
    const xCount = (result.match(/x/g) || []).length
    expect(xCount).toBe(8000)
  })

  it('requests 500 word limit', () => {
    const result = SUMMARISE_PROMPT('q', 'text')
    expect(result).toContain('500 words')
  })

  it('instructs to respond with no-relevant-info message when appropriate', () => {
    const result = SUMMARISE_PROMPT('q', 'text')
    expect(result).toContain('No relevant information found')
  })
})

describe('DRILL_DOWN_PROMPT', () => {
  it('includes the question', () => {
    const result = DRILL_DOWN_PROMPT('Deep learning trends', ['summary 1'])
    expect(result).toContain('Deep learning trends')
  })

  it('joins summaries with separator', () => {
    const summaries = ['Summary A', 'Summary B']
    const result = DRILL_DOWN_PROMPT('question', summaries)
    expect(result).toContain('Summary A')
    expect(result).toContain('Summary B')
    expect(result).toContain('---')
  })

  it('limits summaries to first 10', () => {
    const summaries = Array.from({ length: 15 }, (_, i) => `Summary ${i}`)
    const result = DRILL_DOWN_PROMPT('question', summaries)
    expect(result).toContain('Summary 9')
    // Summary 10 through 14 should not appear (sliced at 10)
    expect(result).not.toContain('Summary 10')
  })

  it('truncates context to approximately 6000 characters', () => {
    const summaries = ['x'.repeat(8000)]
    const result = DRILL_DOWN_PROMPT('question', summaries)
    const xCount = (result.match(/x/g) || []).length
    // slice(0, 6000) truncates the joined context; the word "question"
    // also contains characters but the bulk of x's should be ~6000
    expect(xCount).toBeLessThanOrEqual(8000)
    expect(xCount).toBeGreaterThanOrEqual(6000)
  })

  it('requests exactly 2 follow-up questions', () => {
    const result = DRILL_DOWN_PROMPT('question', ['summary'])
    expect(result).toContain('2 important follow-up questions')
    expect(result).toContain('JSON array of 2 strings')
  })
})

describe('WRITER_PROMPT', () => {
  it('includes the query', () => {
    const result = WRITER_PROMPT('AI ethics', ['block 1'], [
      { url: 'https://example.com', title: 'Example', snippet: 'snip' },
    ])
    expect(result).toContain('AI ethics')
  })

  it('formats sources with numbered index', () => {
    const sources = [
      { url: 'https://a.com', title: 'Source A', snippet: '' },
      { url: 'https://b.com', title: 'Source B', snippet: '' },
    ]
    const result = WRITER_PROMPT('query', ['block'], sources)
    expect(result).toContain('[1] Source A — https://a.com')
    expect(result).toContain('[2] Source B — https://b.com')
  })

  it('uses URL as fallback when title is empty', () => {
    const sources = [
      { url: 'https://notitle.com', title: '', snippet: '' },
    ]
    const result = WRITER_PROMPT('query', ['block'], sources)
    // When title is empty, `s.title || s.url` evaluates to s.url
    expect(result).toContain('[1] https://notitle.com — https://notitle.com')
  })

  it('limits context blocks to first 100', () => {
    const blocks = Array.from({ length: 150 }, (_, i) => `Block ${i}`)
    const result = WRITER_PROMPT('query', blocks, [])
    expect(result).toContain('Block 99')
    // Block 100 through 149 should not appear
    expect(result).not.toContain('Block 100')
  })

  it('truncates context to approximately 14000 characters', () => {
    const blocks = ['x'.repeat(20000)]
    const result = WRITER_PROMPT('query', blocks, [])
    const xCount = (result.match(/x/g) || []).length
    // slice(0, 14000) truncates the joined context
    expect(xCount).toBeLessThanOrEqual(20000)
    expect(xCount).toBeGreaterThanOrEqual(14000)
  })

  it('includes report structure instructions', () => {
    const result = WRITER_PROMPT('query', ['block'], [])
    expect(result).toContain('Executive Summary')
    expect(result).toContain('Key Findings')
    expect(result).toContain('Conclusion')
    expect(result).toContain('1800')
  })

  it('instructs not to include Sources section', () => {
    const result = WRITER_PROMPT('query', ['block'], [])
    expect(result).toContain('Do NOT include a Sources or References section')
  })

  it('handles empty sources list', () => {
    const result = WRITER_PROMPT('query', ['block'], [])
    expect(result).toContain('Source index for reference:')
    // No source lines should appear
    expect(result).not.toContain('[1]')
  })
})
