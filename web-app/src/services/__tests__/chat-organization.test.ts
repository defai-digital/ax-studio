import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultChatOrganizationService } from '../chat-organization/default'
import { localStorageKey } from '@/constants/localStorage'

// Mock ulidx to return predictable IDs
let ulidCounter = 0
vi.mock('ulidx', () => ({
  ulid: vi.fn(() => `ULID_${++ulidCounter}`),
}))

describe('DefaultChatOrganizationService', () => {
  let service: DefaultChatOrganizationService
  const storageKey = localStorageKey.chatOrganization

  beforeEach(() => {
    service = new DefaultChatOrganizationService()
    localStorage.clear()
    ulidCounter = 0
    vi.clearAllMocks()
  })

  describe('getOrganization', () => {
    it('should return empty arrays when localStorage is empty', async () => {
      const result = await service.getOrganization()
      expect(result).toEqual({ folders: [], tags: [] })
    })

    it('should return folders and tags from localStorage', async () => {
      const folders = [{ id: 'f1', name: 'Work', updatedAt: 1000 }]
      const tags = [{ id: 't1', name: 'urgent' }]
      localStorage.setItem(
        storageKey,
        JSON.stringify({ state: { folders, tags }, version: 0 })
      )

      const result = await service.getOrganization()
      expect(result).toEqual({ folders, tags })
    })

    it('should return empty arrays for corrupted JSON in localStorage', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      localStorage.setItem(storageKey, 'not-valid-json{{{')

      const result = await service.getOrganization()

      expect(result).toEqual({ folders: [], tags: [] })
      consoleSpy.mockRestore()
    })

    it('should warn and return empty arrays when schema validation fails', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      localStorage.setItem(
        storageKey,
        JSON.stringify({ state: { folders: [{ bad: true }] }, version: 0 })
      )

      const result = await service.getOrganization()

      expect(result).toEqual({ folders: [], tags: [] })
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('folder CRUD', () => {
    it('should add a folder with trimmed name and timestamps', async () => {
      const before = Date.now()
      const folder = await service.addFolder('  Work  ')

      expect(folder.id).toBe('ULID_1')
      expect(folder.name).toBe('Work')
      expect(folder.updatedAt).toBeGreaterThanOrEqual(before)
      expect(folder.updatedAt).toBeLessThanOrEqual(Date.now())

      const { folders } = await service.getOrganization()
      expect(folders).toHaveLength(1)
    })

    it('should reject empty folder names', async () => {
      await expect(service.addFolder('   ')).rejects.toThrow(
        'Folder name must not be empty'
      )
    })

    it('should reject folder names longer than 200 characters', async () => {
      await expect(service.addFolder('x'.repeat(201))).rejects.toThrow(
        'Folder name must be at most 200 characters'
      )
    })

    it('should rename a folder and bump updatedAt', async () => {
      const folder = await service.addFolder('Old')
      const before = Date.now()

      await service.renameFolder(folder.id, 'New')

      const { folders } = await service.getOrganization()
      expect(folders[0].name).toBe('New')
      expect(folders[0].updatedAt).toBeGreaterThanOrEqual(before)
    })

    it('should reject empty names on rename', async () => {
      const folder = await service.addFolder('Keep')
      await expect(service.renameFolder(folder.id, ' ')).rejects.toThrow()

      const { folders } = await service.getOrganization()
      expect(folders[0].name).toBe('Keep')
    })

    it('should delete only the targeted folder', async () => {
      const first = await service.addFolder('Keep')
      const second = await service.addFolder('Delete')

      await service.deleteFolder(second.id)

      const { folders } = await service.getOrganization()
      expect(folders).toHaveLength(1)
      expect(folders[0].id).toBe(first.id)
    })

    it('should preserve tags when mutating folders', async () => {
      await service.addTag('urgent')
      const folder = await service.addFolder('Work')
      await service.deleteFolder(folder.id)

      const { tags } = await service.getOrganization()
      expect(tags).toHaveLength(1)
    })
  })

  describe('tag CRUD', () => {
    it('should add a tag with trimmed name', async () => {
      const tag = await service.addTag('  urgent ')

      expect(tag.id).toBe('ULID_1')
      expect(tag.name).toBe('urgent')

      const { tags } = await service.getOrganization()
      expect(tags).toHaveLength(1)
    })

    it('should reject empty tag names', async () => {
      await expect(service.addTag(' ')).rejects.toThrow(
        'Tag name must not be empty'
      )
    })

    it('should reject duplicate tag names case-insensitively', async () => {
      await service.addTag('Urgent')

      await expect(service.addTag('urgent')).rejects.toThrow(
        'Tag "urgent" already exists'
      )
      await expect(service.addTag('URGENT')).rejects.toThrow()

      const { tags } = await service.getOrganization()
      expect(tags).toHaveLength(1)
    })

    it('should rename a tag', async () => {
      const tag = await service.addTag('old')

      await service.renameTag(tag.id, 'new')

      const { tags } = await service.getOrganization()
      expect(tags[0].name).toBe('new')
    })

    it('should allow renaming a tag to its own name with different case', async () => {
      const tag = await service.addTag('Urgent')

      await service.renameTag(tag.id, 'urgent')

      const { tags } = await service.getOrganization()
      expect(tags[0].name).toBe('urgent')
    })

    it('should reject renaming a tag to an existing name case-insensitively', async () => {
      await service.addTag('Work')
      const second = await service.addTag('Personal')

      await expect(service.renameTag(second.id, 'work')).rejects.toThrow()

      const { tags } = await service.getOrganization()
      expect(tags[1].name).toBe('Personal')
    })

    it('should delete only the targeted tag', async () => {
      const first = await service.addTag('Keep')
      const second = await service.addTag('Delete')

      await service.deleteTag(second.id)

      const { tags } = await service.getOrganization()
      expect(tags).toHaveLength(1)
      expect(tags[0].id).toBe(first.id)
    })
  })

  describe('write serialization', () => {
    it('should serialize concurrent writes through the queue', async () => {
      // Without queueing, both writes would read the same empty state and
      // the second would clobber the first.
      await Promise.all([
        service.addFolder('First'),
        service.addFolder('Second'),
        service.addTag('tag'),
      ])

      const { folders, tags } = await service.getOrganization()
      expect(folders.map((f) => f.name)).toEqual(['First', 'Second'])
      expect(tags).toHaveLength(1)
    })
  })

  describe('localStorage error handling', () => {
    it('should reject mutations when localStorage.setItem throws', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => null),
        setItem: vi.fn(() => {
          throw new Error('QuotaExceededError')
        }),
      })

      try {
        await expect(service.addFolder('Will Fail Save')).rejects.toThrow(
          'QuotaExceededError'
        )
      } finally {
        vi.unstubAllGlobals()
        consoleSpy.mockRestore()
      }
    })

    it('should return empty arrays when localStorage.getItem throws', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const getItemSpy = vi
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new Error('SecurityError')
        })

      const result = await service.getOrganization()

      expect(result).toEqual({ folders: [], tags: [] })

      consoleSpy.mockRestore()
      getItemSpy.mockRestore()
    })
  })
})
