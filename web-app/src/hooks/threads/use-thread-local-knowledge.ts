import { useCallback } from 'react'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'

export function useThreadLocalKnowledge(threadId: string) {
  const prepareLocalKnowledge = useCallback(async (_query: string): Promise<string> => {
    return ''
  }, [])

  const isEnabled = useLocalKnowledge((state) =>
    state.isLocalKnowledgeEnabledForThread(threadId)
  )

  return { prepareLocalKnowledge, isEnabled }
}
