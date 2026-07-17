import { parsePlainDecimalNumber } from './decimal'

export const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value !== 'string') return 0

  const parsed = parsePlainDecimalNumber(value)
  return parsed ?? 0
}

/**
 * Compact display for large counts (e.g. downloads, tokens).
 * Promotes to the next unit when rounding would print "1000K" / "1000M".
 */
export function formatCompactNumber(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '0'

  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)

  const formatUnit = (divisor: number, suffix: string): string | null => {
    const fixed = (abs / divisor).toFixed(fractionDigits)
    // Keep promoting when rounding produces 1000 of the current unit.
    if (Number(fixed) >= 1000) return null
    return `${sign}${fixed}${suffix}`
  }

  if (abs >= 1_000_000_000) {
    return (
      formatUnit(1_000_000_000, 'B') ??
      `${sign}${(abs / 1_000_000_000).toFixed(fractionDigits)}B`
    )
  }
  if (abs >= 1_000_000) {
    return formatUnit(1_000_000, 'M') ?? formatUnit(1_000_000_000, 'B')!
  }
  if (abs >= 1_000) {
    return formatUnit(1_000, 'K') ?? formatUnit(1_000_000, 'M')!
  }
  return value.toString()
}
