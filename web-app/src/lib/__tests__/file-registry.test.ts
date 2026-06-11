import { describe, it, expect, beforeEach } from 'vitest'
import { useFileRegistry, threadCollectionId, projectCollectionId } from '../file-registry'
import type { FileRegistryEntry } from '../file-registry'

function makeEntry(overrides: Partial<FileRegistryEntry> = {}): FileRegistryEntry {
  return {
    file_id: 'file-001',
    file_name: 'report.pdf',
    file_path: '/tmp/report.pdf',
    file_type: 'pdf',
    file_size: 1024,
    chunk_count: 5,
    collection_id: 'thread_abc',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('file-registry', () => {
  beforeEach(() => {
    // Reset store state between tests
    useFileRegistry.setState({ files: {} })
  })

  describe('threadCollectionId / projectCollectionId', () => {
    it('builds thread collection id', () => {
      expect(threadCollectionId('abc123')).toBe('thread_abc123')
    })

    it('builds project collection id', () => {
      expect(projectCollectionId('proj-1')).toBe('project_proj-1')
    })
  })

  describe('addFile', () => {
    it('adds a file to a new collection', () => {
      const entry = makeEntry()
      useFileRegistry.getState().addFile('thread_abc', entry)
      expect(useFileRegistry.getState().listFiles('thread_abc')).toHaveLength(1)
      expect(useFileRegistry.getState().listFiles('thread_abc')[0].file_id).toBe('file-001')
    })

    it('adds multiple files to the same collection', () => {
      useFileRegistry.getState().addFile('col', makeEntry({ file_id: 'f1', file_path: '/a' }))
      useFileRegistry.getState().addFile('col', makeEntry({ file_id: 'f2', file_path: '/b' }))
      expect(useFileRegistry.getState().listFiles('col')).toHaveLength(2)
    })

    it('prevents duplicate files by path within same collection', () => {
      const entry = makeEntry()
      useFileRegistry.getState().addFile('col', entry)
      useFileRegistry.getState().addFile('col', { ...entry, file_id: 'different-id' })
      expect(useFileRegistry.getState().listFiles('col')).toHaveLength(1)
    })

    it('allows same path in different collections', () => {
      const entry = makeEntry()
      useFileRegistry.getState().addFile('col-a', entry)
      useFileRegistry.getState().addFile('col-b', entry)
      expect(useFileRegistry.getState().listFiles('col-a')).toHaveLength(1)
      expect(useFileRegistry.getState().listFiles('col-b')).toHaveLength(1)
    })
  })

  describe('removeFile', () => {
    it('removes a file by id', () => {
      useFileRegistry.getState().addFile('col', makeEntry({ file_id: 'f1', file_path: '/a' }))
      useFileRegistry.getState().addFile('col', makeEntry({ file_id: 'f2', file_path: '/b' }))
      useFileRegistry.getState().removeFile('col', 'f1')
      const files = useFileRegistry.getState().listFiles('col')
      expect(files).toHaveLength(1)
      expect(files[0].file_id).toBe('f2')
    })

    it('removes collection key when last file is removed', () => {
      useFileRegistry.getState().addFile('col', makeEntry())
      useFileRegistry.getState().removeFile('col', 'file-001')
      expect(useFileRegistry.getState().files['col']).toBeUndefined()
    })

    it('does nothing for non-existent collection', () => {
      useFileRegistry.getState().removeFile('nonexistent', 'f1')
      expect(useFileRegistry.getState().listFiles('nonexistent')).toEqual([])
    })

    it('does nothing for non-existent file id', () => {
      useFileRegistry.getState().addFile('col', makeEntry())
      useFileRegistry.getState().removeFile('col', 'nonexistent')
      expect(useFileRegistry.getState().listFiles('col')).toHaveLength(1)
    })
  })

  describe('listFiles', () => {
    it('returns empty array for unknown collection', () => {
      expect(useFileRegistry.getState().listFiles('unknown')).toEqual([])
    })
  })

  describe('getFile', () => {
    it('returns file by id', () => {
      useFileRegistry.getState().addFile('col', makeEntry({ file_id: 'target' }))
      const found = useFileRegistry.getState().getFile('col', 'target')
      expect(found).toBeDefined()
      expect(found!.file_id).toBe('target')
    })

    it('returns undefined for unknown file', () => {
      expect(useFileRegistry.getState().getFile('col', 'nope')).toBeUndefined()
    })
  })

  describe('clearCollection', () => {
    it('removes all files for a collection', () => {
      useFileRegistry.getState().addFile('col', makeEntry({ file_id: 'f1', file_path: '/a' }))
      useFileRegistry.getState().addFile('col', makeEntry({ file_id: 'f2', file_path: '/b' }))
      useFileRegistry.getState().clearCollection('col')
      expect(useFileRegistry.getState().listFiles('col')).toEqual([])
      expect(useFileRegistry.getState().files['col']).toBeUndefined()
    })

    it('does not affect other collections', () => {
      useFileRegistry.getState().addFile('col-a', makeEntry({ file_path: '/a' }))
      useFileRegistry.getState().addFile('col-b', makeEntry({ file_path: '/b' }))
      useFileRegistry.getState().clearCollection('col-a')
      expect(useFileRegistry.getState().listFiles('col-b')).toHaveLength(1)
    })
  })

  describe('hasFiles', () => {
    it('returns false for empty collection', () => {
      expect(useFileRegistry.getState().hasFiles('col')).toBe(false)
    })

    it('returns true when files exist', () => {
      useFileRegistry.getState().addFile('col', makeEntry())
      expect(useFileRegistry.getState().hasFiles('col')).toBe(true)
    })

    it('returns false after clearing', () => {
      useFileRegistry.getState().addFile('col', makeEntry())
      useFileRegistry.getState().clearCollection('col')
      expect(useFileRegistry.getState().hasFiles('col')).toBe(false)
    })
  })
})
