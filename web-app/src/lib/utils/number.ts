import { parsePlainDecimalNumber } from './decimal'

export const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value !== 'string') return 0

  const parsed = parsePlainDecimalNumber(value)
  return parsed ?? 0
}

export function formatCompactNumber(value: number, fractionDigits = 1): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(fractionDigits)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(fractionDigits)}K`
  }
  return value.toString()
}
