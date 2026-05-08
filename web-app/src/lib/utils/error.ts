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
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = record.message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return fallback
}
