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
  /** Models bound to [main pane, split pane] while compare mode is active. */
  compareModels: [ThreadModel, ThreadModel] | null
  handleCompare: (modelA: ThreadModel, modelB: ThreadModel) => Promise<void>
  /** Clears split + compare state (used by every "close split view" path). */
  closeSplit: () => void
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
  const updateThread = useThreads((state) => state.updateThread)
  const [initialSplitViewInfo] = useState(readAndConsumeSplitViewInfo)

  const [splitDirection, setSplitDirection] = useState<'left' | 'right' | null>(
    () => initialSplitViewInfo?.direction ?? null
  )

  const [splitThreadId, setSplitThreadId] = useState<string | null>(
    () => initialSplitViewInfo?.splitThreadId ?? null
  )

  const [compareModels, setCompareModels] = useState<
    [ThreadModel, ThreadModel] | null
  >(null)

  const splitPaneOrder = useMemo(() => {
    if (!splitThreadId || !splitDirection) return null
    return splitDirection === 'left' ? ['split', 'main'] : ['main', 'split']
  }, [splitDirection, splitThreadId])

  const handleSplit = useCallback(
    async (direction: 'left' | 'right') => {
      // Plain split view and compare mode are mutually exclusive.
      setCompareModels(null)
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

  const closeSplit = useCallback(() => {
    setCompareModels(null)
    setSplitThreadId(null)
    setSplitDirection(null)
  }, [])

  /**
   * Compare mode: split view where each pane is bound to a different model and
   * a single shared composer dispatches the same prompt to both threads.
   * The main thread is rebound to modelA; the split pane thread is rebound to
   * (or created with) modelB.
   */
  const handleCompare = useCallback(
    async (modelA: ThreadModel, modelB: ThreadModel) => {
      try {
        if (thread?.id) {
          updateThread(thread.id, { model: modelA })
        }
        if (splitThreadId) {
          updateThread(splitThreadId, { model: modelB })
        } else {
          const newThread = await createThread(
            modelB,
            modelB.id,
            thread?.assistants?.[0],
            thread?.metadata?.project
          )
          setSplitThreadId(newThread.id)
        }
        // Main pane stays on the left, compare pane on the right.
        setSplitDirection('right')
        setCompareModels([modelA, modelB])
      } catch (error) {
        console.error('Failed to start compare mode:', error)
        toast.error('Failed to start compare mode', {
          description: error instanceof Error ? error.message : 'Please try again.',
        })
      }
    },
    [
      createThread,
      splitThreadId,
      thread?.assistants,
      thread?.id,
      thread?.metadata?.project,
      updateThread,
    ]
  )

  return {
    splitDirection,
    setSplitDirection,
    splitThreadId,
    setSplitThreadId,
    splitPaneOrder,
    handleSplit,
    compareModels,
    handleCompare,
    closeSplit,
  }
}
