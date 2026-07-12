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

function firstTextPart(result: unknown): string | undefined {
  const content = (result as FabricToolResult | undefined)?.content
  return content?.find((part) => part?.type === 'text' && part.text)?.text
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
  const text = firstTextPart(result)
  if (text) {
    try {
      const parsed = JSON.parse(text) as { results?: unknown[] }
      return Array.isArray(parsed.results) && parsed.results.length > 0
    } catch {
      // Non-JSON tool/error text is not a structured hit (e.g. "Connection refused").
      return false
    }
  }

  // Multi-part content: only structured JSON with non-empty results counts.
  try {
    const content = (result as FabricToolResult | undefined)?.content
    if (!Array.isArray(content)) return false
    for (const part of content) {
      if (part?.type !== 'text' || typeof part.text !== 'string') continue
      try {
        const parsed = JSON.parse(part.text) as { results?: unknown[] }
        if (Array.isArray(parsed.results) && parsed.results.length > 0) {
          return true
        }
      } catch {
        // keep scanning other parts
      }
    }
  } catch {
    return false
  }
  return false
}

export function parseFabricSearchResults(
  result: unknown
): FabricSearchResult[] {
  const text = firstTextPart(result)
  if (!text) return []

  try {
    const parsed = JSON.parse(text) as { results?: unknown[] }
    if (!Array.isArray(parsed.results)) return []
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
    return []
  }
}
