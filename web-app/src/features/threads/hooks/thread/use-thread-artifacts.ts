/**
 * useThreadArtifacts — encapsulates artifact panel state for a thread.
 * Isolated panel state: no dependency on stream internals.
 */
import { useArtifactPanel } from '@/hooks/useArtifactPanel'

export function useThreadArtifacts(threadId: string) {
  const pinnedArtifact = useArtifactPanel((state) => state.pinnedByThread[threadId] ?? null)
  const clearArtifact = useArtifactPanel((state) => state.clearArtifact)
  return { pinnedArtifact, clearArtifact }
}
