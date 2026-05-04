import { useCallback } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'
import { threadCollectionId } from '@/lib/file-registry'

const LOCAL_KNOWLEDGE_TOP_K = 5

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
  const serviceHub = useServiceHub()

  const prepareLocalKnowledge = useCallback(
    async (query: string): Promise<string> => {
      const state = useLocalKnowledge.getState()
      const enabled = state.isLocalKnowledgeEnabledForThread(threadId)
      if (!enabled) return ''

      try {
        // First try the default global collection (main knowledge base),
        // then fall back to the per-thread collection.
        const result = await serviceHub.mcp().callTool({
          toolName: 'fabric_search',
          arguments: {
            query,
            top_k: LOCAL_KNOWLEDGE_TOP_K,
            mode: 'hybrid',
          },
        })

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

        const chunks = formatChunks(result)
        if (!chunks) return ''

        return buildKnowledgeContext(chunks)
      } catch (err) {
        console.error('[LocalKnowledge] Failed to prepare knowledge context:', err)
        return ''
      }
    },
    [serviceHub, threadId]
  )

  const isEnabled = useLocalKnowledge((state) =>
    state.isLocalKnowledgeEnabledForThread(threadId)
  )

  return { prepareLocalKnowledge, isEnabled }
}
