import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('ai', () => ({ generateText: vi.fn(), streamText: vi.fn() }))
vi.mock('./useResearchPanel', () => ({ useResearchPanel: vi.fn() }))
vi.mock('./useModelProvider', () => ({ useModelProvider: { getState: vi.fn() } }))
vi.mock('@/lib/model-factory', () => ({ ModelFactory: { createModel: vi.fn() } }))
vi.mock('@/lib/research-prompts', () => ({
  PLANNER_PROMPT: vi.fn(),
  SUMMARISE_PROMPT: vi.fn(),
  DRILL_DOWN_PROMPT: vi.fn(),
  WRITER_PROMPT: vi.fn(),
}))

import { __researchTestUtils } from './useResearch'

describe('useResearch rate-limit helpers', () => {
  it('detects 429 messages as Exa rate limits', () => {
    expect(__researchTestUtils.isExaRateLimitMessage('HTTP status client error (429 Too Many Requests)')).toBe(true)
  })

  it('detects generic rate-limit wording', () => {
    expect(__researchTestUtils.isExaRateLimitMessage('Exa rate limit exceeded')).toBe(true)
    expect(__researchTestUtils.isExaRateLimitMessage('Too many requests from this client')).toBe(true)
  })

  it('detects ExaRateLimitError by name', () => {
    const err = new Error('some error')
    err.name = 'ExaRateLimitError'
    expect(__researchTestUtils.isExaRateLimitError(err)).toBe(true)
  })

  it('does not classify unrelated errors as rate limits', () => {
    expect(__researchTestUtils.isExaRateLimitMessage('network timeout while connecting')).toBe(false)
    expect(__researchTestUtils.isExaRateLimitError(new Error('connection reset by peer'))).toBe(false)
  })
})
