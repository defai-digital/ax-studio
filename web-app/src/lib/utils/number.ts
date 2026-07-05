export const toNumber = (value: unknown): number => {
  const num = Number(value)
  return isNaN(num) ? 0 : num
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
