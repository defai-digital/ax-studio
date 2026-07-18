/**
 * Lazily-built, memory-cached index of per-thread message text for global
 * search. Triggered by the search dialog via `ensureMessageSearchIndex()`;
 * fetches every non-temporary thread's messages in background batches
 * (yielding between batches so typing stays responsive) and concatenates each
 * thread's `type === 'text'` content into a single searchable document.
 *
 * The index is memory-only and marked stale through a fingerprint of the
 * thread list (count + max `thread.updated`); a fingerprint change triggers a
 * rebuild. Fetch failures degrade silently to title-only search — the failed
 * thread simply has no content document. Consumers subscribe with
 * `subscribeMessageSearchIndex` (useSyncExternalStore-compatible) and read the
 * immutable `MessageSearchIndexSnapshot`.
 */

import { ContentType, type ThreadMessage } from '@ax-studio/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useMessages } from '@/hooks/chat/useMessages'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

const BATCH_SIZE = 10

export type MessageSearchIndexStatus = 'idle' | 'indexing' | 'ready'

export type MessageSearchIndexSnapshot = {
  status: MessageSearchIndexStatus
  /** Bumped every time a new set of documents is published. */
  version: number
  /** threadId → concatenated text content. Replaced immutably on rebuild. */
  documents: ReadonlyMap<string, string>
}

let documents: ReadonlyMap<string, string> = new Map()
let status: MessageSearchIndexStatus = 'idle'
let version = 0
let fingerprint: string | null = null
let snapshot: MessageSearchIndexSnapshot = { status, version, documents }
let listeners: Array<() => void> = []
/** Cancels a superseded in-flight build when bumped. */
let buildToken = 0
/** Latest requested build while one is already running. */
let queuedBuild: {
  threads: Record<string, Thread>
  fingerprint: string
} | null = null

const computeFingerprint = (threads: Record<string, Thread>): string => {
  // Count + max(updated) misses replacements and updates below the current
  // maximum. Include every searchable thread revision, sorted so insertion
  // order cannot trigger unnecessary rebuilds.
  return JSON.stringify(
    Object.values(threads)
      .filter((thread) => thread.id !== TEMPORARY_CHAT_ID)
      .map((thread) => [thread.id, thread.updated] as const)
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
  )
}

const extractThreadText = (messages: ThreadMessage[]): string => {
  const parts: string[] = []
  for (const message of messages ?? []) {
    if (!Array.isArray(message?.content)) continue
    for (const contentPart of message.content) {
      if (
        contentPart?.type === ContentType.Text &&
        typeof contentPart.text?.value === 'string'
      ) {
        parts.push(contentPart.text.value)
      }
    }
  }
  return parts.join('\n')
}

const emitChange = () => {
  snapshot = { status, version, documents }
  for (const listener of listeners) {
    listener()
  }
}

const setStatus = (next: MessageSearchIndexStatus) => {
  if (status === next) return
  status = next
  emitChange()
}

const yieldToMainThread = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

const fetchThreadText = async (threadId: string): Promise<string> => {
  // Prefer messages already loaded in the useMessages cache to avoid
  // duplicate fetches for threads the user recently opened.
  const cached = useMessages.getState().messages[threadId]
  const messages =
    cached ?? (await getServiceHub().messages().fetchMessages(threadId))
  return extractThreadText(messages)
}

const startBuild = (
  threads: Record<string, Thread>,
  nextFingerprint: string
): Promise<void> => {
  const token = ++buildToken
  setStatus('indexing')

  const build = async () => {
    const threadList = Object.values(threads).filter(
      (thread) => thread.id !== TEMPORARY_CHAT_ID
    )
    const nextDocuments = new Map<string, string>()

    for (let i = 0; i < threadList.length; i += BATCH_SIZE) {
      if (token !== buildToken) return
      const batch = threadList.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (thread) => {
          try {
            nextDocuments.set(thread.id, await fetchThreadText(thread.id))
          } catch {
            // Silent degradation: this thread stays title-only.
          }
        })
      )
      if (i + BATCH_SIZE < threadList.length) {
        await yieldToMainThread()
      }
    }

    if (token !== buildToken) return
    documents = nextDocuments
    fingerprint = nextFingerprint
    version += 1
    status = 'ready'
    emitChange()
  }

  return build()
    .catch(() => {
      // A catastrophic failure (e.g. the service hub itself threw) still
      // degrades silently: publish whatever was gathered so far.
      if (token !== buildToken) return
      fingerprint = nextFingerprint
      version += 1
      status = 'ready'
      emitChange()
    })
    .then(() => {
      if (token !== buildToken) return
      const queued = queuedBuild
      queuedBuild = null
      if (queued && queued.fingerprint !== fingerprint) {
        return startBuild(queued.threads, queued.fingerprint)
      }
    })
}

/**
 * Ensure the content index matches the given thread list. No-ops when the
 * index is fresh; queues a rebuild when one is already in flight. Returns the
 * in-flight (or immediately resolved) build promise for tests/awaiters.
 */
export function ensureMessageSearchIndex(
  threads: Record<string, Thread>
): Promise<void> {
  const nextFingerprint = computeFingerprint(threads)

  if (status === 'indexing') {
    if (nextFingerprint !== fingerprint) {
      queuedBuild = { threads, fingerprint: nextFingerprint }
    }
    return Promise.resolve()
  }

  if (status === 'ready' && fingerprint === nextFingerprint) {
    return Promise.resolve()
  }

  return startBuild(threads, nextFingerprint)
}

export function subscribeMessageSearchIndex(listener: () => void): () => void {
  listeners = [...listeners, listener]
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

export function getMessageSearchIndexSnapshot(): MessageSearchIndexSnapshot {
  return snapshot
}

export function getMessageSearchContent(threadId: string): string | undefined {
  return documents.get(threadId)
}

/** Test helper: drop the index and cancel any in-flight build. */
export function resetMessageSearchIndex(): void {
  buildToken += 1
  queuedBuild = null
  documents = new Map()
  fingerprint = null
  version = 0
  status = 'idle'
  emitChange()
}
