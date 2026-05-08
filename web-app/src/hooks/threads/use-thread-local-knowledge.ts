import { useCallback } from 'react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'
import { threadCollectionId } from '@/lib/file-registry'

const LOCAL_KNOWLEDGE_TOP_K = 5
const LOCAL_KNOWLEDGE_SEARCH_TIMEOUT_MS = 12_000

type FabricSearchResult = {
  source?: string
  content?: string
}

export type LocalKnowledgeRetrieval = {
  searched: boolean
  extracted: boolean
  source?: string
  error?: string
}

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

function formatChunks(result: unknown): string {
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
  return typeof result === 'string' ? result : ''
}

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

function parseFabricSearchResults(result: unknown): FabricSearchResult[] {
  try {
    const r = result as { content?: Array<{ type?: string; text?: string }> }
    const text = r.content?.find((c) => c?.type === 'text' && c.text)?.text
    if (!text) return []
    const parsed = JSON.parse(text) as { results?: FabricSearchResult[] }
    return Array.isArray(parsed.results) ? parsed.results : []
  } catch {
    return []
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

function isLocalKnowledgeMetaQuestion(query: string): boolean {
  const normalized = query.toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim()
  return (
    /\b(is|was|did)\s+(this|that|the)\s+(answer|response|reply)\s+(from|using|based on)\s+(local knowledge|knowledge base|kb|fabric)\b/.test(normalized) ||
    /\b(from|using|based on)\s+(local knowledge|knowledge base|kb|fabric)\b/.test(normalized) ||
    /\bdid\s+(you|it)\s+(use|call)\s+(fabric|fabric search|local knowledge|knowledge base)\b/.test(normalized)
  )
}

function buildKnowledgeContext(chunks: string): string {
  return `\n\n## Local Knowledge Base (ACTIVE)\nThe following context was retrieved from the user's local knowledge base. Use it to answer the user's question. If the context does not contain relevant information, say so.\n\n### Retrieved Context:\n${chunks}`
}

function buildNoKnowledgeContext(reason: string): string {
  return `\n\n## Local Knowledge Base (ACTIVE)\nThe app searched the user's local knowledge base before sending this message, but no relevant context was retrieved.\n\n### Retrieval Status:\n${reason}\n\n### Instruction:\nAnswer only from the retrieved local-knowledge context. Since no relevant context was retrieved, say: "I could not find relevant information in the knowledge base." Do not invent an answer from general knowledge. Do not write tool calls, Python imports, JSON tool-call markup, or search instructions.`
}

function withLocalKnowledgeTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('Local knowledge search timed out')),
      LOCAL_KNOWLEDGE_SEARCH_TIMEOUT_MS
    )
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

function callFabricSearch(
  serviceHub: ReturnType<typeof getServiceHub>,
  toolArguments: Record<string, unknown>
) {
  return withLocalKnowledgeTimeout(
    serviceHub.mcp().callTool({
      toolName: 'fabric_search',
      serverName: 'ax-studio',
      arguments: toolArguments,
    })
  )
}

function callFabricExtract(
  serviceHub: ReturnType<typeof getServiceHub>,
  filePath: string
) {
  return withLocalKnowledgeTimeout(
    serviceHub.mcp().callTool({
      toolName: 'fabric_extract',
      serverName: 'ax-studio',
      arguments: { file_path: filePath },
    })
  )
}

async function buildContextFromSearchResult(
  serviceHub: ReturnType<typeof getServiceHub>,
  result: unknown
): Promise<{ context: string; retrieval: LocalKnowledgeRetrieval }> {
  const source = parseFabricSearchResults(result)
    .map((item) => item.source)
    .find((value): value is string => Boolean(value))

  if (source) {
    try {
      const extracted = await callFabricExtract(serviceHub, source)
      if (!extracted?.error) {
        const text = extracted.content?.find((part) => part?.text)?.text
        if (text) {
          const parsed = JSON.parse(text) as { text?: string }
          if (parsed.text?.trim()) {
            return {
              context: buildKnowledgeContext(
                JSON.stringify({
                  layer: 'extract',
                  results: [
                    {
                      chunkId: `extract:${source}`,
                      score: 1,
                      source,
                      content: parsed.text,
                      matchedLayers: ['extract'],
                    },
                  ],
                })
              ),
              retrieval: { searched: true, extracted: true, source },
            }
          }
        }
      }
    } catch (error) {
      console.warn('[LocalKnowledge] fabric_extract failed, using search chunks:', error)
    }
  }

  const chunks = formatChunks(result)
  return {
    context: chunks
      ? buildKnowledgeContext(chunks)
      : buildNoKnowledgeContext('The search result did not contain readable text chunks.'),
    retrieval: {
      searched: true,
      extracted: false,
      source,
      error: chunks ? undefined : 'The search result did not contain readable text chunks.',
    },
  }
}

export function useThreadLocalKnowledge(threadId: string) {
  const prepareLocalKnowledge = useCallback(
    async (query: string): Promise<{ context: string; retrieval?: LocalKnowledgeRetrieval }> => {
      const state = useLocalKnowledge.getState()
      const enabled = state.isLocalKnowledgeEnabledForThread(threadId)
      if (!enabled) return { context: '' }
      if (isLocalKnowledgeMetaQuestion(query)) return { context: '' }

      try {
        const serviceHub = getServiceHub()
        let result = await callFabricSearch(serviceHub, {
          query,
          top_k: LOCAL_KNOWLEDGE_TOP_K,
          mode: 'hybrid',
        })

        if (!result?.error && !hasSearchHits(result)) {
          for (const fallbackQuery of buildKeywordFallbackQueries(query)) {
            const fallbackResult = await callFabricSearch(serviceHub, {
              query: fallbackQuery,
              top_k: LOCAL_KNOWLEDGE_TOP_K,
              mode: 'keyword',
              layer: 'raw',
            })
            if (!fallbackResult?.error && hasSearchHits(fallbackResult)) {
              result = fallbackResult
              break
            }
          }
        }

        if (result?.error || !hasSearchHits(result)) {
          const threadResult = await callFabricSearch(serviceHub, {
            query,
            collection_id: threadCollectionId(threadId),
            top_k: LOCAL_KNOWLEDGE_TOP_K,
            mode: 'hybrid',
          })

          if (threadResult?.error) {
            return {
              context: buildNoKnowledgeContext('fabric_search returned an error for both global and thread collections.'),
              retrieval: {
                searched: true,
                extracted: false,
                error: 'fabric_search returned an error for both global and thread collections.',
              },
            }
          }

          const threadChunks = formatChunks(threadResult)
          if (!hasSearchHits(threadResult) || !threadChunks) {
            return {
              context: buildNoKnowledgeContext('No matching documents were found in the local knowledge base.'),
              retrieval: {
                searched: true,
                extracted: false,
                error: 'No matching documents were found in the local knowledge base.',
              },
            }
          }

          return buildContextFromSearchResult(serviceHub, threadResult)
        }

        return buildContextFromSearchResult(serviceHub, result)
      } catch (err) {
        console.error('[LocalKnowledge] Failed to prepare knowledge context:', err)
        return {
          context: buildNoKnowledgeContext('The local knowledge search failed before results could be injected.'),
          retrieval: {
            searched: true,
            extracted: false,
            error: 'The local knowledge search failed before results could be injected.',
          },
        }
      }
    },
    [threadId]
  )

  const isEnabled = useLocalKnowledge((state) =>
    state.isLocalKnowledgeEnabledForThread(threadId)
  )

  return { prepareLocalKnowledge, isEnabled }
}
