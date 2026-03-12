import { useCallback } from 'react'
import { generateText, streamText } from 'ai'
import { useResearchPanel, type ResearchSource, type ResearchStep } from './useResearchPanel'
import { useMessages } from './useMessages'
import { useChatSessions } from '@/stores/chat-session-store'
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

export { isExaRateLimitMessage, isExaRateLimitError }

/** Exported for unit testing only — not part of the public hook API. */
export const __researchTestUtils = { isExaRateLimitMessage, isExaRateLimitError }

const MAX_SOURCES = 40

// Module-level map so cancelResearch() works from any hook instance
const activeAbortControllers = new Map<string, AbortController>()

function saveMessageToChat(threadId: string, msg: ThreadMessage) {
  useMessages.getState().addMessage(msg)
  const session = useChatSessions.getState().sessions[threadId]
  if (session) {
    const uiMsg = convertThreadMessageToUIMessage(msg)
    if (uiMsg) {
      session.chat.messages = [...session.chat.messages, uiMsg]
    }
  }
}

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
      const ac = new AbortController()
      activeAbortControllers.set(threadId, ac)
      const signal = ac.signal

      openResearch(threadId, query, depth)

      const depthLabel = depth === 3 ? 'Deep' : 'Standard'
      saveMessageToChat(threadId, {
        ...newUserThreadContent(threadId, `🔍 **Research (${depthLabel}):** ${query}`),
        created_at: Date.now(),
        completed_at: Date.now(),
      })

      resetExaGate()

      const breadth    = depth === 2 ? 3 : 4
      const numResults = depth === 2 ? 5 : 6
      const scrapeTop  = depth === 2 ? 3 : 4
      const allSources: ResearchSource[] = []
      let exaUnavailableForRun = false

      try {
        const model = await buildResearchModel()

        async function researchNode(question: string, currentDepth: number): Promise<string[]> {
          if (signal.aborted) return []

          addStep({ type: 'searching', query: question })

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
                if (isExaRateLimitMessage(debugMsg)) exaUnavailableForRun = true
              } else {
                addStep({ type: 'searching', query: debugMsg })
              }
            } catch (err) {
              if ((err as Error).name === 'AbortError') throw err
              if (isExaRateLimitError(err)) exaUnavailableForRun = true
              usedLLMFallback = true
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
            }

            // Tier 3: Pure LLM knowledge
            addStep({ type: 'summarising', message: `Using model knowledge for: ${question}` })
            try {
              const { text: knowledgeSummary } = await generateText({
                model,
                messages: [{ role: 'user', content: `Provide a detailed, factual summary (≤400 words) answering:\n\n"${question}"\n\nBe specific and informative.` }],
                abortSignal: signal,
              })
              return [`[Model Knowledge]\n${knowledgeSummary}`]
            } catch (err) {
              if ((err as Error).name === 'AbortError') throw err
            }
            return []
          }

          for (const r of results) {
            if (allSources.length < MAX_SOURCES && !allSources.find((s) => normalizeUrl(s.url) === normalizeUrl(r.url))) {
              allSources.push(r)
            }
          }

          addStep({ type: 'scraping', message: `Fetching ${Math.min(results.length, scrapeTop)} pages…` })
          const pages = await Promise.all(
            results.slice(0, scrapeTop).map(async (r) => {
              let text = r.snippet || r.title || ''
              if (depth > 1) {
                const scraped = await scrapeWithTimeout(r.url, signal)
                if (scraped.length > 100) text = scraped
              }
              return { r, text }
            })
          )
          if (signal.aborted) return []

          const validSummaries: string[] = []
          for (const { r, text } of pages) {
            if (signal.aborted) break
            addStep({ type: 'summarising', message: `Summarising: ${r.title || r.url}` })
            try {
              const { text: summary } = await generateText({
                model,
                messages: [{ role: 'user', content: SUMMARISE_PROMPT(question, text) }],
                abortSignal: signal,
              })
              validSummaries.push(`Source: ${r.url}\n${summary}`)
            } catch (err) {
              if ((err as Error).name === 'AbortError') throw err
              validSummaries.push(`Source: ${r.url}\n${text.slice(0, 500)}`)
            }
          }

          if (depth === 3 && currentDepth > 1 && !signal.aborted) {
            try {
              const { text: drillJson } = await generateText({
                model,
                messages: [{ role: 'user', content: DRILL_DOWN_PROMPT(question, validSummaries) }],
                abortSignal: signal,
              })
              const followUps = parseDrillDown(drillJson).slice(0, 1)
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

        addStep({ type: 'planning', message: 'Decomposing query into sub-questions…' })
        const { text: planJson } = await generateText({
          model,
          messages: [{ role: 'user', content: PLANNER_PROMPT(query, breadth) }],
          abortSignal: signal,
        })
        const subQuestions = parsePlan(planJson)

        const ENOUGH_CHARS   = depth === 2 ? 8000 : 12000
        const ENOUGH_SOURCES = depth === 2 ? 5    : 8

        const context: string[] = []
        let completed = 0
        for (const q of subQuestions) {
          if (signal.aborted) break
          const summaries = await researchNode(q, depth)
          context.push(...summaries)
          completed++
          if (completed >= 2) {
            const totalChars = context.reduce((n, s) => n + s.length, 0)
            if (allSources.length >= ENOUGH_SOURCES && totalChars >= ENOUGH_CHARS) {
              addStep({ type: 'searching', query: `Enough info gathered (${allSources.length} sources) — writing report` })
              break
            }
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
        const { textStream } = streamText({
          model,
          messages: [{ role: 'user', content: writerPrompt }],
          maxOutputTokens: 12000,
          abortSignal: signal,
        })
        for await (const chunk of textStream) {
          if (signal.aborted) break
          report += chunk
          updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))
        }

        // Continuation loop — continue mid-sentence cuts (up to 2 rounds)
        for (let round = 0; round < 2 && !signal.aborted; round++) {
          const trimmed = report.trimEnd()
          const lastChar = trimmed[trimmed.length - 1] ?? ''
          if (/[.!?»"')]/.test(lastChar)) break

          addStep({ type: 'writing', message: 'Continuing report…' })
          const continuePrompt =
            `You are continuing a research report that was cut off mid-sentence.\n\n` +
            `Here is where the report stopped:\n---\n${report.slice(-1500)}\n---\n\n` +
            `Continue SEAMLESSLY from exactly where it stopped. ` +
            `Do NOT repeat, rewrite, or summarise anything already written. ` +
            `Do NOT add a preamble — start with the next word that logically continues the cut-off sentence. ` +
            `Write only the remaining body content (no Conclusion section — that will be added separately).`
          const { textStream: contStream } = streamText({
            model,
            messages: [{ role: 'user', content: continuePrompt }],
            maxOutputTokens: 4000,
            abortSignal: signal,
          })
          for await (const chunk of contStream) {
            if (signal.aborted) break
            report += chunk
            updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))
          }
        }

        // Add Conclusion if missing
        const hasConclusion = /^##\s*conclusion/im.test(report)
        if (!hasConclusion && !signal.aborted) {
          addStep({ type: 'writing', message: 'Writing conclusion…' })
          const conclusionPrompt =
            `You are finishing a research report about: "${query}"\n\n` +
            `Here is the end of the report written so far:\n---\n${report.slice(-2500)}\n---\n\n` +
            `Write ONLY the ## Conclusion section (150–200 words). ` +
            `Summarise the key findings and their significance. ` +
            `Do NOT repeat or rewrite anything already written above. ` +
            `Start your response directly with "## Conclusion".`
          const { textStream: conclusionStream } = streamText({
            model,
            messages: [{ role: 'user', content: conclusionPrompt }],
            maxOutputTokens: 800,
            abortSignal: signal,
          })
          for await (const chunk of conclusionStream) {
            if (signal.aborted) break
            report += chunk
            updateResearch(threadId, (prev) => ({ ...prev, reportMarkdown: report }))
          }
        }

        const sourceFooter = allSources.length > 0
          ? '\n\n---\n**Sources:** ' + allSources.map((s, i) => `[[${i + 1}]](${s.url})`).join(' ')
          : ''
        saveMessageToChat(threadId, {
          ...newAssistantThreadContent(threadId, report + sourceFooter, { researchReport: true }),
          created_at: Date.now(),
          completed_at: Date.now(),
        })

        updateResearch(threadId, (prev) => ({
          ...prev,
          status: 'done',
          sources: allSources,
          steps: [...prev.steps, { type: 'done', timestamp: Date.now() }],
        }))
      } catch (err) {
        const isAbort = signal.aborted || (err instanceof Error && err.name === 'AbortError')
        const msg = getErrorMessage(err)
        updateResearch(threadId, (prev) => ({
          ...prev,
          status: isAbort ? 'cancelled' : 'error',
          error: isAbort ? undefined : msg,
          steps: [...prev.steps, { type: 'error', message: isAbort ? 'Cancelled' : msg, timestamp: Date.now() }],
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
