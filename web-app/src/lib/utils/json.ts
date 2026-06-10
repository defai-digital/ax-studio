export const safeJSONParse = <T>(
  raw: string | null | undefined
): T | null => {
  if (!raw) return null

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const isJSONEqual = (left: unknown, right: unknown): boolean => {
  return JSON.stringify(left) === JSON.stringify(right)
}

export const formatJSON = (value: unknown): string => {
  return JSON.stringify(value, null, 2)
}

export const safeJSONStringify = (
  value: unknown,
  fallback = ''
): string => {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? fallback : text
  } catch {
    return fallback
  }
}
