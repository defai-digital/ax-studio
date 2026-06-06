import { describe, it, expect } from 'vitest'
import { threadFolderSchema, projectsStorageSchema } from './projects.schema'

describe('threadFolderSchema', () => {
  const validFolder = {
    id: 'folder-1',
    name: 'My Project',
    updated_at: 1700000000,
  }

  it('should validate a minimal valid folder', () => {
    const result = threadFolderSchema.safeParse(validFolder)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('folder-1')
      expect(result.data.name).toBe('My Project')
      expect(result.data.updated_at).toBe(1700000000)
    }
  })

  it('should validate with all optional fields', () => {
    const full = {
      ...validFolder,
      assistantId: 'asst-1',
      logo: 'https://example.com/logo.png',
      projectPrompt: 'You are helping with project X',
    }
    const result = threadFolderSchema.safeParse(full)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.assistantId).toBe('asst-1')
      expect(result.data.logo).toBe('https://example.com/logo.png')
      expect(result.data.projectPrompt).toBe('You are helping with project X')
    }
  })

  it('should accept null for projectPrompt', () => {
    const result = threadFolderSchema.safeParse({
      ...validFolder,
      projectPrompt: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.projectPrompt).toBeNull()
    }
  })

  it('should fail when id is missing', () => {
    const { id: _, ...rest } = validFolder
    const result = threadFolderSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('should fail when name is missing', () => {
    const { name: _, ...rest } = validFolder
    const result = threadFolderSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('should fail when updated_at is missing', () => {
    const { updated_at: _, ...rest } = validFolder
    const result = threadFolderSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('should fail when updated_at is a string', () => {
    const result = threadFolderSchema.safeParse({
      ...validFolder,
      updated_at: '2023-01-01',
    })
    expect(result.success).toBe(false)
  })

  it('should accept empty string for name', () => {
    const result = threadFolderSchema.safeParse({
      ...validFolder,
      name: '',
    })
    expect(result.success).toBe(true)
  })
})

describe('projectsStorageSchema', () => {
  it('should validate a valid storage object', () => {
    const result = projectsStorageSchema.safeParse({
      state: {
        folders: [
          { id: 'f1', name: 'Project 1', updated_at: 100 },
          { id: 'f2', name: 'Project 2', updated_at: 200 },
        ],
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state?.folders).toHaveLength(2)
    }
  })

  it('should validate an empty object (state is optional)', () => {
    const result = projectsStorageSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state).toBeUndefined()
    }
  })

  it('should validate with empty folders array', () => {
    const result = projectsStorageSchema.safeParse({
      state: { folders: [] },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state?.folders).toEqual([])
    }
  })

  it('should fail when folders contains invalid items', () => {
    const result = projectsStorageSchema.safeParse({
      state: {
        folders: [{ invalid: true }],
      },
    })
    expect(result.success).toBe(false)
  })

  it('should fail when given a non-object', () => {
    const result = projectsStorageSchema.safeParse('not an object')
    expect(result.success).toBe(false)
  })

  it('should fail when given null', () => {
    const result = projectsStorageSchema.safeParse(null)
    expect(result.success).toBe(false)
  })
})
