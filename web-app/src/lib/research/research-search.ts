import { invoke } from '@tauri-apps/api/core'
import type { ResearchSource } from '@/hooks/useResearchPanel'
import type { MCPToolCallResult, NativeSearchResult, WikiSearchResult } from './research-types'

/** Thrown when Exa is rate-limited and all retries are exhausted. */
export class ExaRateLimitError extends Error {
  constructor(message = 'Exa rate limit exceeded') {
    super(message)
    this.name = 'ExaRateLimitError'
  }
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isExaRateLimitMessage(message: string): boolean {
  const text = message.toLowerCase()
  return text.includes('429')
    || text.includes('too many requests')
    || (text.includes('rate') && text.includes('limit'))
}

export function isExaRateLimitError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'ExaRateLimitError') return true
  return isExaRateLimitMessage(getErrorMessage(err))
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

/**
 * Sequential Exa gate — only one search runs at a time, with a 1.5 s gap.
 * Reset at the start of each research run so stale chains don't carry over.
 */
let exaGatePromise = Promise.resolve()

export function resetExaGate(): void {
  exaGatePromise = Promise.resolve()
}

export async function exaSearch(
  question: string,
  numResults: number,
  signal?: AbortSignal,
): Promise<MCPToolCallResult> {
  const result = exaGatePromise.then(async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      return await invoke<MCPToolCallResult>('call_tool', {
        toolName: 'web_search_exa',
        serverName: 'exa',
        arguments: { query: question, numResults },
      })
    } catch (err) {
      if (isExaRateLimitMessage(getErrorMessage(err))) {
        throw new ExaRateLimitError(getErrorMessage(err))
      }
      throw err
    }
  })

  exaGatePromise = result.then(
    async () => { await new Promise((r) => setTimeout(r, 1500)) },
    async () => { await new Promise((r) => setTimeout(r, 1500)) }
  )

  return result
}

/**
 * Call the Rust `web_search` command which queries free SearXNG public
 * instances via reqwest. No API key required.
 */
export async function freeWebSearch(
  question: string,
  numResults: number,
  signal?: AbortSignal
): Promise<ResearchSource[]> {
  if (signal?.aborted) return []
  const results = await invoke<NativeSearchResult[]>('web_search', {
    query: question,
    numResults,
  })
  return results.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet }))
}

export async function searchWikipedia(
  question: string,
  numResults: number,
  signal?: AbortSignal
): Promise<ResearchSource[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: question,
    format: 'json',
    origin: '*',
    srlimit: String(Math.min(numResults, 5)),
    srprop: 'snippet',
  })
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal })
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`)
  const data = await res.json() as { query: { search: WikiSearchResult[] } }
  return data.query.search.map((r) => ({
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    title: r.title,
    snippet: r.snippet.replace(/<[^>]*>/g, '').trim(),
  }))
}
