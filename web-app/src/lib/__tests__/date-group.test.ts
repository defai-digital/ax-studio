import { describe, it, expect } from 'vitest'
import { getDateGroup, groupByDate, type DateGroup } from '../date-group'

// Helper: create a Date that is `daysAgo` days before now, at local midnight
function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

// ─── A. Specification Tests ─────────────────────────────────────────────────

describe('getDateGroup', () => {
  it('returns "Today" for current date', () => {
    expect(getDateGroup(new Date())).toBe('Today')
  })

  it('returns "Today" for earlier today', () => {
    const earlier = new Date()
    earlier.setHours(1, 0, 0, 0)
    expect(getDateGroup(earlier)).toBe('Today')
  })

  it('returns "Yesterday" for one day ago', () => {
    expect(getDateGroup(daysAgo(1))).toBe('Yesterday')
  })

  it('returns "This Week" for 2 days ago', () => {
    expect(getDateGroup(daysAgo(2))).toBe('This Week')
  })

  it('returns "This Week" for 7 days ago', () => {
    expect(getDateGroup(daysAgo(7))).toBe('This Week')
  })

  it('returns "This Month" for 8 days ago', () => {
    expect(getDateGroup(daysAgo(8))).toBe('This Month')
  })

  it('returns "This Month" for 30 days ago', () => {
    expect(getDateGroup(daysAgo(30))).toBe('This Month')
  })

  it('returns "Older" for 31 days ago', () => {
    expect(getDateGroup(daysAgo(31))).toBe('Older')
  })

  it('returns "Older" for 365 days ago', () => {
    expect(getDateGroup(daysAgo(365))).toBe('Older')
  })

  it('accepts a numeric timestamp', () => {
    expect(getDateGroup(Date.now())).toBe('Today')
  })

  it('accepts an ISO string', () => {
    expect(getDateGroup(new Date().toISOString())).toBe('Today')
  })
})

// ─── B. Attack Tests (Bug Exposing) ────────────────────────────────────────

describe('getDateGroup — edge cases', () => {
  it('DISCOVERED BUG: future dates incorrectly classified as "This Week"', () => {
    // BUG: diffDays for tomorrow is -1, and -1 <= 7 is true,
    // so future dates fall into "This Week" instead of a dedicated group.
    // This test documents the current (buggy) behavior.
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    // Current behavior: returns 'This Week' because diffDays=-1 passes `<= 7`
    expect(getDateGroup(tomorrow)).toBe('This Week')
  })

  it('returns "Older" for invalid date input (NaN propagation)', () => {
    // DISCOVERED BUG: no validation — NaN diffDays falls through to "Older"
    expect(getDateGroup('not-a-date')).toBe('Older')
  })

  it('handles midnight boundary — end of yesterday', () => {
    const endOfYesterday = daysAgo(1)
    endOfYesterday.setHours(23, 59, 59, 999)
    expect(getDateGroup(endOfYesterday)).toBe('Yesterday')
  })

  it('handles midnight boundary — start of today', () => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    expect(getDateGroup(startOfToday)).toBe('Today')
  })
})

// ─── C. Property Tests ─────────────────────────────────────────────────────

describe('getDateGroup — properties', () => {
  it('always returns a valid DateGroup value', () => {
    const validGroups: DateGroup[] = [
      'Pinned',
      'Today',
      'Yesterday',
      'This Week',
      'This Month',
      'Older',
    ]
    const testDays = [0, 1, 2, 5, 7, 8, 15, 30, 31, 100, 365]
    for (const d of testDays) {
      expect(validGroups).toContain(getDateGroup(daysAgo(d)))
    }
  })

  it('groups are monotonically ordered: more recent dates never get a later group', () => {
    const groupRank: Record<string, number> = {
      Today: 0,
      Yesterday: 1,
      'This Week': 2,
      'This Month': 3,
      Older: 4,
    }
    let prevRank = -1
    for (let d = 0; d <= 60; d++) {
      const group = getDateGroup(daysAgo(d))
      const rank = groupRank[group]
      expect(rank).toBeGreaterThanOrEqual(prevRank)
      prevRank = rank
    }
  })
})

// ─── groupByDate ────────────────────────────────────────────────────────────

describe('groupByDate', () => {
  interface TestItem {
    id: string
    createdAt: Date
  }

  const makeItem = (id: string, date: Date): TestItem => ({
    id,
    createdAt: date,
  })

  it('returns empty array for empty input', () => {
    const result = groupByDate<TestItem>([], (i) => i.createdAt)
    expect(result).toEqual([])
  })

  it('groups items into correct date groups', () => {
    const items = [
      makeItem('a', daysAgo(0)),
      makeItem('b', daysAgo(1)),
      makeItem('c', daysAgo(5)),
      makeItem('d', daysAgo(20)),
      makeItem('e', daysAgo(60)),
    ]
    const result = groupByDate(items, (i) => i.createdAt)

    const groupNames = result.map((g) => g.group)
    expect(groupNames).toEqual([
      'Today',
      'Yesterday',
      'This Week',
      'This Month',
      'Older',
    ])
  })

  it('preserves total item count (no items lost)', () => {
    const items = [
      makeItem('a', daysAgo(0)),
      makeItem('b', daysAgo(1)),
      makeItem('c', daysAgo(3)),
      makeItem('d', daysAgo(10)),
    ]
    const result = groupByDate(items, (i) => i.createdAt)
    const totalItems = result.reduce((sum, g) => sum + g.items.length, 0)
    expect(totalItems).toBe(items.length)
  })

  it('puts pinned items in the Pinned group', () => {
    const items = [
      makeItem('a', daysAgo(0)),
      makeItem('b', daysAgo(5)),
      makeItem('c', daysAgo(60)),
    ]
    const pinnedIds = new Set(['b', 'c'])
    const result = groupByDate(
      items,
      (i) => i.createdAt,
      pinnedIds,
      (i) => i.id,
    )

    const pinnedGroup = result.find((g) => g.group === 'Pinned')
    expect(pinnedGroup).not.toBeUndefined()
    expect(pinnedGroup!.items.map((i) => i.id)).toEqual(['b', 'c'])
  })

  it('Pinned group appears before all date groups', () => {
    const items = [
      makeItem('a', daysAgo(0)),
      makeItem('b', daysAgo(1)),
    ]
    const pinnedIds = new Set(['b'])
    const result = groupByDate(
      items,
      (i) => i.createdAt,
      pinnedIds,
      (i) => i.id,
    )

    expect(result[0].group).toBe('Pinned')
  })

  it('ignores pinnedIds when getId is not provided', () => {
    const items = [makeItem('a', daysAgo(0))]
    const pinnedIds = new Set(['a'])
    // No getId provided — pinnedIds should be ignored
    const result = groupByDate(items, (i) => i.createdAt, pinnedIds)
    const hasPinned = result.some((g) => g.group === 'Pinned')
    expect(hasPinned).toBe(false)
  })

  it('only includes groups that have items', () => {
    const items = [makeItem('a', daysAgo(0))]
    const result = groupByDate(items, (i) => i.createdAt)
    expect(result).toHaveLength(1)
    expect(result[0].group).toBe('Today')
  })

  it('maintains group ordering even when items arrive unordered', () => {
    const items = [
      makeItem('old', daysAgo(60)),
      makeItem('today', daysAgo(0)),
      makeItem('week', daysAgo(3)),
    ]
    const result = groupByDate(items, (i) => i.createdAt)
    const groups = result.map((g) => g.group)
    // Order should always be Today < This Week < Older
    expect(groups).toEqual(['Today', 'This Week', 'Older'])
  })

  it('multiple items in the same group preserve insertion order', () => {
    const items = [
      makeItem('a', daysAgo(0)),
      makeItem('b', daysAgo(0)),
      makeItem('c', daysAgo(0)),
    ]
    const result = groupByDate(items, (i) => i.createdAt)
    expect(result[0].items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
})
