export async function withTauriFallback<T>(
  operation: () => Promise<T>,
  failureMessage: string,
  fallback: () => T
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    console.error(failureMessage, error)
    return fallback()
  }
}

export function withTauriFallbackSync<T>(
  operation: () => T,
  failureMessage: string,
  fallback: T
): T {
  try {
    return operation()
  } catch (error) {
    console.error(failureMessage, error)
    return fallback
  }
}
