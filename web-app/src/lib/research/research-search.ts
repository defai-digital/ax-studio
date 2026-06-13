import { getServiceHub } from '@/hooks/useServiceHub'
import type { ResearchSource } from '@/hooks/research/useResearchPanel'
import type { MCPToolCallResult, WikiSearchResult } from './research-types'

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
 * Sequential Exa gate — only one search runs at a time, with a 500ms gap.
 * Uses a promise-chain queue so the first caller proceeds immediately while
 * subsequent callers wait in line. Reset at the start of each research run.
 */
let exaQueue: Promise<void> = Promise.resolve()

export function resetExaGate(): void {
  exaQueue = Promise.resolve()
}

const EXA_TIMEOUT_MS = 15_000
const WIKI_TIMEOUT_MS = 10_000

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return promise
  let onAbort: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    onAbort = () => {
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    return await Promise.race([promise, abortPromise])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

async function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined

  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      timer = setTimeout(resolve, ms)
      onAbort = () => {
        if (timer) clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  } finally {
    if (timer) clearTimeout(timer)
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export async function exaSearch(
  question: string,
  numResults: number,
  signal?: AbortSignal,
): Promise<MCPToolCallResult> {
  // Each caller appends to the queue and waits for their turn.
  // The previous tail is what THIS caller waits on; the new tail is what the NEXT caller waits on.
  let unlockNext!: () => void
  const mySlot = new Promise<void>((resolve) => { unlockNext = resolve })
  const waitForTurn = exaQueue
  exaQueue = waitForTurn.catch(() => undefined).then(() => mySlot)

  try {
    await raceWithAbort(waitForTurn, signal)
  } catch (error) {
    unlockNext()
    throw error
  }
  if (signal?.aborted) {
    unlockNext()
    throw new DOMException('Aborted', 'AbortError')
  }

  let exaTimeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      getServiceHub().core().invoke<MCPToolCallResult>('call_tool', {
        toolName: 'web_search_exa',
        serverName: 'exa',
        arguments: { query: question, numResults },
      }),
      new Promise<never>((_, reject) => {
        exaTimeoutId = setTimeout(() => reject(new Error(`Exa timed out after ${EXA_TIMEOUT_MS / 1000}s`)), EXA_TIMEOUT_MS)
      }),
    ])
    return result
  } catch (err) {
    if (isExaRateLimitMessage(getErrorMessage(err))) {
      throw new ExaRateLimitError(getErrorMessage(err))
    }
    throw err
  } finally {
    if (exaTimeoutId) clearTimeout(exaTimeoutId)
    await delayWithAbort(500, signal).catch(() => undefined)
    unlockNext()  // release gate for the next caller
  }
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

  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), WIKI_TIMEOUT_MS)
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal

  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal: combinedSignal })
    if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`)
    const data = await res.json() as { query?: { search?: WikiSearchResult[] } }
    return (data.query?.search ?? []).map((r) => ({
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      title: r.title,
      snippet: r.snippet.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(),
    }))
  } finally {
    clearTimeout(timer)
  }
}
