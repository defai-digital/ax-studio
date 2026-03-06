import type { StopCondition } from 'ai'

export class TokenUsageTracker {
  private consumed = 0
  private readonly budget: number

  constructor(budget: number) {
    this.budget = budget
  }

  add(tokens: number): void {
    this.consumed += tokens
  }

  isExhausted(): boolean {
    if (this.budget <= 0) return false
    return this.consumed >= this.budget
  }

  budgetExhausted(): StopCondition<Record<string, never>> {
    return ({ steps }) => {
      if (this.budget <= 0) return false
      const orchestratorTokens = steps.reduce(
        (sum, step) => sum + (step.usage?.totalTokens ?? 0),
        0
      )
      return this.consumed + orchestratorTokens >= this.budget
    }
  }

  getUsage(): { consumed: number; budget: number; percentage: number } {
    return {
      consumed: this.consumed,
      budget: this.budget,
      percentage: this.budget > 0
        ? Math.round((this.consumed / this.budget) * 100)
        : 0,
    }
  }
}
