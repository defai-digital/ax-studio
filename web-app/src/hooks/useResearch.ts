import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { generateText, streamText } from 'ai'
import { useResearchPanel, type ResearchSource, type ResearchStep } from './useResearchPanel'
import { useMessages } from './useMessages'
import { useModelProvider } from './useModelProvider'
import { ModelFactory } from '@/lib/model-factory'
import { newUserThreadContent, newAssistantThreadContent } from '@/lib/completion'
import {
  PLANNER_PROMPT,
  SUMMARISE_PROMPT,
  DRILL_DOWN_PROMPT,
  WRITER_PROMPT,
} from '@/lib/research-prompts'

// ---------------------------------------------------------------------------
// Exa result types
// ---------------------------------------------------------------------------

interface ExaResult {
  id?: string
  url: string
  title?: string
  text?: string
  snippet?: string
  highlights?: string[]
  score?: number
  publishedDate?: string
  author?: string
}

interface MCPContent {
  type?: string
  text: string
}

interface MCPToolCallResult {
  error: string
  content: MCPContent[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_SOURCES = 40

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

/** Thrown when Exa is rate-limited and all retries are exhausted. */
class ExaRateLimitError extends Error {
  constructor(message = 'Exa rate limit exceeded') {
    super(message)
    this.name = 'ExaRateLimitError'
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isExaRateLimitMessage(message: string): boolean {
  const text = message.toLowerCase()
  return text.includes('429')
    || text.includes('too many requests')
    || (text.includes('rate') && text.includes('limit'))
}

function isExaRateLimitError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'ExaRateLimitError') return true
  return isExaRateLimitMessage(getErrorMessage(err))
}

/**
 * Sequential Exa gate — only one search runs at a time, with a 1.5 s gap.
 * Reset at the start of each research run so stale chains don't carry over.
 * On any 429, throws ExaRateLimitError immediately (no retries) so the
 * caller can fall back to DuckDuckGo without delay.
 */
let exaGatePromise = Promise.resolve()

async function exaSearch(
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

  // Chain next call AFTER this result + 1.5 s gap
  exaGatePromise = result.then(
    async () => { await new Promise((r) => setTimeout(r, 1500)) },
    async () => { await new Promise((r) => setTimeout(r, 1500)) }
  )

  return result
}

// Module-level map so cancelResearch() works from any hook instance
const activeAbortControllers = new Map<string, AbortController>()

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/**
 * Parse Exa's plain-text result format:
 *   Title: <t> [Author: <a>] [Published Date: <d>] URL: <u> [Text: <body>]
 * Multiple results are separated by newlines or concatenated inline.
 */
function parseExaTextResults(text: string): ResearchSource[] {
  // Known field names used by the Exa MCP text format
  const FIELDS = ['Title', 'Author', 'Published Date', 'URL', 'Text', 'Score', 'ID', 'Highlights', 'Summary']
  const fieldAlt = FIELDS.join('|')

  // Matches "FieldName: <value>" where value stops at the next field label or end
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

  // Flush last result
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
 * Returns both the parsed sources and a debug message for the progress feed.
 */
function parseExaResults(result: MCPToolCallResult): {
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

  // --- Try JSON (some Exa configurations return JSON) ---
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
          url: r.url ?? (r as Record<string, unknown>).id as string ?? '',
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

  // --- Plain-text format: "Title: X URL: Y Text: Z" ---
  const sources = parseExaTextResults(text)
  if (sources.length > 0) {
    return { sources, debugMsg: `Exa: ${sources.length} results` }
  }

  return { sources: [], debugMsg: `Exa: 0 results parsed — raw: ${text.slice(0, 120)}` }
}

function parsePlan(json: string): string[] {
  try {
    const trimmed = json.trim()
    // Find JSON array in case model wraps it in text
    const match = trimmed.match(/\[[\s\S]*\]/)
    if (match) return JSON.parse(match[0]) as string[]
    return JSON.parse(trimmed) as string[]
  } catch {
    // Fallback: split by newline and clean up
    return json
      .split('\n')
      .map((l) => l.replace(/^[\d\-*.)\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 5)
  }
}

function parseDrillDown(json: string): string[] {
  const result = parsePlan(json)
  return result.slice(0, 2)
}

export const __researchTestUtils = {
  isExaRateLimitError,
  isExaRateLimitMessage,
}

// ---------------------------------------------------------------------------
// Free web search via SearXNG (Rust backend — no CORS, no API key)
// ---------------------------------------------------------------------------

interface NativeSearchResult {
  url: string
  title: string
  snippet: string
}

/**
 * Call the Rust `web_search` command which queries free SearXNG public
 * instances via reqwest. No API key required.
 */
async function freeWebSearch(
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

// ---------------------------------------------------------------------------
// Wikipedia search — free, no API key, CORS-enabled
// ---------------------------------------------------------------------------

interface WikiSearchResult {
  title: string
  snippet: string
  pageid: number
}

async function searchWikipedia(
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

// ---------------------------------------------------------------------------
// Scrape with a JS-side timeout so a hung Rust call never blocks forever
// ---------------------------------------------------------------------------

async function scrapeWithTimeout(url: string, signal: AbortSignal, ms = 8000): Promise<string> {
  if (signal.aborted) return ''
  return Promise.race([
    invoke<string>('scrape_url', { url }),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('scrape timeout')), ms)
    ),
  ]).catch(() => '')
}

// ---------------------------------------------------------------------------
// Build model from current selection
// ---------------------------------------------------------------------------

async function buildModel() {
  const { selectedModel, selectedProvider, providers } = useModelProvider.getState()
  const providerObj = providers.find((p) => p.provider === selectedProvider)
  if (!selectedModel || !providerObj) {
    throw new Error('No model selected. Please select a model in Settings → Models.')
  }
  return ModelFactory.createModel(selectedModel.id, providerObj, {})
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useResearch(threadId: string) {
  const updateResearch = useResearchPanel((s) => s.updateResearch)
  const openResearch = useResearchPanel((s) => s.openResearch)

  const addStep = useCallback(
    (step: Omit<ResearchStep, 'timestamp'>) => {
      updateResearch(threadId, (prev) => ({
        ...prev,
        steps: [...prev.steps, { ...step, timestamp: Date.now() }],
      }))
    },
    [threadId, updateResearch]
  )

  const startResearch = useCallback(
    async (query: string, depth: 1 | 2 | 3) => {
      // Store in module-level map so cancelResearch() from any hook instance works
      const ac = new AbortController()
      activeAbortControllers.set(threadId, ac)
      const signal = ac.signal

      openResearch(threadId, query, depth)

      // Save user query to chat history so the thread records what was researched
      const depthLabel = depth === 3 ? 'Deep' : 'Standard'
      useMessages.getState().addMessage({
        ...newUserThreadContent(threadId, `🔍 **Research (${depthLabel}):** ${query}`),
        created_at: Date.now(),
        completed_at: Date.now(),
      })

      // Reset the sequential gate so stale chains from a previous run don't delay us
      exaGatePromise = Promise.resolve()

      // breadth = number of top-level sub-questions
      // numResults = results fetched per search call
      const breadth = depth === 1 ? 4 : depth === 2 ? 5 : 6
      const numResults = depth === 1 ? 6 : depth === 2 ? 8 : 10
      const allSources: ResearchSource[] = []
      let exaUnavailableForRun = false

      try {
        const model = await buildModel()

        // ----------------------------------------------------------------
        // Inner: research a single question (recursive)
        // ----------------------------------------------------------------
        async function researchNode(question: string, currentDepth: number): Promise<string[]> {
          if (signal.aborted) return []

          addStep({ type: 'searching', query: question })

          // 1. Exa search — falls back to LLM knowledge if rate-limited
          let results: ResearchSource[] = []
          let usedLLMFallback = false
          if (exaUnavailableForRun) {
            usedLLMFallback = true
          } else {
            try {
              const toolResult = await exaSearch(question, numResults, signal)
              const { sources, debugMsg } = parseExaResults(toolResult)
              results = sources
              if (sources.length === 0) {
                usedLLMFallback = true
                if (isExaRateLimitMessage(debugMsg)) {
                  exaUnavailableForRun = true
                }
              } else {
                addStep({ type: 'searching', query: debugMsg })
              }
            } catch (err) {
              if ((err as Error).name === 'AbortError') throw err
              if (isExaRateLimitError(err)) {
                exaUnavailableForRun = true
              }
              usedLLMFallback = true
            }
          }

          // Fallback chain: SearXNG (free) → Wikipedia → LLM knowledge
          if (usedLLMFallback) {
            // --- Tier 1: SearXNG via Rust backend (no API key, no CORS) ---
            let freeSources: ResearchSource[] = []
            try {
              addStep({ type: 'searching', query: `DuckDuckGo: ${question}` })
              freeSources = await freeWebSearch(question, numResults, signal)
            } catch (err) {
              if ((err as Error).name === 'AbortError') throw err
              // SearXNG failed — continue to Wikipedia
            }

            if (freeSources.length > 0) {
              addStep({ type: 'searching', query: `DuckDuckGo: ${freeSources.length} results` })
              for (const r of freeSources) {
                if (
                  allSources.length < MAX_SOURCES &&
                  !allSources.find((s) => normalizeUrl(s.url) === normalizeUrl(r.url))
                ) {
                  allSources.push(r)
                }
              }
              const freeSummaries: string[] = []
              for (const r of freeSources) {
                if (signal.aborted) break
                addStep({ type: 'scraping', message: `Scraping: ${r.title || r.url}` })
                let pageText = r.snippet || r.title || ''
                if (depth > 1) {
                  const scraped = await scrapeWithTimeout(r.url, signal)
                  if (scraped.length > 100) pageText = scraped
                }
                addStep({ type: 'summarising', message: `Summarising: ${r.title || r.url}` })
                try {
                  const { text: summary } = await generateText({
                    model,
                    messages: [{ role: 'user', content: SUMMARISE_PROMPT(question, pageText) }],
                    abortSignal: signal,
                  })
                  freeSummaries.push(`Source: ${r.url}\n${summary}`)
                } catch (err) {
                  if ((err as Error).name === 'AbortError') throw err
                  freeSummaries.push(`Source: ${r.url}\n${pageText.slice(0, 500)}`)
                }
              }
              return freeSummaries.filter(Boolean)
            }

            // --- Tier 2: Wikipedia ---
            try {
              addStep({ type: 'searching', query: `Wikipedia: ${question}` })
              const wikiResults = await searchWikipedia(
                question,
                numResults,
                signal
              )
              if (wikiResults.length > 0) {
                addStep({ type: 'searching', query: `Wikipedia: ${wikiResults.length} results` })
                for (const r of wikiResults) {
                  if (
                    allSources.length < MAX_SOURCES &&
                    !allSources.find((s) => normalizeUrl(s.url) === normalizeUrl(r.url))
                  ) {
                    allSources.push(r)
                  }
                }
                const wikiSummaries: string[] = []
                for (const r of wikiResults) {
                  if (signal.aborted) break
                  addStep({ type: 'scraping', message: `Scraping: ${r.title}` })
                  let pageText = r.snippet
                  if (depth > 1) {
                    const scraped = await scrapeWithTimeout(r.url, signal)
                    if (scraped.length > 100) pageText = scraped
                  }
                  addStep({ type: 'summarising', message: `Summarising: ${r.title}` })
                  try {
                    const { text: summary } = await generateText({
                      model,
                      messages: [{ role: 'user', content: SUMMARISE_PROMPT(question, pageText) }],
                      abortSignal: signal,
                    })
                    wikiSummaries.push(`Source: ${r.url}\n${summary}`)
                  } catch (err) {
                    if ((err as Error).name === 'AbortError') throw err
                    wikiSummaries.push(`Source: ${r.url}\n${pageText.slice(0, 500)}`)
                  }
                }
                return wikiSummaries.filter(Boolean)
              }
            } catch (err) {
              if ((err as Error).name === 'AbortError') throw err
              // Wikipedia failed — fall through to LLM-only
            }

            // --- Tier 3: Pure LLM knowledge ---
            addStep({ type: 'summarising', message: `Using model knowledge for: ${question}` })
            try {
              const { text: knowledgeSummary } = await generateText({
                model,
                messages: [{
                  role: 'user',
                  content: `Provide a detailed, factual summary (≤400 words) answering:\n\n"${question}"\n\nBe specific and informative.`,
                }],
                abortSignal: signal,
              })
              return [`[Model Knowledge]\n${knowledgeSummary}`]
            } catch (err) {
              if ((err as Error).name === 'AbortError') throw err
            }
            return []
          }

          // 2. Track sources (deduped + capped) + summarise ALL results in parallel
          for (const r of results) {
            if (
              allSources.length < MAX_SOURCES &&
              !allSources.find((s) => normalizeUrl(s.url) === normalizeUrl(r.url))
            ) {
              allSources.push(r)
            }
          }

          const validSummaries: string[] = []
          for (const r of results) {
            if (signal.aborted) break
            addStep({ type: 'scraping', message: `Scraping: ${r.title || r.url}` })
            let pageText = r.snippet || r.title || ''
            if (depth > 1) {
              const scraped = await scrapeWithTimeout(r.url, signal)
              if (scraped.length > 100) pageText = scraped
            }
            addStep({ type: 'summarising', message: `Summarising: ${r.title || r.url}` })
            try {
              const { text: summary } = await generateText({
                model,
                messages: [{ role: 'user', content: SUMMARISE_PROMPT(question, pageText) }],
                abortSignal: signal,
              })
              validSummaries.push(`Source: ${r.url}\n${summary}`)
            } catch (err) {
              if ((err as Error).name === 'AbortError') throw err
              validSummaries.push(`Source: ${r.url}\n${pageText.slice(0, 500)}`)
            }
          }

          // 3. Drill down with 2 follow-up questions for deeper coverage
          if (currentDepth > 1 && !signal.aborted) {
            try {
              const { text: drillJson } = await generateText({
                model,
                messages: [{ role: 'user', content: DRILL_DOWN_PROMPT(question, validSummaries) }],
                abortSignal: signal,
              })
              const followUps = parseDrillDown(drillJson) // up to 2 follow-ups
              for (const followUp of followUps) {
                if (signal.aborted) break
                const childSummaries = await researchNode(followUp, currentDepth - 1)
                validSummaries.push(...childSummaries)
              }
            } catch (err) {
              if ((err as Error).name === 'AbortError') throw err
            }
          }

          return validSummaries
        }

        // ----------------------------------------------------------------
        // Plan phase
        // ----------------------------------------------------------------
        addStep({ type: 'planning', message: 'Decomposing query into sub-questions…' })
        const { text: planJson } = await generateText({
          model,
          messages: [{ role: 'user', content: PLANNER_PROMPT(query, breadth) }],
          abortSignal: signal,
        })
        const subQuestions = parsePlan(planJson)

        // ----------------------------------------------------------------
        // Research phase — sequential to stay within Exa rate limits
        // ----------------------------------------------------------------
        const context: string[] = []
        for (const q of subQuestions) {
          if (signal.aborted) break
          const summaries = await researchNode(q, depth)
          context.push(...summaries)
        }

        // ----------------------------------------------------------------
        // Pre-label context blocks with [N] so the writer can cite directly
        // ----------------------------------------------------------------
        const numberedContext = context.map((block) => {
          const urlMatch = block.match(/^Source:\s*(https?:\/\/\S+)/)
          if (urlMatch) {
            const url = urlMatch[1]
            const idx = allSources.findIndex(
              (s) => normalizeUrl(s.url) === normalizeUrl(url)
            )
            if (idx >= 0) {
              return block.replace(/^Source:\s*\S+/, `[${idx + 1}] ${allSources[idx].title || url}`)
            }
          }
          return block
        })

        // ----------------------------------------------------------------
        // Write report (streaming) — with automatic continuation if cut off
        // ----------------------------------------------------------------
        const writerPrompt = WRITER_PROMPT(query, numberedContext, allSources)

        addStep({ type: 'writing', message: 'Writing report…' })
        let report = ''
        const { textStream } = streamText({
          model,
          messages: [{ role: 'user', content: writerPrompt }],
          maxTokens: 6000,
          abortSignal: signal,
        })
        for await (const chunk of textStream) {
          if (signal.aborted) break
          report += chunk
          updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))
        }

        // If the report has no Conclusion, the model was cut off — continue writing
        const hasConclusion = /^##\s*conclusion/im.test(report)
        if (!hasConclusion && !signal.aborted) {
          addStep({ type: 'writing', message: 'Completing report…' })
          const { textStream: continueStream } = streamText({
            model,
            messages: [
              { role: 'user', content: writerPrompt },
              { role: 'assistant', content: report },
              {
                role: 'user',
                content:
                  'The report was cut off. Continue exactly from where it stopped and complete all remaining sections, finishing with a full ## Conclusion.',
              },
            ],
            maxTokens: 4000,
            abortSignal: signal,
          })
          for await (const chunk of continueStream) {
            if (signal.aborted) break
            report += chunk
            updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))
          }
        }

        // ----------------------------------------------------------------
        // Save report to chat history
        // ----------------------------------------------------------------
        const sourceFooter = allSources.length > 0
          ? '\n\n---\n**Sources:** ' + allSources.map((s, i) => `[[${i + 1}]](${s.url})`).join(' ')
          : ''
        useMessages.getState().addMessage({
          ...newAssistantThreadContent(threadId, report + sourceFooter, { researchReport: true }),
          created_at: Date.now(),
          completed_at: Date.now(),
        })

        // ----------------------------------------------------------------
        // Done
        // ----------------------------------------------------------------
        updateResearch(threadId, (prev) => ({
          ...prev,
          status: 'done',
          sources: allSources,
          steps: [...prev.steps, { type: 'done', timestamp: Date.now() }],
        }))
      } catch (err) {
        const isAbort =
          signal.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        const msg = err instanceof Error ? err.message : String(err)
        updateResearch(threadId, (prev) => ({
          ...prev,
          status: isAbort ? 'cancelled' : 'error',
          error: isAbort ? undefined : msg,
          steps: [
            ...prev.steps,
            {
              type: 'error',
              message: isAbort ? 'Cancelled' : msg,
              timestamp: Date.now(),
            },
          ],
        }))
      } finally {
        activeAbortControllers.delete(threadId)
      }
    },
    [threadId, openResearch, updateResearch, addStep]
  )

  const cancelResearch = useCallback(() => {
    activeAbortControllers.get(threadId)?.abort()
  }, [threadId])

  return { startResearch, cancelResearch }
}
