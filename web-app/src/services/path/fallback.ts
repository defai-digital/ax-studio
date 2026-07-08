const WINDOWS_SEPARATOR = /\\/g

function normalizePath(path: string): string {
  return path.replace(WINDOWS_SEPARATOR, '/')
}

export function joinPathSegments(...segments: string[]): string {
  return segments
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
}

export function dirnameFallback(path: string, fallbackRoot: string): string {
  const normalized = normalizePath(path).replace(/\/+$/g, '')
  const lastSlash = normalized.lastIndexOf('/')

  if (lastSlash > 0) {
    return normalized.slice(0, lastSlash)
  }
  return fallbackRoot
}

export function basenameFallback(
  path: string,
  preserveTrailingDirectory: boolean = false
): string {
  const normalized = normalizePath(path)
  if (!preserveTrailingDirectory && normalized.endsWith('/')) {
    return ''
  }
  const parts = normalized.split('/').filter(Boolean)

  return parts.pop() || ''
}

export function extnameFallback(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  const lastDot = normalized.lastIndexOf('.')
  return lastDot > lastSlash ? normalized.slice(lastDot) : ''
}
