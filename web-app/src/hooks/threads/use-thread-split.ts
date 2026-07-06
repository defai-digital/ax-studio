/**
 * useThreadSplit — manages split-view state (splitThreadId, splitDirection,
 * splitPaneOrder) and the handleSplit callback.
 */
import { useState, useMemo, useCallback } from 'react'
import { useThreads } from '@/hooks/threads/useThreads'
import { SESSION_STORAGE_KEY } from '@/constants/chat'
import { safeStorageGetItem, safeStorageRemoveItem } from '@/lib/storage/storage'
import { toast } from 'sonner'

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

type StoredSplitViewInfo = {
  direction: 'left' | 'right'
  splitThreadId: string
}

function parseStoredSplitViewInfo(raw: string): StoredSplitViewInfo | null {
  try {
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.direction === 'left' || parsed.direction === 'right') &&
      typeof parsed.splitThreadId === 'string' &&
      parsed.splitThreadId.trim() !== ''
    ) {
      return {
        direction: parsed.direction,
        splitThreadId: parsed.splitThreadId,
      }
    }
  } catch {
    // Ignore malformed session state and let the hook start without split view.
  }

  return null
}

function readAndConsumeSplitViewInfo(): StoredSplitViewInfo | null {
  const stored = safeStorageGetItem(
    sessionStorage,
    SESSION_STORAGE_KEY.SPLIT_VIEW_INFO,
    'useThreadSplit'
  )

  if (!stored) return null

  safeStorageRemoveItem(
    sessionStorage,
    SESSION_STORAGE_KEY.SPLIT_VIEW_INFO,
    'useThreadSplit'
  )

  return parseStoredSplitViewInfo(stored)
}

export function useThreadSplit({ thread, selectedModel, selectedProvider }: Input): ThreadSplitResult {
  const createThread = useThreads((state) => state.createThread)
  const [initialSplitViewInfo] = useState(readAndConsumeSplitViewInfo)

  const [splitDirection, setSplitDirection] = useState<'left' | 'right' | null>(
    () => initialSplitViewInfo?.direction ?? null
  )

  const [splitThreadId, setSplitThreadId] = useState<string | null>(
    () => initialSplitViewInfo?.splitThreadId ?? null
  )

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
      try {
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
      } catch (error) {
        console.error('Failed to create split thread:', error)
        toast.error('Failed to open split view', {
          description: error instanceof Error ? error.message : 'Please try again.',
        })
      }
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
