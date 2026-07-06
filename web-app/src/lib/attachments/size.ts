export function normalizeFileSize(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  }

  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined

  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}
