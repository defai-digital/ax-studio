import { describe, it, expect } from 'vitest'
import { sanitize, validateTeamAgentNames } from '../sanitize'

describe('sanitize', () => {
  it('lowercases names', () => {
    expect(sanitize('Research')).toBe('research')
  })

  it('replaces special characters with underscores', () => {
    expect(sanitize('Code Review')).toBe('code_review')
  })

  it('collapses multiple underscores', () => {
    expect(sanitize('a--b  c')).toBe('a_b_c')
  })

  it('strips leading and trailing underscores', () => {
    expect(sanitize('_test_')).toBe('test')
    expect(sanitize('--hello--')).toBe('hello')
  })

  it('handles complex names', () => {
    expect(sanitize('Senior Research Analyst!')).toBe(
      'senior_research_analyst'
    )
  })

  it('preserves numbers', () => {
    expect(sanitize('Agent 007')).toBe('agent_007')
  })
})

describe('validateTeamAgentNames', () => {
  it('returns null for unique names', () => {
    expect(
      validateTeamAgentNames([
        { name: 'Researcher' },
        { name: 'Writer' },
        { name: 'Editor' },
      ])
    ).toBeNull()
  })

  it('returns error for conflicting names', () => {
    const result = validateTeamAgentNames([
      { name: 'Research!' },
      { name: 'research' },
    ])
    expect(result).toContain('conflict after sanitization')
  })

  it('returns error for names that differ only in special chars', () => {
    const result = validateTeamAgentNames([
      { name: 'Code-Review' },
      { name: 'Code Review' },
    ])
    expect(result).toContain('conflict after sanitization')
  })
})
