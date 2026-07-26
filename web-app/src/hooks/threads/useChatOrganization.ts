import { create } from 'zustand'
import { useThreads } from '@/hooks/threads/useThreads'
import * as persistence from '@/lib/chat-organization'
import type { ChatFolder, ChatTag } from '@/lib/chat-organization'
import { useEffect } from 'react'

type ChatOrganizationState = {
  folders: ChatFolder[]
  tags: ChatTag[]
  /** Sidebar UI state: ids of folders whose member list is collapsed. */
  collapsedFolderIds: string[]
  /** Sidebar UI state: active tag filter (single-select; null = no filter). */
  activeTagId: string | null
  toggleFolderCollapsed: (id: string) => void
  setActiveTagId: (tagId: string | null) => void
  addFolder: (name: string) => Promise<ChatFolder>
  renameFolder: (id: string, name: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  addTag: (name: string) => Promise<ChatTag>
  renameTag: (id: string, name: string) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  assignFolder: (threadId: string, folderId: string | null) => void
  setThreadTags: (threadId: string, tagIds: string[]) => void
}

const useChatOrganizationStore = create<ChatOrganizationState>()((set) => ({
  folders: [],
  tags: [],
  collapsedFolderIds: [],
  activeTagId: null,

  toggleFolderCollapsed: (id) => {
    set((state) => ({
      collapsedFolderIds: state.collapsedFolderIds.includes(id)
        ? state.collapsedFolderIds.filter((folderId) => folderId !== id)
        : [...state.collapsedFolderIds, id],
    }))
  },

  setActiveTagId: (tagId) => {
    set({ activeTagId: tagId })
  },

  addFolder: async (name) => {
    const newFolder = await persistence.addFolder(name)
    const { folders, tags } = await persistence.getOrganization()
    set({ folders, tags })
    return newFolder
  },

  renameFolder: async (id, name) => {
    await persistence.renameFolder(id, name)
    const { folders, tags } = await persistence.getOrganization()
    set({ folders, tags })
  },

  deleteFolder: async (id) => {
    // Delete the folder first. If persistence fails, member threads must keep
    // their assignment rather than being silently unfiled from a folder that
    // still exists on disk.
    await persistence.deleteFolder(id)

    // Clear membership on member threads — never delete the threads.
    const threadsState = useThreads.getState()
    Object.values(threadsState.threads)
      .filter((thread) => thread.metadata?.folderId === id)
      .forEach((thread) => {
        threadsState.updateThread(thread.id, {
          metadata: { ...thread.metadata, folderId: undefined },
        })
      })

    const { folders, tags } = await persistence.getOrganization()
    set((state) => ({
      folders,
      tags,
      collapsedFolderIds: state.collapsedFolderIds.filter(
        (folderId) => folderId !== id
      ),
    }))
  },

  addTag: async (name) => {
    const newTag = await persistence.addTag(name)
    const { folders, tags } = await persistence.getOrganization()
    set({ folders, tags })
    return newTag
  },

  renameTag: async (id, name) => {
    await persistence.renameTag(id, name)
    const { folders, tags } = await persistence.getOrganization()
    set({ folders, tags })
  },

  deleteTag: async (id) => {
    // Preserve thread metadata if the tag itself could not be persisted as
    // deleted; otherwise the UI and storage disagree after a reload.
    await persistence.deleteTag(id)

    // Clear membership on member threads — never delete the threads.
    const threadsState = useThreads.getState()
    Object.values(threadsState.threads)
      .filter((thread) => thread.metadata?.tagIds?.includes(id))
      .forEach((thread) => {
        const tagIds = (thread.metadata?.tagIds ?? []).filter(
          (tagId) => tagId !== id
        )
        threadsState.updateThread(thread.id, {
          metadata: {
            ...thread.metadata,
            tagIds: tagIds.length > 0 ? tagIds : undefined,
          },
        })
      })

    const { folders, tags } = await persistence.getOrganization()
    set((state) => ({
      folders,
      tags,
      activeTagId: state.activeTagId === id ? null : state.activeTagId,
    }))
  },

  assignFolder: (threadId, folderId) => {
    const threadsState = useThreads.getState()
    const thread = threadsState.getThreadById(threadId)
    if (!thread) return
    threadsState.updateThread(threadId, {
      metadata: { ...thread.metadata, folderId: folderId ?? undefined },
    })
  },

  setThreadTags: (threadId, tagIds) => {
    const threadsState = useThreads.getState()
    const thread = threadsState.getThreadById(threadId)
    if (!thread) return
    threadsState.updateThread(threadId, {
      metadata: {
        ...thread.metadata,
        tagIds: tagIds.length > 0 ? tagIds : undefined,
      },
    })
  },
}))

export const useChatOrganization = () => {
  const store = useChatOrganizationStore()

  // Load folders/tags from localStorage on mount (mirrors useThreadManagement).
  // A cancelled flag keeps a slow load from overwriting the store with stale
  // data after unmount.
  useEffect(() => {
    let cancelled = false
    const syncOrganization = async () => {
      try {
        const { folders, tags } = await persistence.getOrganization()
        if (cancelled) return
        useChatOrganizationStore.setState({ folders, tags })
      } catch (error) {
        if (cancelled) return
        console.error('Error syncing chat organization:', error)
      }
    }
    syncOrganization()
    return () => {
      cancelled = true
    }
  }, [])

  return store
}

export { useChatOrganizationStore }
