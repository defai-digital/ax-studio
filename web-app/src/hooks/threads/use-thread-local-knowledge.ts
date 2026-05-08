import { useCallback } from 'react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'
import { threadCollectionId } from '@/lib/file-registry'

const LOCAL_KNOWLEDGE_TOP_K = 5

const KEYWORD_STOP_WORDS = new Set([
  'what',
  'which',
  'three',
  'listed',
  'under',
  'your',
  'their',
  'about',
  'author',
  'outcome',
  'achieve',
  'achieved',
])

function hasSearchHits(result: unknown): boolean {
  try {
    const r = result as { content?: Array<{ type?: string; text?: string }> }
    const text = r.content?.find((c) => c?.type === 'text' && c.text)?.text
    if (!text) return false
    const parsed = JSON.parse(text) as { results?: unknown[] }
    return Array.isArray(parsed.results) && parsed.results.length > 0
  } catch {
    const text = formatChunks(result)
    return Boolean(text) && !text.includes('"results":[]')
  }
}

function pushUnique(values: string[], value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized && !values.includes(normalized)) values.push(normalized)
}

function buildKeywordFallbackQueries(query: string): string[] {
  const queries: string[] = []
  pushUnique(queries, query)

  const quoted = query.match(/"([^"]+)"/g) ?? []
  for (const value of quoted) {
    pushUnique(queries, value.replace(/"/g, ''))
  }

  const titleMatches = query.match(/\b[A-Z][\w-]*(?:\s+[A-Z][\w-]*){1,7}\b/g) ?? []
  for (const title of titleMatches.sort((a, b) => b.length - a.length).slice(0, 2)) {
    pushUnique(queries, title)
    if (/\b(hir\w*|job|role|outcome|result)\b/i.test(query)) {
      pushUnique(queries, `${title} hired`)
    }
  }

  const significantTerms = query
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 3 && !KEYWORD_STOP_WORDS.has(term.toLowerCase()))
    .slice(0, 8)
    .join(' ')
  pushUnique(queries, significantTerms)

  return queries
}

function formatChunks(result: unknown): string {
  // MCP tool result is typically { content: Array<{ type: string; text: string }> }
  try {
    const r = result as { content?: Array<{ type?: string; text?: string }> }
    if (Array.isArray(r?.content)) {
      return r.content
        .filter((c) => c?.type === 'text' && c.text)
        .map((c) => c.text!.trim())
        .filter(Boolean)
        .join('\n\n---\n\n')
    }
  } catch {
    // fall through
  }
  if (typeof result === 'string') return result
  return ''
}

function buildKnowledgeContext(chunks: string): string {
  return `\n\n## Local Knowledge Base (ACTIVE)\nThe following context was retrieved from the user's local knowledge base. Use it to answer the user's question. If the context does not contain relevant information, say so.\n\n### Retrieved Context:\n${chunks}`
}

export function useThreadLocalKnowledge(threadId: string) {
  const prepareLocalKnowledge = useCallback(
    async (query: string): Promise<string> => {
      const state = useLocalKnowledge.getState()
      const enabled = state.isLocalKnowledgeEnabledForThread(threadId)
      if (!enabled) return ''

      try {
        const serviceHub = getServiceHub()
        // First try the default global collection (main knowledge base),
        // then fall back to the per-thread collection.
        let result = await serviceHub.mcp().callTool({
          toolName: 'fabric_search',
          arguments: {
            query,
            top_k: LOCAL_KNOWLEDGE_TOP_K,
            mode: 'hybrid',
          },
        })

        if (!result?.error && !hasSearchHits(result)) {
          for (const fallbackQuery of buildKeywordFallbackQueries(query)) {
            const fallbackResult = await serviceHub.mcp().callTool({
              toolName: 'fabric_search',
              arguments: {
                query: fallbackQuery,
                top_k: LOCAL_KNOWLEDGE_TOP_K,
                mode: 'keyword',
                layer: 'raw',
              },
            })
            if (!fallbackResult?.error && hasSearchHits(fallbackResult)) {
              result = fallbackResult
              break
            }
          }
        }

        if (result?.error) {
          // Fallback: try per-thread collection
          const threadResult = await serviceHub.mcp().callTool({
            toolName: 'fabric_search',
            arguments: {
              query,
              collection_id: threadCollectionId(threadId),
              top_k: LOCAL_KNOWLEDGE_TOP_K,
              mode: 'hybrid',
            },
          })

          if (threadResult?.error) return ''

          const threadChunks = formatChunks(threadResult)
          if (!threadChunks) return ''

          return buildKnowledgeContext(threadChunks)
        }

        if (!hasSearchHits(result)) return ''

        const chunks = formatChunks(result)
        if (!chunks) return ''

        return buildKnowledgeContext(chunks)
      } catch (err) {
        console.error('[LocalKnowledge] Failed to prepare knowledge context:', err)
        return ''
      }
    },
    [threadId]
  )

  const isEnabled = useLocalKnowledge((state) =>
    state.isLocalKnowledgeEnabledForThread(threadId)
  )

  return { prepareLocalKnowledge, isEnabled }
}
