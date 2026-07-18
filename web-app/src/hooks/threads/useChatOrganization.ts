import { create } from 'zustand'
import { getServiceHub, useServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/threads/useThreads'
import type { ChatFolder, ChatTag } from '@/services/chat-organization/types'
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
    const service = getServiceHub().chatOrganization()
    const newFolder = await service.addFolder(name)
    const { folders, tags } = await service.getOrganization()
    set({ folders, tags })
    return newFolder
  },

  renameFolder: async (id, name) => {
    const service = getServiceHub().chatOrganization()
    await service.renameFolder(id, name)
    const { folders, tags } = await service.getOrganization()
    set({ folders, tags })
  },

  deleteFolder: async (id) => {
    // Clear membership on member threads — never delete the threads.
    const threadsState = useThreads.getState()
    Object.values(threadsState.threads)
      .filter((thread) => thread.metadata?.folderId === id)
      .forEach((thread) => {
        threadsState.updateThread(thread.id, {
          metadata: { ...thread.metadata, folderId: undefined },
        })
      })

    const service = getServiceHub().chatOrganization()
    await service.deleteFolder(id)
    const { folders, tags } = await service.getOrganization()
    set((state) => ({
      folders,
      tags,
      collapsedFolderIds: state.collapsedFolderIds.filter(
        (folderId) => folderId !== id
      ),
    }))
  },

  addTag: async (name) => {
    const service = getServiceHub().chatOrganization()
    const newTag = await service.addTag(name)
    const { folders, tags } = await service.getOrganization()
    set({ folders, tags })
    return newTag
  },

  renameTag: async (id, name) => {
    const service = getServiceHub().chatOrganization()
    await service.renameTag(id, name)
    const { folders, tags } = await service.getOrganization()
    set({ folders, tags })
  },

  deleteTag: async (id) => {
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

    const service = getServiceHub().chatOrganization()
    await service.deleteTag(id)
    const { folders, tags } = await service.getOrganization()
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
  const serviceHub = useServiceHub()
  const store = useChatOrganizationStore()

  // Load folders/tags from the service on mount (mirrors useThreadManagement).
  // A cancelled flag keeps a slow load from overwriting the store with stale
  // data after unmount.
  useEffect(() => {
    let cancelled = false
    const syncOrganization = async () => {
      try {
        const { folders, tags } = await serviceHub
          .chatOrganization()
          .getOrganization()
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
  }, [serviceHub])

  return store
}

export { useChatOrganizationStore }
