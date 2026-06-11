import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadFolder } from '@/services/projects/types'

const mockProject: ThreadFolder = {
  id: 'project-1',
  name: 'Project 1',
  updated_at: 100,
  logo: 'P',
  projectPrompt: 'Project prompt',
}

const mockGetProjects = vi.fn()
const mockAddProject = vi.fn()
const mockUpdateProject = vi.fn()
const mockDeleteProject = vi.fn()
const mockGetProjectById = vi.fn()
const mockUpdateThread = vi.fn()
const mockDeleteThread = vi.fn()
let mockThreads: Record<string, Thread> = {}

const mockServiceHub = {
  projects: () => ({
    getProjects: mockGetProjects,
    addProject: mockAddProject,
    updateProject: mockUpdateProject,
    deleteProject: mockDeleteProject,
    getProjectById: mockGetProjectById,
  }),
}

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => mockServiceHub,
  getServiceHub: () => mockServiceHub,
}))

vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: {
    getState: () => ({
      threads: mockThreads,
      updateThread: mockUpdateThread,
      deleteThread: mockDeleteThread,
    }),
  },
}))

describe('useThreadManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockThreads = {}
    mockGetProjects.mockResolvedValue([])
    mockAddProject.mockResolvedValue(mockProject)
    mockUpdateProject.mockResolvedValue(undefined)
    mockDeleteProject.mockResolvedValue(undefined)
    mockGetProjectById.mockResolvedValue(undefined)
  })

  it('loads projects on mount and exposes folder lookup', async () => {
    mockGetProjects.mockResolvedValueOnce([mockProject])
    const { useThreadManagement } = await import('../useThreadManagement')

    const { result } = renderHook(() => useThreadManagement())

    await waitFor(() => {
      expect(result.current.getFolderById('project-1')).toEqual(mockProject)
    })
  })

  it('adds a folder and refreshes from the projects service', async () => {
    mockGetProjects.mockResolvedValue([mockProject])
    const { useThreadManagement } = await import('../useThreadManagement')

    const { result } = renderHook(() => useThreadManagement())

    let created: ThreadFolder | undefined
    await act(async () => {
      created = await result.current.addFolder(
        'Project 1',
        'assistant-1',
        'P',
        'Project prompt'
      )
    })

    expect(mockAddProject).toHaveBeenCalledWith(
      'Project 1',
      'assistant-1',
      'P',
      'Project prompt'
    )
    expect(created).toEqual(mockProject)
  })

  it('updates thread project metadata after a project rename', async () => {
    const renamedProject = { ...mockProject, name: 'Renamed', updated_at: 200 }
    mockGetProjects.mockResolvedValue([renamedProject])
    mockThreads = {
      'thread-1': {
        id: 'thread-1',
        title: 'Thread 1',
        messages: [],
        metadata: { project: { id: 'project-1', name: 'Project 1' } },
      },
    }
    const { useThreadManagement } = await import('../useThreadManagement')

    const { result } = renderHook(() => useThreadManagement())

    await act(async () => {
      await result.current.updateFolder('project-1', 'Renamed', 'assistant-1')
    })

    expect(mockUpdateProject).toHaveBeenCalledWith(
      'project-1',
      'Renamed',
      'assistant-1',
      undefined,
      undefined
    )
    expect(mockUpdateThread).toHaveBeenCalledWith('thread-1', {
      metadata: {
        project: {
          id: 'project-1',
          name: 'Renamed',
          updated_at: 200,
          logo: 'P',
          projectPrompt: 'Project prompt',
        },
      },
    })
  })

  it('deletes project threads through the thread store once each', async () => {
    mockThreads = {
      'thread-1': {
        id: 'thread-1',
        title: 'Thread 1',
        messages: [],
        metadata: { project: { id: 'project-1', name: 'Project 1' } },
      },
      other: {
        id: 'other',
        title: 'Other',
        messages: [],
        metadata: { project: { id: 'project-2', name: 'Project 2' } },
      },
    }
    const { useThreadManagement } = await import('../useThreadManagement')

    const { result } = renderHook(() => useThreadManagement())

    await act(async () => {
      await result.current.deleteFolderWithThreads('project-1')
    })

    expect(mockDeleteThread).toHaveBeenCalledTimes(1)
    expect(mockDeleteThread).toHaveBeenCalledWith('thread-1')
    expect(mockDeleteProject).toHaveBeenCalledWith('project-1')
  })
})
