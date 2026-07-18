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
  // Empty / root-only path: keep a stable parent (Node returns "/").
  if (!normalized) {
    return fallbackRoot === '/' ? '/' : fallbackRoot
  }

  const lastSlash = normalized.lastIndexOf('/')
  // Relative basename (e.g. "file.txt") — no directory component.
  if (lastSlash === -1) return fallbackRoot
  // Absolute single-segment path (e.g. "/home") — parent is filesystem root.
  if (lastSlash === 0) return '/'
  return normalized.slice(0, lastSlash)
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
