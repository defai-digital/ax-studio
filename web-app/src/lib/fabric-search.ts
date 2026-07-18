export type FabricToolContentPart = {
  type?: string
  text?: string
}

export type FabricToolResult = {
  content?: FabricToolContentPart[]
}

export type FabricSearchResult = {
  source?: string | null
  content?: string
  score?: number
}

function textParts(result: unknown): string[] {
  try {
    const content = (result as FabricToolResult | undefined)?.content
    if (!Array.isArray(content)) return []
    return content
      .filter(
        (part): part is FabricToolContentPart & { text: string } =>
          part?.type === 'text' && typeof part.text === 'string'
      )
      .map((part) => part.text)
  } catch {
    return []
  }
}

function parseResultsPayload(text: string): FabricSearchResult[] | null {
  try {
    const parsed = JSON.parse(text) as { results?: unknown[] }
    if (!Array.isArray(parsed.results)) return null
    return parsed.results
      .map((item) =>
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null
      )
      .filter(Boolean)
      .map((item) => ({
        source: typeof item?.source === 'string' ? item.source : null,
        content: typeof item?.content === 'string' ? item.content : '',
        score: typeof item?.score === 'number' ? item.score : undefined,
      }))
  } catch {
    return null
  }
}

/** First text part whose body is structured search JSON (may not be part 0). */
function firstSearchResultsPayload(
  result: unknown
): FabricSearchResult[] | null {
  for (const text of textParts(result)) {
    const parsed = parseResultsPayload(text)
    if (parsed) return parsed
  }
  return null
}

export function formatFabricToolText(result: unknown): string {
  try {
    const content = (result as FabricToolResult | undefined)?.content
    if (Array.isArray(content)) {
      return content
        .filter((part) => part?.type === 'text' && part.text)
        .map((part) => part.text!.trim())
        .filter(Boolean)
        .join('\n\n---\n\n')
    }
  } catch {
    // fall through to string fallback
  }
  return typeof result === 'string' ? result : ''
}

export function fabricSearchHasResults(result: unknown): boolean {
  // Scan all text parts — status/error prose often precedes the JSON payload.
  const payload = firstSearchResultsPayload(result)
  return Array.isArray(payload) && payload.length > 0
}

export function parseFabricSearchResults(
  result: unknown
): FabricSearchResult[] {
  return firstSearchResultsPayload(result) ?? []
}
