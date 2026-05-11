import { uniqueStrings } from './array'

export const OUT_OF_CONTEXT_SIZE =
  'the request exceeds the available context size.'

export function isContextSizeError(message: string): boolean {
  return message.trim().toLowerCase().includes(OUT_OF_CONTEXT_SIZE)
}

export function extractErrorMessage(
  error: unknown,
  fallback = 'Something went wrong.'
): string {
  if (error instanceof Error) {
    return error.message || fallback
  }
  if (typeof error === 'string' && error.length > 0) {
    return error
  }
  if (Array.isArray(error)) {
    const parts = error
      .map((item) => extractErrorMessage(item, ''))
      .filter(Boolean)
    return parts.length ? uniqueStrings(parts).join('; ') : fallback
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    for (const key of ['message', 'error', 'reason', 'detail', 'code']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim().length > 0) return value
    }
    for (const key of ['error', 'cause']) {
      const value = record[key]
      if (!value || typeof value !== 'object') continue
      const nested = extractErrorMessage(value, '')
      if (nested) return nested
    }
    try {
      return JSON.stringify(
        error,
        Object.keys(error).filter(
          (key) => !['stack', 'fileName', 'lineNumber', 'columnNumber'].includes(key)
        )
      )
    } catch {
      return Object.prototype.toString.call(error)
    }
  }
  return fallback
}
