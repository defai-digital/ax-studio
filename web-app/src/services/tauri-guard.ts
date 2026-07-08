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

