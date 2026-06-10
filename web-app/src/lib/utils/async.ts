export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    }),
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout)
  }) as Promise<T>
}

