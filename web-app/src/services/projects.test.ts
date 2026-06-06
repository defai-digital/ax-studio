import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultProjectsService } from './projects/default'
import { localStorageKey } from '@/constants/localStorage'

// Mock ulidx to return predictable IDs
let ulidCounter = 0
vi.mock('ulidx', () => ({
  ulid: vi.fn(() => `ULID_${++ulidCounter}`),
}))

// Mock the schema validation
vi.mock('@/schemas/projects.schema', () => ({
  projectsStorageSchema: {
    safeParse: vi.fn((data: unknown) => {
      // Simple pass-through validation for tests
      if (
        data &&
        typeof data === 'object' &&
        'state' in (data as Record<string, unknown>)
      ) {
        return { success: true, data }
      }
      return {
        success: false,
        error: { message: 'Invalid schema' },
      }
    }),
  },
}))

describe('DefaultProjectsService', () => {
  let service: DefaultProjectsService
  const storageKey = localStorageKey.threadManagement

  beforeEach(() => {
    service = new DefaultProjectsService()
    localStorage.clear()
    ulidCounter = 0
    vi.clearAllMocks()
  })

  describe('getProjects', () => {
    it('should return empty array when localStorage is empty', async () => {
      const result = await service.getProjects()
      expect(result).toEqual([])
    })

    it('should return projects from localStorage', async () => {
      const projects = [
        {
          id: 'proj-1',
          name: 'Project 1',
          updated_at: 1000,
        },
      ]
      localStorage.setItem(
        storageKey,
        JSON.stringify({ state: { folders: projects }, version: 0 })
      )

      const result = await service.getProjects()
      expect(result).toEqual(projects)
    })

    it('should return empty array for corrupted JSON in localStorage', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      localStorage.setItem(storageKey, 'not-valid-json{{{')

      const result = await service.getProjects()

      expect(result).toEqual([])
      consoleSpy.mockRestore()
    })

    it('should return empty array when schema validation fails', async () => {
      const consoleSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {})
      // data without 'state' key will fail our mock schema
      localStorage.setItem(storageKey, JSON.stringify({ bad: 'data' }))

      const result = await service.getProjects()

      expect(result).toEqual([])
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should return empty array when state.folders is missing', async () => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ state: {}, version: 0 })
      )

      const result = await service.getProjects()

      // state exists but folders is undefined, so ?? [] kicks in
      expect(result).toEqual([])
    })
  })

  describe('addProject', () => {
    it('should add a project with all fields', async () => {
      const before = Date.now()
      const result = await service.addProject(
        'My Project',
        'assistant-1',
        'logo.png',
        'You are helpful'
      )

      expect(result.id).toBe('ULID_1')
      expect(result.name).toBe('My Project')
      expect(result.assistantId).toBe('assistant-1')
      expect(result.logo).toBe('logo.png')
      expect(result.projectPrompt).toBe('You are helpful')
      expect(result.updated_at).toBeGreaterThanOrEqual(before)
      expect(result.updated_at).toBeLessThanOrEqual(Date.now())

      // Verify it persisted
      const projects = await service.getProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].id).toBe('ULID_1')
    })

    it('should add project with only required name', async () => {
      const result = await service.addProject('Minimal')

      expect(result.id).toBe('ULID_1')
      expect(result.name).toBe('Minimal')
      expect(result.assistantId).toBeUndefined()
      expect(result.logo).toBeUndefined()
      expect(result.projectPrompt).toBeNull()
    })

    it('should convert undefined projectPrompt to null', async () => {
      const result = await service.addProject('Test', undefined, undefined)

      expect(result.projectPrompt).toBeNull()
    })

    it('should append to existing projects', async () => {
      await service.addProject('First')
      await service.addProject('Second')

      const projects = await service.getProjects()
      expect(projects).toHaveLength(2)
      expect(projects[0].name).toBe('First')
      expect(projects[1].name).toBe('Second')
    })
  })

  describe('updateProject', () => {
    it('should update an existing project', async () => {
      const created = await service.addProject('Original', 'a1', 'old.png')
      const beforeUpdate = Date.now()

      await service.updateProject(
        created.id,
        'Updated',
        'a2',
        'new.png',
        'new prompt'
      )

      const updated = await service.getProjectById(created.id)
      expect(updated).toBeDefined()
      expect(updated!.name).toBe('Updated')
      expect(updated!.assistantId).toBe('a2')
      expect(updated!.logo).toBe('new.png')
      expect(updated!.projectPrompt).toBe('new prompt')
      expect(updated!.updated_at).toBeGreaterThanOrEqual(beforeUpdate)
    })

    it('should not modify other projects during update', async () => {
      const first = await service.addProject('First')
      const second = await service.addProject('Second')

      await service.updateProject(first.id, 'Updated First')

      const secondAfter = await service.getProjectById(second.id)
      expect(secondAfter!.name).toBe('Second')
    })

    it('should do nothing when updating non-existent id', async () => {
      await service.addProject('Existing')

      await service.updateProject('non-existent', 'Nope')

      const projects = await service.getProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].name).toBe('Existing')
    })
  })

  describe('deleteProject', () => {
    it('should delete an existing project', async () => {
      const created = await service.addProject('To Delete')

      await service.deleteProject(created.id)

      const projects = await service.getProjects()
      expect(projects).toHaveLength(0)
    })

    it('should only delete the targeted project', async () => {
      const first = await service.addProject('Keep')
      const second = await service.addProject('Delete')

      await service.deleteProject(second.id)

      const projects = await service.getProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].id).toBe(first.id)
    })

    it('should do nothing when deleting non-existent id', async () => {
      await service.addProject('Existing')

      await service.deleteProject('non-existent')

      const projects = await service.getProjects()
      expect(projects).toHaveLength(1)
    })
  })

  describe('getProjectById', () => {
    it('should return project by id', async () => {
      const created = await service.addProject('Find Me')

      const found = await service.getProjectById(created.id)

      expect(found).toBeDefined()
      expect(found!.name).toBe('Find Me')
      expect(found!.id).toBe(created.id)
    })

    it('should return undefined for non-existent id', async () => {
      const found = await service.getProjectById('non-existent')
      expect(found).toBeUndefined()
    })
  })

  describe('setProjects', () => {
    it('should replace all projects', async () => {
      await service.addProject('Old')

      const newProjects = [
        { id: 'new-1', name: 'New 1', updated_at: 1000 },
        { id: 'new-2', name: 'New 2', updated_at: 2000 },
      ]
      await service.setProjects(newProjects)

      const projects = await service.getProjects()
      expect(projects).toHaveLength(2)
      expect(projects[0].id).toBe('new-1')
      expect(projects[1].id).toBe('new-2')
    })

    it('should allow setting empty array', async () => {
      await service.addProject('Something')

      await service.setProjects([])

      const projects = await service.getProjects()
      expect(projects).toHaveLength(0)
    })
  })

  describe('localStorage error handling', () => {
    it('should handle localStorage.setItem throwing', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const setItemSpy = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('QuotaExceededError')
        })

      // Should not throw, just log
      await service.addProject('Will Fail Save')

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error saving projects to localStorage:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
      setItemSpy.mockRestore()
    })

    it('should handle localStorage.getItem throwing', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const getItemSpy = vi
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new Error('SecurityError')
        })

      const result = await service.getProjects()

      expect(result).toEqual([])
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error loading projects from localStorage:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
      getItemSpy.mockRestore()
    })
  })
})
