import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatFolder, ChatTag } from '@/services/chat-organization/types'

const mockFolder: ChatFolder = { id: 'folder-1', name: 'Work', updatedAt: 100 }
const mockTag: ChatTag = { id: 'tag-1', name: 'urgent' }

const mockGetOrganization = vi.fn()
const mockAddFolder = vi.fn()
const mockRenameFolder = vi.fn()
const mockDeleteFolder = vi.fn()
const mockAddTag = vi.fn()
const mockRenameTag = vi.fn()
const mockDeleteTag = vi.fn()
const mockUpdateThread = vi.fn()

let mockThreads: Record<string, Thread> = {}

const mockServiceHub = {
  chatOrganization: () => ({
    getOrganization: mockGetOrganization,
    addFolder: mockAddFolder,
    renameFolder: mockRenameFolder,
    deleteFolder: mockDeleteFolder,
    addTag: mockAddTag,
    renameTag: mockRenameTag,
    deleteTag: mockDeleteTag,
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
      getThreadById: (threadId: string) => mockThreads[threadId],
    }),
  },
}))

import { useChatOrganization, useChatOrganizationStore } from '../useChatOrganization'

describe('useChatOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockThreads = {}
    useChatOrganizationStore.setState({
      folders: [],
      tags: [],
      collapsedFolderIds: [],
      activeTagId: null,
    })
    mockGetOrganization.mockResolvedValue({ folders: [], tags: [] })
    mockAddFolder.mockResolvedValue(mockFolder)
    mockRenameFolder.mockResolvedValue(undefined)
    mockDeleteFolder.mockResolvedValue(undefined)
    mockAddTag.mockResolvedValue(mockTag)
    mockRenameTag.mockResolvedValue(undefined)
    mockDeleteTag.mockResolvedValue(undefined)
  })

  it('hydrates folders and tags from the service on mount', async () => {
    mockGetOrganization.mockResolvedValueOnce({
      folders: [mockFolder],
      tags: [mockTag],
    })

    renderHook(() => useChatOrganization())

    await waitFor(() => {
      expect(useChatOrganizationStore.getState().folders).toEqual([mockFolder])
      expect(useChatOrganizationStore.getState().tags).toEqual([mockTag])
    })
  })

  it('adds a folder and refreshes from the service', async () => {
    mockGetOrganization.mockResolvedValue({ folders: [mockFolder], tags: [] })
    const { result } = renderHook(() => useChatOrganization())

    let created: ChatFolder | undefined
    await act(async () => {
      created = await result.current.addFolder('Work')
    })

    expect(mockAddFolder).toHaveBeenCalledWith('Work')
    expect(created).toEqual(mockFolder)
    expect(result.current.folders).toEqual([mockFolder])
  })

  it('renames a folder through the service', async () => {
    mockGetOrganization.mockResolvedValue({
      folders: [{ ...mockFolder, name: 'Renamed' }],
      tags: [],
    })
    const { result } = renderHook(() => useChatOrganization())

    await act(async () => {
      await result.current.renameFolder('folder-1', 'Renamed')
    })

    expect(mockRenameFolder).toHaveBeenCalledWith('folder-1', 'Renamed')
    expect(result.current.folders[0].name).toBe('Renamed')
  })

  it('deleting a folder clears membership on member threads without deleting them', async () => {
    mockThreads = {
      'thread-1': {
        id: 'thread-1',
        title: 'In folder',
        updated: 1,
        metadata: { folderId: 'folder-1', other: 'keep' },
      } as Thread,
      'thread-2': {
        id: 'thread-2',
        title: 'Other folder',
        updated: 1,
        metadata: { folderId: 'folder-2' },
      } as Thread,
    }
    useChatOrganizationStore.setState({ collapsedFolderIds: ['folder-1'] })
    const { result } = renderHook(() => useChatOrganization())

    await act(async () => {
      await result.current.deleteFolder('folder-1')
    })

    // Membership cleared on the member thread, other metadata preserved
    expect(mockUpdateThread).toHaveBeenCalledTimes(1)
    expect(mockUpdateThread).toHaveBeenCalledWith('thread-1', {
      metadata: { folderId: undefined, other: 'keep' },
    })
    // Threads themselves are never deleted (no deleteThread in the mock API)
    expect(mockDeleteFolder).toHaveBeenCalledWith('folder-1')
    // Collapsed state for the deleted folder is dropped
    expect(result.current.collapsedFolderIds).toEqual([])
  })

  it('adds a tag and refreshes from the service', async () => {
    mockGetOrganization.mockResolvedValue({ folders: [], tags: [mockTag] })
    const { result } = renderHook(() => useChatOrganization())

    let created: ChatTag | undefined
    await act(async () => {
      created = await result.current.addTag('urgent')
    })

    expect(mockAddTag).toHaveBeenCalledWith('urgent')
    expect(created).toEqual(mockTag)
    expect(result.current.tags).toEqual([mockTag])
  })

  it('renames a tag through the service', async () => {
    const { result } = renderHook(() => useChatOrganization())

    await act(async () => {
      await result.current.renameTag('tag-1', 'later')
    })

    expect(mockRenameTag).toHaveBeenCalledWith('tag-1', 'later')
  })

  it('deleting a tag removes it from member threads and resets the active filter', async () => {
    mockThreads = {
      'thread-1': {
        id: 'thread-1',
        title: 'Tagged',
        updated: 1,
        metadata: { tagIds: ['tag-1', 'tag-2'] },
      } as Thread,
      'thread-2': {
        id: 'thread-2',
        title: 'Only tag',
        updated: 1,
        metadata: { tagIds: ['tag-1'] },
      } as Thread,
    }
    useChatOrganizationStore.setState({ activeTagId: 'tag-1' })
    const { result } = renderHook(() => useChatOrganization())

    await act(async () => {
      await result.current.deleteTag('tag-1')
    })

    expect(mockUpdateThread).toHaveBeenCalledWith('thread-1', {
      metadata: { tagIds: ['tag-2'] },
    })
    // Last tag removed -> field cleared entirely
    expect(mockUpdateThread).toHaveBeenCalledWith('thread-2', {
      metadata: { tagIds: undefined },
    })
    expect(mockDeleteTag).toHaveBeenCalledWith('tag-1')
    expect(result.current.activeTagId).toBeNull()
  })

  it('assignFolder writes thread.metadata.folderId through updateThread', () => {
    mockThreads = {
      'thread-1': {
        id: 'thread-1',
        title: 'Chat',
        updated: 1,
        metadata: { other: 'keep' },
      } as Thread,
    }
    const { result } = renderHook(() => useChatOrganization())

    act(() => {
      result.current.assignFolder('thread-1', 'folder-1')
    })

    expect(mockUpdateThread).toHaveBeenCalledWith('thread-1', {
      metadata: { other: 'keep', folderId: 'folder-1' },
    })
  })

  it('assignFolder with null clears the folder', () => {
    mockThreads = {
      'thread-1': {
        id: 'thread-1',
        title: 'Chat',
        updated: 1,
        metadata: { folderId: 'folder-1' },
      } as Thread,
    }
    const { result } = renderHook(() => useChatOrganization())

    act(() => {
      result.current.assignFolder('thread-1', null)
    })

    expect(mockUpdateThread).toHaveBeenCalledWith('thread-1', {
      metadata: { folderId: undefined },
    })
  })

  it('assignFolder ignores unknown threads', () => {
    const { result } = renderHook(() => useChatOrganization())

    act(() => {
      result.current.assignFolder('missing', 'folder-1')
    })

    expect(mockUpdateThread).not.toHaveBeenCalled()
  })

  it('setThreadTags writes thread.metadata.tagIds and clears on empty', () => {
    mockThreads = {
      'thread-1': {
        id: 'thread-1',
        title: 'Chat',
        updated: 1,
        metadata: {},
      } as Thread,
    }
    const { result } = renderHook(() => useChatOrganization())

    act(() => {
      result.current.setThreadTags('thread-1', ['tag-1', 'tag-2'])
    })
    expect(mockUpdateThread).toHaveBeenCalledWith('thread-1', {
      metadata: { tagIds: ['tag-1', 'tag-2'] },
    })

    act(() => {
      result.current.setThreadTags('thread-1', [])
    })
    expect(mockUpdateThread).toHaveBeenCalledWith('thread-1', {
      metadata: { tagIds: undefined },
    })
  })

  it('toggleFolderCollapsed toggles ids in the collapsed list', () => {
    const { result } = renderHook(() => useChatOrganization())

    act(() => {
      result.current.toggleFolderCollapsed('folder-1')
    })
    expect(result.current.collapsedFolderIds).toEqual(['folder-1'])

    act(() => {
      result.current.toggleFolderCollapsed('folder-1')
    })
    expect(result.current.collapsedFolderIds).toEqual([])
  })

  it('setActiveTagId sets and clears the single-select filter', () => {
    const { result } = renderHook(() => useChatOrganization())

    act(() => {
      result.current.setActiveTagId('tag-1')
    })
    expect(result.current.activeTagId).toBe('tag-1')

    act(() => {
      result.current.setActiveTagId(null)
    })
    expect(result.current.activeTagId).toBeNull()
  })
})
