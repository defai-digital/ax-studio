import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ulid } from 'ulidx'
import type { ThreadMessage } from '@ax-studio/core'
import { useThreads } from '@/hooks/threads/useThreads'
import { useMessages } from '@/hooks/chat/useMessages'

/**
 * Fork (branch) a conversation into a new thread.
 *
 * Copies every message from the start of the source thread up to and including
 * `uptoMessageId` into a freshly created thread, stamps the fork provenance
 * (`forkedFrom` / `parentThreadId`) so the BranchBanner renders, and navigates
 * to the new thread. The user can then continue the conversation down a
 * different path without disturbing the original.
 *
 * Message copies are seeded through `addMessage`, which updates the store
 * synchronously and persists asynchronously. `use-thread-chat`'s fetch/merge on
 * thread open preserves these local-only copies (and skips overwriting when the
 * backend fetch is still empty), so navigation never races persistence.
 */
export function useForkThread() {
  const navigate = useNavigate()
  const createThread = useThreads((state) => state.createThread)
  const updateThread = useThreads((state) => state.updateThread)
  const addMessage = useMessages((state) => state.addMessage)

  return useCallback(
    async (sourceThreadId: string, uptoMessageId: string) => {
      const sourceThread = useThreads.getState().threads[sourceThreadId]
      if (!sourceThread?.model) return undefined

      const allMessages = useMessages.getState().getMessages(sourceThreadId)
      const cutoff = allMessages.findIndex((m) => m.id === uptoMessageId)
      if (cutoff === -1) return undefined
      const slice = allMessages.slice(0, cutoff + 1)
      if (slice.length === 0) return undefined

      const newThread = await createThread(
        sourceThread.model,
        sourceThread.title,
        sourceThread.assistants?.[0]
      )

      updateThread(newThread.id, {
        metadata: {
          ...(newThread.metadata ?? {}),
          forkedFrom: sourceThread.title || 'parent conversation',
          parentThreadId: sourceThreadId,
        },
      })

      // Preserve original created_at so ordering is retained by the fetch/merge
      // sort; only the id and thread_id change for each copy.
      for (const msg of slice) {
        addMessage({
          ...msg,
          id: ulid(),
          thread_id: newThread.id,
        } as ThreadMessage)
      }

      navigate({
        to: '/threads/$threadId',
        params: { threadId: newThread.id },
      })
      return newThread.id
    },
    [navigate, createThread, updateThread, addMessage]
  )
}
