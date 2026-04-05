/**
 * useThreadSplit — manages split-view state (splitThreadId, splitDirection,
 * splitPaneOrder) and the handleSplit callback.
 */
import { useState, useMemo, useCallback } from 'react'
import { useThreads } from '@/hooks/threads/useThreads'
import { SESSION_STORAGE_KEY } from '@/constants/chat'

export type ThreadSplitResult = {
  splitDirection: 'left' | 'right' | null
  setSplitDirection: (dir: 'left' | 'right' | null) => void
  splitThreadId: string | null
  setSplitThreadId: (id: string | null) => void
  splitPaneOrder: string[] | null
  handleSplit: (direction: 'left' | 'right') => Promise<void>
}

type Input = {
  thread: Thread | undefined
  selectedModel: Model | undefined
  selectedProvider: string
}

export function useThreadSplit({ thread, selectedModel, selectedProvider }: Input): ThreadSplitResult {
  const createThread = useThreads((state) => state.createThread)

  const [splitDirection, setSplitDirection] = useState<'left' | 'right' | null>(() => {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY.SPLIT_VIEW_INFO)
    if (stored) {
      try {
        const info = JSON.parse(stored) as { splitThreadId: string; direction: 'left' | 'right' }
        return info.direction
      } catch { /* ignore */ }
    }
    return null
  })

  const [splitThreadId, setSplitThreadId] = useState<string | null>(() => {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY.SPLIT_VIEW_INFO)
    if (stored) {
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY.SPLIT_VIEW_INFO)
        const info = JSON.parse(stored) as { splitThreadId: string; direction: 'left' | 'right' }
        return info.splitThreadId
      } catch { /* ignore */ }
    }
    return null
  })

  const splitPaneOrder = useMemo(() => {
    if (!splitThreadId || !splitDirection) return null
    return splitDirection === 'left' ? ['split', 'main'] : ['main', 'split']
  }, [splitDirection, splitThreadId])

  const handleSplit = useCallback(
    async (direction: 'left' | 'right') => {
      if (splitThreadId) {
        setSplitDirection(direction)
        return
      }
      const newThread = await createThread(
        {
          id: thread?.model?.id ?? selectedModel?.id ?? '*',
          provider: thread?.model?.provider ?? selectedProvider,
        },
        'New Thread',
        thread?.assistants?.[0],
        thread?.metadata?.project
      )
      setSplitThreadId(newThread.id)
      setSplitDirection(direction)
    },
    [
      createThread,
      selectedModel?.id,
      selectedProvider,
      splitThreadId,
      thread?.assistants,
      thread?.metadata?.project,
      thread?.model?.id,
      thread?.model?.provider,
    ]
  )

  return { splitDirection, setSplitDirection, splitThreadId, setSplitThreadId, splitPaneOrder, handleSplit }
}
