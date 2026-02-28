import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMemory, MEMORY_LIMIT } from '../useMemory'
import type { MemoryEntry } from '../useMemory'

// Mock zustand persist to just pass through the store creator
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

// Mock localStorage key
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    memoryStore: 'memory-store',
  },
}))

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now()
  return {
    id: `mem-${now}-${Math.random()}`,
    fact: 'Test fact',
    sourceThreadId: 'thread-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('useMemory', () => {
  beforeEach(() => {
    // Reset store state before each test
    useMemory.setState({
      memories: {},
      memoryEnabled: false,
      memoryVersion: 0,
    })
  })

  describe('MEMORY_LIMIT', () => {
    it('should export MEMORY_LIMIT as 50', () => {
      expect(MEMORY_LIMIT).toBe(50)
    })
  })

  describe('toggleMemory', () => {
    it('should toggle memoryEnabled from false to true', () => {
      expect(useMemory.getState().memoryEnabled).toBe(false)
      useMemory.getState().toggleMemory()
      expect(useMemory.getState().memoryEnabled).toBe(true)
    })

    it('should toggle memoryEnabled from true to false', () => {
      useMemory.setState({ memoryEnabled: true })
      useMemory.getState().toggleMemory()
      expect(useMemory.getState().memoryEnabled).toBe(false)
    })
  })

  describe('isMemoryEnabled', () => {
    it('should return false when disabled', () => {
      expect(useMemory.getState().isMemoryEnabled()).toBe(false)
    })

    it('should return true when enabled', () => {
      useMemory.setState({ memoryEnabled: true })
      expect(useMemory.getState().isMemoryEnabled()).toBe(true)
    })
  })

  describe('addMemories', () => {
    it('should add entries to an empty user', () => {
      const entry = makeEntry({ id: 'mem-1', fact: 'User likes cats' })
      useMemory.getState().addMemories('default', [entry])
      expect(useMemory.getState().getMemories('default')).toHaveLength(1)
      expect(useMemory.getState().getMemories('default')[0].fact).toBe('User likes cats')
    })

    it('should append entries to existing memories', () => {
      const entry1 = makeEntry({ id: 'mem-1', fact: 'Fact 1' })
      const entry2 = makeEntry({ id: 'mem-2', fact: 'Fact 2' })
      useMemory.getState().addMemories('default', [entry1])
      useMemory.getState().addMemories('default', [entry2])
      expect(useMemory.getState().getMemories('default')).toHaveLength(2)
    })

    it('should not add empty array', () => {
      const versionBefore = useMemory.getState().memoryVersion
      useMemory.getState().addMemories('default', [])
      expect(useMemory.getState().memoryVersion).toBe(versionBefore)
    })

    it('should increment memoryVersion', () => {
      const versionBefore = useMemory.getState().memoryVersion
      useMemory.getState().addMemories('default', [makeEntry()])
      expect(useMemory.getState().memoryVersion).toBe(versionBefore + 1)
    })

    it('should enforce MEMORY_LIMIT by trimming oldest entries', () => {
      // Pre-fill with 48 entries
      const existing: MemoryEntry[] = []
      for (let i = 0; i < 48; i++) {
        existing.push(
          makeEntry({
            id: `mem-existing-${i}`,
            fact: `Existing fact ${i}`,
            updatedAt: 1000 + i, // oldest first
          })
        )
      }
      useMemory.setState({
        memories: { default: existing },
      })

      // Add 5 more — total 53, should be trimmed to 50
      const newEntries: MemoryEntry[] = []
      for (let i = 0; i < 5; i++) {
        newEntries.push(
          makeEntry({
            id: `mem-new-${i}`,
            fact: `New fact ${i}`,
            updatedAt: 2000 + i,
          })
        )
      }
      useMemory.getState().addMemories('default', newEntries)

      const memories = useMemory.getState().getMemories('default')
      expect(memories).toHaveLength(MEMORY_LIMIT)

      // The 3 oldest existing entries (updatedAt 1000, 1001, 1002) should be trimmed
      const ids = memories.map((m) => m.id)
      expect(ids).not.toContain('mem-existing-0')
      expect(ids).not.toContain('mem-existing-1')
      expect(ids).not.toContain('mem-existing-2')

      // All new entries should be present
      expect(ids).toContain('mem-new-0')
      expect(ids).toContain('mem-new-4')
    })

    it('should not trim when under the limit', () => {
      const entries = [
        makeEntry({ id: 'mem-a', fact: 'Fact A' }),
        makeEntry({ id: 'mem-b', fact: 'Fact B' }),
      ]
      useMemory.getState().addMemories('default', entries)
      expect(useMemory.getState().getMemories('default')).toHaveLength(2)
    })
  })

  describe('replaceMemories', () => {
    it('should replace all memories for a user', () => {
      useMemory.getState().addMemories('default', [
        makeEntry({ id: 'old-1', fact: 'Old fact' }),
      ])
      useMemory.getState().replaceMemories('default', ['New fact 1', 'New fact 2'], 'thread-2')

      const memories = useMemory.getState().getMemories('default')
      expect(memories).toHaveLength(2)
      expect(memories[0].fact).toBe('New fact 1')
      expect(memories[1].fact).toBe('New fact 2')
      expect(memories[0].sourceThreadId).toBe('thread-2')
    })

    it('should enforce MEMORY_LIMIT', () => {
      const facts: string[] = []
      for (let i = 0; i < 60; i++) {
        facts.push(`Fact ${i}`)
      }
      useMemory.getState().replaceMemories('default', facts, 'thread-1')

      const memories = useMemory.getState().getMemories('default')
      expect(memories).toHaveLength(MEMORY_LIMIT)

      // Should keep the last 50 (indices 10-59)
      expect(memories[0].fact).toBe('Fact 10')
      expect(memories[49].fact).toBe('Fact 59')
    })

    it('should generate unique ids with mem- prefix', () => {
      useMemory.getState().replaceMemories('default', ['Fact A', 'Fact B'], 'thread-1')
      const memories = useMemory.getState().getMemories('default')
      expect(memories[0].id).toMatch(/^mem-/)
      expect(memories[1].id).toMatch(/^mem-/)
      expect(memories[0].id).not.toBe(memories[1].id)
    })

    it('should set createdAt and updatedAt', () => {
      const before = Date.now()
      useMemory.getState().replaceMemories('default', ['Fact'], 'thread-1')
      const after = Date.now()
      const entry = useMemory.getState().getMemories('default')[0]
      expect(entry.createdAt).toBeGreaterThanOrEqual(before)
      expect(entry.createdAt).toBeLessThanOrEqual(after)
      expect(entry.updatedAt).toBe(entry.createdAt)
    })
  })

  describe('getMemories', () => {
    it('should return empty array for unknown user', () => {
      expect(useMemory.getState().getMemories('unknown-user')).toEqual([])
    })

    it('should return memories for a known user', () => {
      useMemory.getState().addMemories('user1', [makeEntry({ fact: 'User1 fact' })])
      useMemory.getState().addMemories('user2', [makeEntry({ fact: 'User2 fact' })])

      expect(useMemory.getState().getMemories('user1')).toHaveLength(1)
      expect(useMemory.getState().getMemories('user1')[0].fact).toBe('User1 fact')
      expect(useMemory.getState().getMemories('user2')[0].fact).toBe('User2 fact')
    })
  })

  describe('updateMemory', () => {
    it('should update the fact text for a matching memory id', () => {
      useMemory.getState().addMemories('default', [
        makeEntry({ id: 'mem-1', fact: 'Old fact' }),
      ])
      useMemory.getState().updateMemory('default', 'mem-1', 'Updated fact')

      const memories = useMemory.getState().getMemories('default')
      expect(memories[0].fact).toBe('Updated fact')
    })

    it('should update the updatedAt timestamp', () => {
      const oldTime = Date.now() - 10000
      useMemory.getState().addMemories('default', [
        makeEntry({ id: 'mem-1', fact: 'Old fact', updatedAt: oldTime }),
      ])

      const before = Date.now()
      useMemory.getState().updateMemory('default', 'mem-1', 'Updated fact')
      const after = Date.now()

      const entry = useMemory.getState().getMemories('default')[0]
      expect(entry.updatedAt).toBeGreaterThanOrEqual(before)
      expect(entry.updatedAt).toBeLessThanOrEqual(after)
    })

    it('should not change other memories', () => {
      useMemory.getState().addMemories('default', [
        makeEntry({ id: 'mem-1', fact: 'Fact 1' }),
        makeEntry({ id: 'mem-2', fact: 'Fact 2' }),
      ])
      useMemory.getState().updateMemory('default', 'mem-1', 'Updated')

      const memories = useMemory.getState().getMemories('default')
      expect(memories[0].fact).toBe('Updated')
      expect(memories[1].fact).toBe('Fact 2')
    })

    it('should not crash when memory id does not exist', () => {
      useMemory.getState().addMemories('default', [
        makeEntry({ id: 'mem-1', fact: 'Fact 1' }),
      ])
      useMemory.getState().updateMemory('default', 'non-existent', 'Updated')
      expect(useMemory.getState().getMemories('default')[0].fact).toBe('Fact 1')
    })

    it('should not crash when user has no memories', () => {
      useMemory.getState().updateMemory('default', 'mem-1', 'Updated')
      expect(useMemory.getState().getMemories('default')).toEqual([])
    })

    it('should increment memoryVersion', () => {
      useMemory.getState().addMemories('default', [
        makeEntry({ id: 'mem-1', fact: 'Fact' }),
      ])
      const versionBefore = useMemory.getState().memoryVersion
      useMemory.getState().updateMemory('default', 'mem-1', 'New fact')
      expect(useMemory.getState().memoryVersion).toBe(versionBefore + 1)
    })

    it('should preserve createdAt and sourceThreadId', () => {
      const entry = makeEntry({
        id: 'mem-1',
        fact: 'Old',
        sourceThreadId: 'original-thread',
        createdAt: 12345,
      })
      useMemory.getState().addMemories('default', [entry])
      useMemory.getState().updateMemory('default', 'mem-1', 'New')

      const updated = useMemory.getState().getMemories('default')[0]
      expect(updated.sourceThreadId).toBe('original-thread')
      expect(updated.createdAt).toBe(12345)
    })
  })

  describe('deleteMemory', () => {
    it('should delete a memory by id', () => {
      useMemory.getState().addMemories('default', [
        makeEntry({ id: 'mem-1', fact: 'Fact 1' }),
        makeEntry({ id: 'mem-2', fact: 'Fact 2' }),
      ])
      useMemory.getState().deleteMemory('default', 'mem-1')

      const memories = useMemory.getState().getMemories('default')
      expect(memories).toHaveLength(1)
      expect(memories[0].id).toBe('mem-2')
    })

    it('should not crash when deleting non-existent id', () => {
      useMemory.getState().addMemories('default', [
        makeEntry({ id: 'mem-1', fact: 'Fact 1' }),
      ])
      useMemory.getState().deleteMemory('default', 'non-existent')
      expect(useMemory.getState().getMemories('default')).toHaveLength(1)
    })

    it('should increment memoryVersion', () => {
      useMemory.getState().addMemories('default', [makeEntry({ id: 'mem-1' })])
      const versionBefore = useMemory.getState().memoryVersion
      useMemory.getState().deleteMemory('default', 'mem-1')
      expect(useMemory.getState().memoryVersion).toBe(versionBefore + 1)
    })
  })

  describe('clearMemories', () => {
    it('should clear all memories for a user', () => {
      useMemory.getState().addMemories('default', [
        makeEntry({ id: 'mem-1' }),
        makeEntry({ id: 'mem-2' }),
        makeEntry({ id: 'mem-3' }),
      ])
      useMemory.getState().clearMemories('default')
      expect(useMemory.getState().getMemories('default')).toEqual([])
    })

    it('should not affect other users', () => {
      useMemory.getState().addMemories('user1', [makeEntry({ fact: 'User1 fact' })])
      useMemory.getState().addMemories('user2', [makeEntry({ fact: 'User2 fact' })])
      useMemory.getState().clearMemories('user1')

      expect(useMemory.getState().getMemories('user1')).toEqual([])
      expect(useMemory.getState().getMemories('user2')).toHaveLength(1)
    })

    it('should increment memoryVersion', () => {
      const versionBefore = useMemory.getState().memoryVersion
      useMemory.getState().clearMemories('default')
      expect(useMemory.getState().memoryVersion).toBe(versionBefore + 1)
    })
  })

  describe('memory isolation between users', () => {
    it('should keep memories separate per userId', () => {
      useMemory.getState().addMemories('alice', [makeEntry({ fact: 'Alice fact' })])
      useMemory.getState().addMemories('bob', [makeEntry({ fact: 'Bob fact' })])

      expect(useMemory.getState().getMemories('alice')[0].fact).toBe('Alice fact')
      expect(useMemory.getState().getMemories('bob')[0].fact).toBe('Bob fact')
    })
  })
})
