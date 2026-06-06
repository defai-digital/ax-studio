/**
 * useThreadResearch — encapsulates research panel state and command parsing for a thread.
 */
import { useCallback } from 'react'
import { useResearchPanel } from '@/features/research/hooks/useResearchPanel'
import { useResearch } from '@/features/research/hooks/useResearch'

/** Parse /research[:mode] prefix into a depth number (2=Standard, 3=Deep). */
function parseResearchDepth(afterCommand: string): 2 | 3 {
  return /^:(deep|3)\b/i.test(afterCommand) ? 3 : 2
}

export function useThreadResearch(threadId: string) {
  const pinnedResearch = useResearchPanel((s) => s.getPinned(threadId))
  const clearResearch = useResearchPanel((s) => s.clearResearch)
  const { startResearch } = useResearch(threadId)

  const handleResearchCommand = useCallback(
    (text: string): boolean => {
      const trimmed = text.trimStart()
      if (!trimmed.toLowerCase().startsWith('/research')) return false
      const afterCommand = trimmed.slice('/research'.length)
      const depth = parseResearchDepth(afterCommand)
      const query = afterCommand.replace(/^:(standard|deep|[123])?\s*/i, '').trim()
      if (query) {
        startResearch(query, depth)
        return true
      }
      return false
    },
    [startResearch]
  )

  return { pinnedResearch, clearResearch, startResearch, handleResearchCommand }
}
