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
