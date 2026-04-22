import { useCallback } from 'react'
import { generateText, streamText } from 'ai'
import { useResearchPanel, type ResearchSource, type ResearchStep } from '@/hooks/research/useResearchPanel'
import { useMessages } from '@/hooks/chat/useMessages'
import { useChatSessions } from '@/stores/chat-session-store'
import { type CitationSource, type CitationData, computeConfidence } from '@/types/citation-types'
import { convertThreadMessageToUIMessage } from '@/lib/messages'
import type { ThreadMessage } from '@ax-studio/core'
import {
  PLANNER_PROMPT,
  SUMMARISE_PROMPT,
  DRILL_DOWN_PROMPT,
  WRITER_PROMPT,
} from '@/lib/research-prompts'
import { newUserThreadContent, newAssistantThreadContent } from '@/lib/completion'
import {
  exaSearch,
  searchWikipedia,
  normalizeUrl,
  isExaRateLimitMessage,
  isExaRateLimitError,
  resetExaGate,
  getErrorMessage,
} from '@/lib/research/research-search'
import { parseExaResults, parsePlan, parseDrillDown } from '@/lib/research/research-parsers'
import { scrapeWithTimeout } from '@/lib/research/research-scraper'
import { buildResearchModel } from '@/lib/research/research-model'
import { prepareProviderForChat } from '@/lib/chat/model-session'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/models/useModelProvider'

export { isExaRateLimitMessage, isExaRateLimitError }

/** Exported for unit testing only — not part of the public hook API. */
export const __researchTestUtils = { isExaRateLimitMessage, isExaRateLimitError }

const MAX_SOURCES = 40

// Module-level map so cancelResearch() works from any hook instance
const activeAbortControllers = new Map<string, AbortController>()

/** Cancel research for a thread without needing to mount the full useResearch hook. */
export function cancelResearchForThread(threadId: string) {
  activeAbortControllers.get(threadId)?.abort()
}

function saveMessageToChat(threadId: string, msg: ThreadMessage) {
  useMessages.getState().addMessage(msg)
  const uiMsg = convertThreadMessageToUIMessage(msg)
  if (!uiMsg) return
  // Use `setState` so Zustand subscribers are notified. The previous
  // implementation mutated `session.chat.messages` directly, bypassing
  // the store's change tracking — the chat UI would stay stale until
  // some unrelated state update forced a re-render.
  useChatSessions.setState((state) => {
    const session = state.sessions[threadId]
    if (!session) return state
    return {
      sessions: {
        ...state.sessions,
        [threadId]: {
          ...session,
          chat: {
            ...session.chat,
            messages: [...session.chat.messages, uiMsg],
          },
        },
      },
    }
  })
}

export function useResearch(threadId: string) {
  const addStep = useCallback(
    (step: Omit<ResearchStep, 'timestamp'>) => {
      useResearchPanel.getState().updateResearch(threadId, (prev) => ({
        ...prev,
        steps: [...prev.steps, { ...step, timestamp: Date.now() }],
      }))
    },
    [threadId]
  )

  const startResearch = useCallback(
    async (query: string, depth: 1 | 2 | 3) => {
      const ac = new AbortController()
      activeAbortControllers.set(threadId, ac)
      const signal = ac.signal

      useResearchPanel.getState().openResearch(threadId, query, depth)

      const depthLabel = depth === 3 ? 'Deep' : 'Standard'
      saveMessageToChat(threadId, {
        ...newUserThreadContent(threadId, `🔍 **Research (${depthLabel}):** ${query}`),
        created_at: Date.now(),
        completed_at: Date.now(),
      })

      resetExaGate()

      const breadth    = depth === 2 ? 2 : 3
      const numResults = depth === 2 ? 3 : 4
      const scrapeTop  = depth === 2 ? 2 : 3
      const allSources: ResearchSource[] = []
      let exaUnavailableForRun = false

      const flushSources = () => {
        useResearchPanel.getState().updateResearch(threadId, (prev) => ({
          ...prev,
          sources: [...allSources],
        }))
      }

      try {
        // Start the local model if needed (same as chat does via prepareProviderForChat)
        const { selectedModel, selectedProvider, providers } = useModelProvider.getState()
        const providerObj = providers.find((p) => p.provider === selectedProvider)
        if (selectedModel && providerObj) {
          try {
            await prepareProviderForChat(getServiceHub(), providerObj, selectedModel.id)
          } catch {
            // Non-fatal: remote models don't need this; local model may already be loaded
          }
        }

        const model = await buildResearchModel()

        async function researchNode(question: string, currentDepth: number): Promise<string[]> {
          if (signal.aborted) return []

          addStep({ type: 'searching', query: question })

          let results: ResearchSource[] = []
          let usedLLMFallback = false
          if (exaUnavailableForRun) {
            usedLLMFallback = true
            addStep({ type: 'searching', query: 'Exa unavailable (rate-limited earlier) — using fallback' })
          } else {
            try {
              const toolResult = await exaSearch(question, numResults, signal)
              const { sources, debugMsg } = parseExaResults(toolResult)
              results = sources
              if (sources.length === 0) {
                usedLLMFallback = true
                if (isExaRateLimitMessage(debugMsg)) exaUnavailableForRun = true
                addStep({ type: 'searching', query: `Exa: 0 results — ${debugMsg}` })
              } else {
                addStep({ type: 'searching', query: `Exa: ${results.length} results — ${debugMsg}` })
              }
            } catch (err) {
              if (err instanceof Error && err.name === 'AbortError') throw err
              if (isExaRateLimitError(err)) exaUnavailableForRun = true
              usedLLMFallback = true
              addStep({ type: 'searching', query: `Exa failed: ${err instanceof Error ? err.message : String(err)}` })
            }
          }

          if (usedLLMFallback) {
            // Fallback: Wikipedia
            try {
              addStep({ type: 'searching', query: `Wikipedia: ${question}` })
              const wikiResults = await searchWikipedia(question, numResults, signal)
              if (wikiResults.length > 0) {
                addStep({ type: 'searching', query: `Wikipedia: ${wikiResults.length} results` })
                for (const r of wikiResults) {
                  if (allSources.length < MAX_SOURCES && !allSources.find((s) => normalizeUrl(s.url) === normalizeUrl(r.url))) {
                    allSources.push(r)
                  }
                }
                flushSources()
                const wikiSummaries: string[] = []
                const scrapeTasks = wikiResults.map(async (r) => {
                  if (signal.aborted) return null
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
                      maxOutputTokens: 1024,
                      abortSignal: signal,
                    })
                    return `Source: ${r.url}\n${summary}`
                  } catch (err) {
                    if (err instanceof Error && err.name === 'AbortError') throw err
                    return `Source: ${r.url}\n${pageText.slice(0, 500)}`
                  }
                })
                const results = await Promise.all(scrapeTasks)
                wikiSummaries.push(...results.filter(Boolean))
                return wikiSummaries.filter(Boolean)
              }
            } catch (err) {
              if (err instanceof Error && err.name === 'AbortError') throw err
            }

            // Tier 3: Pure LLM knowledge
            addStep({ type: 'summarising', message: `Using model knowledge for: ${question}` })
            try {
              const { text: knowledgeSummary } = await generateText({
                model,
                messages: [{ role: 'user', content: `Provide a detailed, factual summary (≤400 words) answering:\n\n"${question}"\n\nBe specific and informative.` }],
                maxOutputTokens: 1024,
                abortSignal: signal,
              })
              return [`[Model Knowledge]\n${knowledgeSummary}`]
            } catch (err) {
              if (err instanceof Error && err.name === 'AbortError') throw err
            }
            return []
          }

          for (const r of results) {
            if (allSources.length < MAX_SOURCES && !allSources.find((s) => normalizeUrl(s.url) === normalizeUrl(r.url))) {
              allSources.push(r)
            }
          }
          flushSources()

          addStep({ type: 'scraping', message: `Fetching ${Math.min(results.length, scrapeTop)} pages…` })
          const pageResults = await Promise.allSettled(
            results.slice(0, scrapeTop).map(async (r) => {
              let text = r.snippet || r.title || ''
              if (depth > 1) {
                const scraped = await scrapeWithTimeout(r.url, signal)
                if (scraped.length > 100) text = scraped
              }
              return { r, text }
            })
          )
          const pages = pageResults
            .filter((result): result is PromiseFulfilledResult<{ r: typeof results[0]; text: string }> => result.status === 'fulfilled')
            .map((result) => result.value)
          if (signal.aborted) return []

          const validSummaries: string[] = []
          for (const { r, text } of pages) {
            if (signal.aborted) break
            addStep({ type: 'summarising', message: `Summarising: ${r.title || r.url}` })
            try {
              const { text: summary } = await generateText({
                model,
                messages: [{ role: 'user', content: SUMMARISE_PROMPT(question, text) }],
                maxOutputTokens: 1024,
                abortSignal: signal,
              })
              validSummaries.push(`Source: ${r.url}\n${summary}`)
            } catch (err) {
              if (err instanceof Error && err.name === 'AbortError') throw err
              validSummaries.push(`Source: ${r.url}\n${text.slice(0, 500)}`)
            }
          }

          if (depth === 3 && currentDepth > 1 && !signal.aborted) {
            try {
              const { text: drillJson } = await generateText({
                model,
                messages: [{ role: 'user', content: DRILL_DOWN_PROMPT(question, validSummaries) }],
                maxOutputTokens: 512,
                abortSignal: signal,
              })
              const followUps = parseDrillDown(drillJson).slice(0, 1)
              for (const followUp of followUps) {
                if (signal.aborted) break
                const childSummaries = await researchNode(followUp, currentDepth - 1)
                validSummaries.push(...childSummaries)
              }
            } catch (err) {
              if (err instanceof Error && err.name === 'AbortError') throw err
            }
          }

          return validSummaries
        }

        addStep({ type: 'planning', message: 'Decomposing query into sub-questions…' })
        const { text: planJson } = await generateText({
          model,
          messages: [{ role: 'user', content: PLANNER_PROMPT(query, breadth) }],
          maxOutputTokens: 2048,
          abortSignal: signal,
        })
        let subQuestions = parsePlan(planJson)
        // If the model returned nothing parseable, use the query itself
        if (subQuestions.length === 0) {
          subQuestions = [query]
          addStep({ type: 'searching', query: `Planning returned no sub-questions — searching query directly` })
        } else {
          addStep({ type: 'searching', query: `${subQuestions.length} sub-questions: ${subQuestions.slice(0, 2).join(' | ')}…` })
        }

        const ENOUGH_CHARS   = depth === 2 ? 4000 : 6000
        const ENOUGH_SOURCES = depth === 2 ? 3    : 5

        const context: string[] = []
        const MAX_CONCURRENT = 2
        const queue = [...subQuestions]
        const workers = Array.from({ length: Math.min(MAX_CONCURRENT, queue.length) }, async () => {
          while (queue.length > 0) {
            const q = queue.shift()
            if (!q || signal.aborted) break
            const summaries = await researchNode(q, depth)
            context.push(...summaries)
          }
        })
        await Promise.all(workers)

        if (allSources.length >= ENOUGH_SOURCES) {
          const totalChars = context.reduce((n, s) => n + s.length, 0)
          if (totalChars >= ENOUGH_CHARS) {
            addStep({ type: 'searching', query: `Enough info gathered (${allSources.length} sources) — writing report` })
          }
        }

        const numberedContext = context.map((block) => {
          const urlMatch = block.match(/^Source:\s*(https?:\/\/\S+)/)
          if (urlMatch) {
            const url = urlMatch[1]
            const idx = allSources.findIndex((s) => normalizeUrl(s.url) === normalizeUrl(url))
            if (idx >= 0) {
              return block.replace(/^Source:\s*\S+/, `[${idx + 1}] ${allSources[idx].title || url}`)
            }
          }
          return block
        })

        const writerPrompt = WRITER_PROMPT(query, numberedContext, allSources)
        addStep({ type: 'writing', message: 'Writing report…' })
        let report = ''
        let lastReportFlush = 0
        // 800ms throttle — local models stream very fast; too-frequent setState
        // calls cause React "Maximum update depth exceeded"
        const STREAM_THROTTLE_MS = 800
        const { textStream } = streamText({
          model,
          system: 'Output only the final report. Do not include any reasoning, analysis, planning, or thinking steps. Start directly with ## Executive Summary.',
          messages: [{ role: 'user', content: writerPrompt }],
          maxOutputTokens: 12000,
          abortSignal: signal,
        })
        for await (const chunk of textStream) {
          if (signal.aborted) break
          report += chunk
          const now = Date.now()
          if (now - lastReportFlush >= STREAM_THROTTLE_MS) {
            lastReportFlush = now
            useResearchPanel.getState().updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))
          }
        }
        // Final flush to ensure the complete report is shown
        useResearchPanel.getState().updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))

        // Continuation loop — continue mid-sentence cuts (up to 2 rounds)
        for (let round = 0; round < 2 && !signal.aborted; round++) {
          const trimmed = report.trimEnd()
          const lastChar = trimmed[trimmed.length - 1] ?? ''
          if (/[.!?»"')]/.test(lastChar)) break

          addStep({ type: 'writing', message: 'Continuing report…' })
          const continuePrompt =
            `/no_think\nYou are continuing a research report that was cut off mid-sentence.\n\n` +
            `Here is where the report stopped:\n---\n${report.slice(-1500)}\n---\n\n` +
            `Continue SEAMLESSLY from exactly where it stopped. ` +
            `Do NOT repeat, rewrite, or summarise anything already written. ` +
            `Do NOT add a preamble — start with the next word that logically continues the cut-off sentence. ` +
            `Write only the remaining body content (no Conclusion section — that will be added separately).`
          const { textStream: contStream } = streamText({
            model,
            system: 'Output only the continuation text. Do not include any reasoning, analysis, or thinking steps.',
            messages: [{ role: 'user', content: continuePrompt }],
            maxOutputTokens: 4000,
            abortSignal: signal,
          })
          for await (const chunk of contStream) {
            if (signal.aborted) break
            report += chunk
            const now = Date.now()
            if (now - lastReportFlush >= STREAM_THROTTLE_MS) {
              lastReportFlush = now
              useResearchPanel.getState().updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))
            }
          }
          useResearchPanel.getState().updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))
        }

        // Add Conclusion if missing
        const hasConclusion = /^##\s*conclusion/im.test(report)
        if (!hasConclusion && !signal.aborted) {
          addStep({ type: 'writing', message: 'Writing conclusion…' })
          const conclusionPrompt =
            `/no_think\nYou are finishing a research report about: "${query}"\n\n` +
            `Here is the end of the report written so far:\n---\n${report.slice(-2500)}\n---\n\n` +
            `Write ONLY the ## Conclusion section (150–200 words). ` +
            `Summarise the key findings and their significance. ` +
            `Do NOT repeat or rewrite anything already written above. ` +
            `Start your response directly with "## Conclusion".`
          const { textStream: conclusionStream } = streamText({
            model,
            system: 'Output only the ## Conclusion section. Do not include any reasoning, analysis, or thinking steps.',
            messages: [{ role: 'user', content: conclusionPrompt }],
            maxOutputTokens: 800,
            abortSignal: signal,
          })
          for await (const chunk of conclusionStream) {
            if (signal.aborted) break
            report += chunk
            const now = Date.now()
            if (now - lastReportFlush >= STREAM_THROTTLE_MS) {
              lastReportFlush = now
              useResearchPanel.getState().updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))
            }
          }
          useResearchPanel.getState().updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))
        }

        // Strip any leaked thinking/reasoning blocks that reasoning models
        // (e.g. Qwen3, Claude with extended thinking) may output as plain text
        report = report
          .replace(/^[\s\S]*?(##\s*Executive Summary)/m, '$1')
          .trim()

        const sourceFooter = allSources.length > 0
          ? '\n\n---\n**Sources:** ' + allSources.map((s, i) => `[[${i + 1}]](${s.url})`).join(' ')
          : ''

        // Build citation data for the "Show Your Sources" feature
        const citationSources: CitationSource[] = allSources.map((s, i) => ({
          id: `src-${i + 1}`,
          type: 'web' as const,
          url: s.url,
          title: s.title,
          snippet: s.snippet,
          score: s.score,
          retrievedAt: Date.now(),
        }))
        const citationData: CitationData = {
          sources: citationSources,
          confidence: computeConfidence(citationSources),
        }

        saveMessageToChat(threadId, {
          ...newAssistantThreadContent(threadId, report + sourceFooter, {
            researchReport: true,
            citationData,
          }),
          created_at: Date.now(),
          completed_at: Date.now(),
        })

        useResearchPanel.getState().updateResearch(threadId, (prev) => ({
          ...prev,
          status: 'done',
          sources: allSources,
          steps: [...prev.steps, { type: 'done', timestamp: Date.now() }],
        }))

      } catch (err) {
        const isAbort = signal.aborted || (err instanceof Error && err.name === 'AbortError')
        const msg = getErrorMessage(err)
        useResearchPanel.getState().updateResearch(threadId, (prev) => ({
          ...prev,
          status: isAbort ? 'cancelled' : 'error',
          error: isAbort ? undefined : msg,
          steps: [...prev.steps, { type: 'error', message: isAbort ? 'Cancelled' : msg, timestamp: Date.now() }],
        }))
      } finally {
        activeAbortControllers.delete(threadId)
      }
    },
    [threadId, addStep]
  )

  const cancelResearch = useCallback(() => {
    activeAbortControllers.get(threadId)?.abort()
  }, [threadId])

  return { startResearch, cancelResearch }
}
