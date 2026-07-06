import { useSyncExternalStore, useCallback, useMemo } from 'react'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage/storage'

const STORAGE_KEY = 'ax-pinned-threads'
const MAX_PINNED_THREADS = 200

function normalizePinnedThreadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue

    const id = entry.trim()
    if (id === '' || seen.has(id)) continue

    ids.push(id)
    seen.add(id)
    if (ids.length >= MAX_PINNED_THREADS) break
  }

  return ids
}

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
    return normalizePinnedThreadIds(parsed)
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
  pinnedSnapshot = normalizePinnedThreadIds(ids)
  safeStorageSetItem(
    localStorage,
    STORAGE_KEY,
    JSON.stringify(pinnedSnapshot),
    'usePinnedThreads'
  )
  emitChange()
}

export function usePinnedThreads() {
  const pinnedIds = useSyncExternalStore(subscribe, getSnapshot, () => [])

  const togglePin = useCallback((threadId: string) => {
    const normalizedThreadId = threadId.trim()
    if (normalizedThreadId === '') return

    const current = pinnedSnapshot
    const next = current.includes(normalizedThreadId)
      ? current.filter((id) => id !== normalizedThreadId)
      : [...current, normalizedThreadId]
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
