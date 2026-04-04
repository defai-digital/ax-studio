import { describe, it, expect } from 'vitest'
import { TokenUsageTracker } from './token-usage-tracker'

describe('TokenUsageTracker', () => {
  it('starts with zero consumed', () => {
    const tracker = new TokenUsageTracker(100000)
    const usage = tracker.getUsage()
    expect(usage.consumed).toBe(0)
    expect(usage.budget).toBe(100000)
    expect(usage.percentage).toBe(0)
  })

  it('accumulates tokens via add()', () => {
    const tracker = new TokenUsageTracker(100000)
    tracker.add(5000)
    tracker.add(3000)
    expect(tracker.getUsage().consumed).toBe(8000)
    expect(tracker.getUsage().percentage).toBe(8)
  })

  it('isExhausted() returns false when under budget', () => {
    const tracker = new TokenUsageTracker(10000)
    tracker.add(5000)
    expect(tracker.isExhausted()).toBe(false)
  })

  it('isExhausted() returns true when at or over budget', () => {
    const tracker = new TokenUsageTracker(10000)
    tracker.add(10000)
    expect(tracker.isExhausted()).toBe(true)

    const tracker2 = new TokenUsageTracker(10000)
    tracker2.add(15000)
    expect(tracker2.isExhausted()).toBe(true)
  })

  it('budgetExhausted() returns a stop condition function', () => {
    const tracker = new TokenUsageTracker(10000)
    const condition = tracker.budgetExhausted()
    expect(typeof condition).toBe('function')
  })

  it('budgetExhausted() stops when combined tokens exceed budget', () => {
    const tracker = new TokenUsageTracker(10000)
    tracker.add(8000) // sub-agent tokens

    const condition = tracker.budgetExhausted()

    // Steps with 3000 orchestrator tokens → total = 8000 + 3000 = 11000 > 10000
    const shouldStop = condition({
      steps: [{ usage: { totalTokens: 3000 } }],
    } as Parameters<typeof condition>[0])
    expect(shouldStop).toBe(true)
  })

  it('budgetExhausted() does not stop when under budget', () => {
    const tracker = new TokenUsageTracker(10000)
    tracker.add(2000)

    const condition = tracker.budgetExhausted()
    const shouldStop = condition({
      steps: [{ usage: { totalTokens: 1000 } }],
    } as Parameters<typeof condition>[0])
    expect(shouldStop).toBe(false)
  })
})
