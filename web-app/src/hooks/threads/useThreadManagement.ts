import { create } from 'zustand'
import { getServiceHub, useServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/threads/useThreads'
import type { ThreadFolder } from '@/services/projects/types'
import { useEffect } from 'react'

type ThreadManagementState = {
  folders: ThreadFolder[]
  setFolders: (folders: ThreadFolder[]) => void
  addFolder: (
    name: string,
    assistantId?: string,
    logo?: string,
    projectPrompt?: string | null
  ) => Promise<ThreadFolder>
  updateFolder: (
    id: string,
    name: string,
    assistantId?: string,
    logo?: string,
    projectPrompt?: string | null
  ) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  deleteFolderWithThreads: (id: string) => Promise<void>
  getFolderById: (id: string) => ThreadFolder | undefined
  getProjectById: (id: string) => Promise<ThreadFolder | undefined>
}

const useThreadManagementStore = create<ThreadManagementState>()(
  (set, get) => ({
    folders: [],

    setFolders: (folders) => {
      set({ folders })
    },

    addFolder: async (name, assistantId, logo, projectPrompt) => {
      const projectsService = getServiceHub().projects()
      const newFolder = await projectsService.addProject(
        name,
        assistantId,
        logo,
        projectPrompt
      )
      const updatedProjects = await projectsService.getProjects()
      set({ folders: updatedProjects })
      return newFolder
    },

    updateFolder: async (id, name, assistantId, logo, projectPrompt) => {
      const projectsService = getServiceHub().projects()
      await projectsService.updateProject(
        id,
        name,
        assistantId,
        logo,
        projectPrompt
      )
      const updatedProjects = await projectsService.getProjects()
      set({ folders: updatedProjects })

      const updatedProject = updatedProjects.find(
        (project) => project.id === id
      )
      if (!updatedProject) return

      const threadsState = useThreads.getState()
      const threadsToUpdate = Object.values(threadsState.threads).filter(
        (thread) => thread.metadata?.project?.id === id
      )

      threadsToUpdate.forEach((thread) => {
        threadsState.updateThread(thread.id, {
          metadata: {
            ...thread.metadata,
            project: {
              id: updatedProject.id,
              name: updatedProject.name,
              updated_at: updatedProject.updated_at,
              logo: updatedProject.logo,
              projectPrompt: updatedProject.projectPrompt ?? null,
            },
          },
        })
      })
    },

    deleteFolder: async (id) => {
      // Remove project metadata from all threads that belong to this project
      const threadsState = useThreads.getState()
      const threadsToUpdate = Object.values(threadsState.threads).filter(
        (thread) => thread.metadata?.project?.id === id
      )

      threadsToUpdate.forEach((thread) => {
        threadsState.updateThread(thread.id, {
          metadata: {
            ...thread.metadata,
            project: undefined,
          },
        })
      })

      const projectsService = getServiceHub().projects()
      await projectsService.deleteProject(id)
      const updatedProjects = await projectsService.getProjects()
      set({ folders: updatedProjects })
    },

    deleteFolderWithThreads: async (id) => {
      // Get all threads that belong to this project
      const threadsState = useThreads.getState()
      const projectThreads = Object.values(threadsState.threads).filter(
        (thread) => thread.metadata?.project?.id === id
      )

      // The frontend store's `deleteThread` already invokes the backend
      // delete — the previous explicit backend loop above it deleted each
      // thread twice (the second call would typically 404). Delegate to
      // the store so each thread is deleted exactly once.
      for (const thread of projectThreads) {
        threadsState.deleteThread(thread.id)
      }

      // Delete the project from storage
      const projectsService = getServiceHub().projects()
      await projectsService.deleteProject(id)

      const updatedProjects = await projectsService.getProjects()
      set({ folders: updatedProjects })
    },

    getFolderById: (id) => {
      return get().folders.find((folder) => folder.id === id)
    },

    getProjectById: async (id) => {
      const projectsService = getServiceHub().projects()
      return await projectsService.getProjectById(id)
    },
  })
)

export const useThreadManagement = () => {
  const serviceHub = useServiceHub()
  const store = useThreadManagementStore()

  // Load projects from service on mount. Use a cancelled flag so a slow
  // `getProjects()` that resolves after the hook has unmounted (or
  // `serviceHub` changed) doesn't overwrite the store with stale data.
  useEffect(() => {
    let cancelled = false
    const syncProjects = async () => {
      try {
        const projectsService = serviceHub.projects()
        const projects = await projectsService.getProjects()
        if (cancelled) return
        useThreadManagementStore.setState({ folders: projects })
      } catch (error) {
        if (cancelled) return
        console.error('Error syncing projects:', error)
      }
    }
    syncProjects()
    return () => {
      cancelled = true
    }
  }, [serviceHub])

  return store
}
