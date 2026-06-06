import type { ResearchSource } from '@/features/research/hooks/useResearchPanel'
import type { ExaResult, MCPToolCallResult } from './research-types'

/**
 * Parse Exa's plain-text result format:
 *   Title: <t> [Author: <a>] [Published Date: <d>] URL: <u> [Text: <body>]
 */
export function parseExaTextResults(text: string): ResearchSource[] {
  const FIELDS = ['Title', 'Author', 'Published Date', 'URL', 'Text', 'Score', 'ID', 'Highlights', 'Summary']
  const fieldAlt = FIELDS.join('|')
  const fieldRe = new RegExp(`(${fieldAlt}):\\s*([\\s\\S]*?)(?=\\s+(?:${fieldAlt}):|$)`, 'g')

  const results: ResearchSource[] = []
  let current: Record<string, string> = {}
  let inResult = false

  let m: RegExpExecArray | null
  while ((m = fieldRe.exec(text)) !== null) {
    const field = m[1]
    const value = m[2].trim()

    if (field === 'Title') {
      if (inResult && current['URL']) {
        results.push({
          url: current['URL'],
          title: current['Title'] ?? '',
          snippet: (current['Text'] ?? current['Summary'] ?? current['Highlights'] ?? '').slice(0, 300),
        })
      }
      current = { Title: value }
      inResult = true
    } else if (inResult) {
      current[field] = value
    }
  }

  if (inResult && current['URL']) {
    results.push({
      url: current['URL'],
      title: current['Title'] ?? '',
      snippet: (current['Text'] ?? current['Summary'] ?? current['Highlights'] ?? '').slice(0, 300),
    })
  }

  return results.filter((r) => r.url.startsWith('http'))
}

/**
 * Parse Exa search results from an MCP tool call response.
 * Tries JSON first, falls back to Exa's plain-text format.
 */
export function parseExaResults(result: MCPToolCallResult): {
  sources: ResearchSource[]
  debugMsg: string
} {
  if (result.error) {
    return { sources: [], debugMsg: `Exa error: ${result.error}` }
  }

  const text = result.content?.[0]?.text ?? ''
  if (!text) {
    return { sources: [], debugMsg: 'Exa returned empty content' }
  }

  try {
    const parsed = JSON.parse(text)
    const rawResults: ExaResult[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.results)
        ? parsed.results
        : []

    if (rawResults.length > 0) {
      const sources = rawResults
        .map((r) => ({
          url: r.url ?? ((r as unknown) as Record<string, unknown>).id as string ?? '',
          title: r.title ?? r.url ?? '',
          snippet: r.highlights?.[0] ?? r.text?.slice(0, 200) ?? r.snippet ?? '',
          score: r.score,
        }))
        .filter((s) => !!s.url)
      return { sources, debugMsg: `Exa: ${sources.length} results` }
    }
  } catch {
    // Not JSON — fall through to plain-text parser
  }

  const sources = parseExaTextResults(text)
  if (sources.length > 0) {
    return { sources, debugMsg: `Exa: ${sources.length} results` }
  }

  return { sources: [], debugMsg: `Exa: 0 results parsed — raw: ${text.slice(0, 120)}` }
}

export function parsePlan(json: string): string[] {
  try {
    const trimmed = json.trim()
    const match = trimmed.match(/\[[\s\S]*\]/)
    if (match) return JSON.parse(match[0]) as string[]
    return JSON.parse(trimmed) as string[]
  } catch {
    return json
      .split('\n')
      .map((l) => l.replace(/^[\d\-*.)\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 5)
  }
}

export function parseDrillDown(json: string): string[] {
  return parsePlan(json).slice(0, 2)
}
