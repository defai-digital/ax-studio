import { useCallback } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'
import { threadCollectionId } from '@/lib/file-registry'

const LOCAL_KNOWLEDGE_TOP_K = 3

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

export function useThreadLocalKnowledge(threadId: string) {
  const serviceHub = useServiceHub()

  const prepareLocalKnowledge = useCallback(
    async (query: string): Promise<string> => {
      const state = useLocalKnowledge.getState()
      const enabled = state.isLocalKnowledgeEnabledForThread(threadId)
      if (!enabled) return ''

      try {
        const result = await serviceHub.mcp().callTool({
          toolName: 'fabric_search',
          arguments: {
            query,
            collection_id: threadCollectionId(threadId),
            top_k: LOCAL_KNOWLEDGE_TOP_K,
            mode: 'hybrid',
          },
        })

        if (result?.error) {
          console.warn('[LocalKnowledge] fabric_search error:', result.error)
          return ''
        }

        const chunks = formatChunks(result)
        if (!chunks) return ''

        return `\n\n## Local Knowledge Mode (ACTIVE)\nAnswer ONLY using the context below from the user's local knowledge base. Do NOT use general training knowledge. If the context does not contain relevant information, say: "I don't have enough information in the knowledge base to answer this question."\n\n### Retrieved Context:\n${chunks}`
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
