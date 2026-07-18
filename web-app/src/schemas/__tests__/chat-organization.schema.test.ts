import { describe, it, expect } from 'vitest'
import { chatOrganizationStorageSchema } from '../chat-organization.schema'

function parseStorage(state: unknown) {
  return chatOrganizationStorageSchema.safeParse({ state })
}

describe('chatOrganizationStorageSchema', () => {
  const validFolder = { id: 'f1', name: 'Work', updatedAt: 1700000000 }
  const validTag = { id: 't1', name: 'urgent' }

  it('should validate a valid storage object', () => {
    const result = parseStorage({ folders: [validFolder], tags: [validTag] })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state?.folders).toHaveLength(1)
      expect(result.data.state?.tags).toHaveLength(1)
    }
  })

  it('should validate an empty object (state is optional)', () => {
    const result = chatOrganizationStorageSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state).toBeUndefined()
    }
  })

  it('should validate with empty folders and tags arrays', () => {
    const result = parseStorage({ folders: [], tags: [] })
    expect(result.success).toBe(true)
  })

  it('should validate a folder with optional logo', () => {
    const result = parseStorage({
      folders: [{ ...validFolder, logo: 'https://example.com/logo.png' }],
      tags: [],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state?.folders?.[0].logo).toBe(
        'https://example.com/logo.png'
      )
    }
  })

  it('should accept state with only folders (tags optional)', () => {
    const result = parseStorage({ folders: [validFolder] })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.state?.tags).toBeUndefined()
    }
  })

  it('should fail when folder id is missing', () => {
    const { id: _, ...rest } = validFolder
    const result = parseStorage({ folders: [rest], tags: [] })
    expect(result.success).toBe(false)
  })

  it('should fail when folder name is missing', () => {
    const { name: _, ...rest } = validFolder
    const result = parseStorage({ folders: [rest], tags: [] })
    expect(result.success).toBe(false)
  })

  it('should fail when folder updatedAt is missing', () => {
    const { updatedAt: _, ...rest } = validFolder
    const result = parseStorage({ folders: [rest], tags: [] })
    expect(result.success).toBe(false)
  })

  it('should fail when folder updatedAt is a string', () => {
    const result = parseStorage({
      folders: [{ ...validFolder, updatedAt: 'yesterday' }],
      tags: [],
    })
    expect(result.success).toBe(false)
  })

  it('should fail when a tag has extra wrong-typed fields', () => {
    const result = parseStorage({
      folders: [],
      tags: [{ id: 't1', name: 42 }],
    })
    expect(result.success).toBe(false)
  })

  it('should fail when tags contains invalid items', () => {
    const result = parseStorage({ folders: [], tags: [{ invalid: true }] })
    expect(result.success).toBe(false)
  })

  it('should fail when given a non-object', () => {
    expect(chatOrganizationStorageSchema.safeParse('nope').success).toBe(false)
  })

  it('should fail when given null', () => {
    expect(chatOrganizationStorageSchema.safeParse(null).success).toBe(false)
  })
})
