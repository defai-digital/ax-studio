import { useSyncExternalStore, useCallback, useMemo } from 'react'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage'

const STORAGE_KEY = 'ax-pinned-threads'

// Module-level state with subscriber pattern
let listeners: Array<() => void> = []
let pinnedSnapshot: string[] = (() => {
  try {
    const stored = safeStorageGetItem(
      localStorage,
      STORAGE_KEY,
      'usePinnedThreads'
    )
    const parsed = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')
      ? parsed
      : []
  } catch {
    return []
  }
})()

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(callback: () => void) {
  listeners = [...listeners, callback]
  return () => {
    listeners = listeners.filter((l) => l !== callback)
  }
}

function getSnapshot() {
  return pinnedSnapshot
}

function persist(ids: string[]) {
  pinnedSnapshot = ids
  safeStorageSetItem(
    localStorage,
    STORAGE_KEY,
    JSON.stringify(ids),
    'usePinnedThreads'
  )
  emitChange()
}

export function usePinnedThreads() {
  const pinnedIds = useSyncExternalStore(subscribe, getSnapshot, () => [])

  const togglePin = useCallback((threadId: string) => {
    const current = pinnedSnapshot
    const next = current.includes(threadId)
      ? current.filter((id) => id !== threadId)
      : [...current, threadId]
    persist(next)
  }, [])

  const isPinned = useCallback(
    (threadId: string) => pinnedIds.includes(threadId),
    [pinnedIds],
  )

  const reorder = useCallback((newOrder: string[]) => {
    persist(newOrder)
  }, [])

  // Memoize the Set so consumers that depend on its identity (e.g.
  // `useMemo(() => expensive, [pinnedSet])`) don't re-run on every
  // unrelated render.
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])

  return { pinnedIds, pinnedSet, togglePin, isPinned, reorder }
}
