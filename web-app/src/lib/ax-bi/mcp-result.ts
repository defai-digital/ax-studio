export type AxBiMcpResult = {
  error?: string
  content?: Array<{
    type?: string
    text?: string
  }>
  structuredContent?: unknown
  structured_content?: unknown
  isError?: boolean
  is_error?: boolean
}

export type AxBiNormalizedResult =
  | Record<string, unknown>
  | { error: string }
  | { message: string }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * MCP CallToolResult marks failure with `isError` / `is_error` and often puts
 * the message only in content text — not a top-level `error` string.
 * Treat any of those as a tool failure.
 */
export function getMcpToolFailureMessage(
  result: Pick<AxBiMcpResult, 'error' | 'content' | 'isError' | 'is_error'>
): string | undefined {
  const errorText =
    typeof result.error === 'string' && result.error.trim().length > 0
      ? result.error.trim()
      : undefined
  const flagged = result.isError === true || result.is_error === true
  if (!flagged && !errorText) return undefined
  return (
    errorText ??
    getFirstMcpText(result) ??
    'MCP tool returned an error'
  )
}

export function parseJsonMcpResult<T extends Record<string, unknown>>(
  result: Pick<
    AxBiMcpResult,
    'content' | 'structuredContent' | 'structured_content'
  >
): T | null {
  const structuredContent =
    result.structuredContent ?? result.structured_content
  if (isRecord(structuredContent)) return structuredContent as T

  for (const item of result.content ?? []) {
    if (typeof item.text !== 'string') continue
    try {
      const parsed = JSON.parse(item.text)
      if (isRecord(parsed)) return parsed as T
    } catch {
      // MCP text content may be plain prose. Keep scanning for structured JSON.
    }
  }

  return null
}

export function getFirstMcpText(
  result: Pick<AxBiMcpResult, 'content'>
): string | undefined {
  return result.content
    ?.map((item) => item.text?.trim())
    .find((text): text is string => Boolean(text))
}

export function normalizeMcpResultForToolOutput(
  result: AxBiMcpResult,
  fallbackMessage: string
): AxBiNormalizedResult {
  const failure = getMcpToolFailureMessage(result)
  if (failure) return { error: failure }

  const parsed = parseJsonMcpResult<Record<string, unknown>>(result)
  if (parsed) return parsed

  const text = getFirstMcpText(result)
  return { message: text ?? fallbackMessage }
}

export type AxBiConnectionErrorKind =
  | 'auth'
  | 'timeout'
  | 'address_rejected'
  | 'unreachable'
  | 'unknown'

/**
 * Map raw activation / transport errors to a safe, user-facing taxonomy.
 * Never includes tokens or Authorization header values.
 */
export function classifyAxBiConnectionError(error: unknown): {
  kind: AxBiConnectionErrorKind
  message: string
} {
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : String(error ?? 'Unknown error')
  // Drop anything that looks like a bearer token or auth header value.
  const sanitized = raw
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/Authorization:\s*\S+/gi, 'Authorization: [redacted]')
  const lower = sanitized.toLowerCase()

  if (
    /\b401\b/.test(lower) ||
    /\b403\b/.test(lower) ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('authentication') ||
    lower.includes('invalid token') ||
    lower.includes('invalid api key')
  ) {
    return {
      kind: 'auth',
      message:
        'Authentication failed (401/403). Check your AX BI API key or JWT and try connecting again.',
    }
  }

  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('deadline exceeded')
  ) {
    return {
      kind: 'timeout',
      message:
        'Connection timed out. Ensure AX BI MCP is running and the URL (default http://127.0.0.1:31421/mcp) is correct.',
    }
  }

  if (
    lower.includes('internal/private address') ||
    lower.includes('not allowed') ||
    lower.includes('loopback') ||
    lower.includes('ssrf') ||
    lower.includes('resolves outside loopback')
  ) {
    return {
      kind: 'address_rejected',
      message:
        'Only loopback addresses (127.0.0.1, localhost, ::1) are allowed for AX BI MCP. Use a local URL instead of a LAN or private IP.',
    }
  }

  if (
    lower.includes('failed to connect') ||
    lower.includes('connection refused') ||
    lower.includes('econnrefused') ||
    lower.includes('network') ||
    lower.includes('unreachable') ||
    lower.includes('failed to resolve')
  ) {
    return {
      kind: 'unreachable',
      message:
        'Could not reach AX BI MCP. Ensure the server is running and the URL is correct.',
    }
  }

  return {
    kind: 'unknown',
    message: sanitized || 'Failed to connect to AX BI MCP.',
  }
}
