import { describe, it, expect, vi } from 'vitest'
import { extractAgentText } from '../extract-agent-text'

describe('extractAgentText', () => {
  // ── Specification Tests ──

  it('returns result.text when available', () => {
    const result = {
      text: 'Direct answer',
      steps: [{ text: 'step text' }],
    }
    expect(extractAgentText(result)).toBe('Direct answer')
  })

  it('aggregates text from all steps when result.text is empty', () => {
    const result = {
      text: '',
      steps: [
        { text: 'Step 1 output' },
        { text: 'Step 2 output' },
        { text: '' },
      ],
    }
    expect(extractAgentText(result)).toBe('Step 1 output\nStep 2 output')
  })

  it('falls back to reasoning text when no step text exists', () => {
    const result = {
      text: '',
      steps: [
        { text: '', reasoningText: 'I think the answer is 42' },
        { text: '', reasoningText: 'Let me verify...' },
      ],
    }
    expect(extractAgentText(result)).toBe(
      'I think the answer is 42\nLet me verify...'
    )
  })

  it('falls back to tool result summaries as last resort', () => {
    const result = {
      text: '',
      steps: [
        {
          text: '',
          toolResults: [
            { toolName: 'search', output: 'Found 3 results' },
            { toolName: 'read', output: { content: 'file data' } },
          ],
        },
      ],
    }
    const text = extractAgentText(result)
    expect(text).toContain('[search]: Found 3 results')
    expect(text).toContain('[read]: {"content":"file data"}')
  })

  it('returns empty string when no content available at all', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = {
      text: '',
      steps: [{ text: '' }],
    }
    expect(extractAgentText(result)).toBe('')
    warnSpy.mockRestore()
  })

  // ── Attack Tests ──

  it('handles empty steps array', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = { text: '', steps: [] }
    expect(extractAgentText(result)).toBe('')
    warnSpy.mockRestore()
  })

  it('skips steps with undefined toolResults', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = {
      text: '',
      steps: [{ text: '', toolResults: undefined }],
    }
    expect(extractAgentText(result)).toBe('')
    warnSpy.mockRestore()
  })

  it('handles tool results with empty output', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = {
      text: '',
      steps: [
        {
          text: '',
          toolResults: [{ toolName: 'empty', output: '' }],
        },
      ],
    }
    expect(extractAgentText(result)).toBe('')
    warnSpy.mockRestore()
  })

  it('prefers step text over reasoning text', () => {
    const result = {
      text: '',
      steps: [{ text: 'step text', reasoningText: 'reasoning' }],
    }
    expect(extractAgentText(result)).toBe('step text')
  })

  it('prefers result.text over step text', () => {
    const result = {
      text: 'top level',
      steps: [{ text: 'step text' }],
    }
    expect(extractAgentText(result)).toBe('top level')
  })
})
