import { create } from 'zustand'

import { Attachment } from '@/types/attachment'
import { getAttachmentIdentity } from '@/lib/attachments/dedupe'

export const NEW_THREAD_ATTACHMENT_KEY = '__new-thread__'

const EMPTY_ATTACHMENTS: Attachment[] = []

const getOwnAttachments = (
  attachmentsByThread: Record<string, Attachment[]>,
  threadId: string
): Attachment[] | undefined => {
  if (!Object.prototype.hasOwnProperty.call(attachmentsByThread, threadId)) {
    return undefined
  }

  const attachments = attachmentsByThread[threadId]
  return Array.isArray(attachments) ? attachments : undefined
}

type AttachmentStore = {
  attachmentsByThread: Record<string, Attachment[]>
  getAttachments: (threadId?: string) => Attachment[]
  setAttachments: (
    threadId: string,
    updater: Attachment[] | ((prev: Attachment[]) => Attachment[])
  ) => void
  clearAttachments: (threadId: string) => void
  transferAttachments: (fromKey: string, toKey: string) => void
}

export const useChatAttachments = create<AttachmentStore>()((set, get) => ({
  attachmentsByThread: {},
  getAttachments: (threadId = NEW_THREAD_ATTACHMENT_KEY) => {
    return (
      getOwnAttachments(get().attachmentsByThread, threadId) ??
      EMPTY_ATTACHMENTS
    )
  },
  setAttachments: (threadId, updater) => {
    set((state) => {
      const current =
        getOwnAttachments(state.attachmentsByThread, threadId) ?? []
      const next = typeof updater === 'function' ? updater(current) : updater
      return {
        attachmentsByThread: {
          ...state.attachmentsByThread,
          [threadId]: next,
        },
      }
    })
  },
  clearAttachments: (threadId) => {
    set((state) => {
      const { [threadId]: _, ...rest } = state.attachmentsByThread
      return { attachmentsByThread: rest }
    })
  },
  transferAttachments: (fromKey, toKey) => {
    set((state) => {
      const fromAttachments = getOwnAttachments(
        state.attachmentsByThread,
        fromKey
      )
      if (!fromAttachments?.length) return state

      const existingDestination =
        getOwnAttachments(state.attachmentsByThread, toKey) ?? []
      const attachmentsByThread = { ...state.attachmentsByThread }
      delete attachmentsByThread[fromKey]

      // Merge rather than pick one side — picking discarded the source
      // whenever the destination already had files. Only dedupe when a stable
      // identity is available; two documents can legitimately share a basename
      // and byte size while referring to different paths.
      const seen = new Set<string>()
      const merged = [...existingDestination, ...fromAttachments].filter(
        (attachment) => {
          const identity = getAttachmentIdentity(attachment)
          if (!identity) return true
          if (seen.has(identity)) return false
          seen.add(identity)
          return true
        }
      )

      return {
        attachmentsByThread: {
          ...attachmentsByThread,
          [toKey]: merged,
        },
      }
    })
  },
}))
