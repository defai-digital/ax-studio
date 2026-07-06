import { describe, it, expect, beforeEach } from 'vitest'
import {
  useFileRegistry,
  threadCollectionId,
  projectCollectionId,
} from '../file-registry'
import type { FileRegistryEntry } from '../file-registry'

function makeEntry(
  overrides: Partial<FileRegistryEntry> = {}
): FileRegistryEntry {
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
      expect(
        useFileRegistry.getState().listFiles('thread_abc')[0].file_id
      ).toBe('file-001')
    })

    it('adds multiple files to the same collection', () => {
      useFileRegistry
        .getState()
        .addFile('col', makeEntry({ file_id: 'f1', file_path: '/a' }))
      useFileRegistry
        .getState()
        .addFile('col', makeEntry({ file_id: 'f2', file_path: '/b' }))
      expect(useFileRegistry.getState().listFiles('col')).toHaveLength(2)
    })

    it('prevents duplicate files by path within same collection', () => {
      const entry = makeEntry()
      useFileRegistry.getState().addFile('col', entry)
      useFileRegistry
        .getState()
        .addFile('col', { ...entry, file_id: 'different-id' })
      expect(useFileRegistry.getState().listFiles('col')).toHaveLength(1)
    })

    it('allows same path in different collections', () => {
      const entry = makeEntry()
      useFileRegistry.getState().addFile('col-a', entry)
      useFileRegistry.getState().addFile('col-b', entry)
      expect(useFileRegistry.getState().listFiles('col-a')).toHaveLength(1)
      expect(useFileRegistry.getState().listFiles('col-b')).toHaveLength(1)
    })

    it('ignores invalid collection ids and file entries', () => {
      useFileRegistry.getState().addFile('   ', makeEntry())
      useFileRegistry.getState().addFile(
        'col',
        makeEntry({ file_id: '', file_path: '/valid' })
      )
      useFileRegistry.getState().addFile(
        'col',
        makeEntry({ file_id: 'valid', file_path: '   ' })
      )
      useFileRegistry.getState().addFile(
        'col',
        makeEntry({
          file_id: 'negative-chunks',
          file_path: '/negative-chunks',
          chunk_count: -1,
        })
      )

      expect(useFileRegistry.getState().files).toEqual({})
    })
  })

  describe('removeFile', () => {
    it('removes a file by id', () => {
      useFileRegistry
        .getState()
        .addFile('col', makeEntry({ file_id: 'f1', file_path: '/a' }))
      useFileRegistry
        .getState()
        .addFile('col', makeEntry({ file_id: 'f2', file_path: '/b' }))
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
      useFileRegistry
        .getState()
        .addFile('col', makeEntry({ file_id: 'target' }))
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
      useFileRegistry
        .getState()
        .addFile('col', makeEntry({ file_id: 'f1', file_path: '/a' }))
      useFileRegistry
        .getState()
        .addFile('col', makeEntry({ file_id: 'f2', file_path: '/b' }))
      useFileRegistry.getState().clearCollection('col')
      expect(useFileRegistry.getState().listFiles('col')).toEqual([])
      expect(useFileRegistry.getState().files['col']).toBeUndefined()
    })

    it('does not affect other collections', () => {
      useFileRegistry
        .getState()
        .addFile('col-a', makeEntry({ file_path: '/a' }))
      useFileRegistry
        .getState()
        .addFile('col-b', makeEntry({ file_path: '/b' }))
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

  describe('persisted state', () => {
    it('sanitizes malformed persisted files during merge', () => {
      const merge = useFileRegistry.persist.getOptions().merge
      const current = useFileRegistry.getState()

      const merged = merge?.(
        {
          files: {
            '': [makeEntry({ file_id: 'blank-collection' })],
            thread_abc: [
              makeEntry({
                file_id: ' keep ',
                file_name: ' report.pdf ',
                file_path: ' /tmp/report.pdf ',
                file_type: 42,
                file_size: -1,
                chunk_count: 5.9,
                collection_id: 'wrong_collection',
                created_at: ' 2026-01-01T00:00:00.000Z ',
              } as unknown as Partial<FileRegistryEntry>),
              makeEntry({
                file_id: 'duplicate-path',
                file_path: '/tmp/report.pdf',
              }),
              makeEntry({
                file_id: '',
                file_path: '/tmp/invalid.pdf',
              }),
            ],
            broken: { not: 'an-array' },
          },
        },
        current
      )

      expect(merged?.files).toEqual({
        thread_abc: [
          {
            file_id: 'keep',
            file_name: 'report.pdf',
            file_path: '/tmp/report.pdf',
            file_type: undefined,
            file_size: undefined,
            chunk_count: 5,
            collection_id: 'thread_abc',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    })

    it('caps persisted collections and files per collection', () => {
      const merge = useFileRegistry.persist.getOptions().merge
      const current = useFileRegistry.getState()
      const files = Object.fromEntries(
        Array.from({ length: 205 }, (_, collectionIndex) => [
          `collection_${collectionIndex}`,
          Array.from({ length: 505 }, (_, fileIndex) =>
            makeEntry({
              file_id: `file-${collectionIndex}-${fileIndex}`,
              file_path: `/tmp/${collectionIndex}/${fileIndex}`,
              collection_id: `collection_${collectionIndex}`,
            })
          ),
        ])
      )

      const merged = merge?.({ files }, current)
      const collectionKeys = Object.keys(merged?.files ?? {})

      expect(collectionKeys).toHaveLength(200)
      expect(collectionKeys[0]).toBe('collection_5')
      expect(merged?.files.collection_204).toHaveLength(500)
    })
  })
})
