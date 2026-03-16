/**
 * Groups items by date proximity (Today, Yesterday, This Week, This Month, Older).
 * Uses native Date — no date-fns dependency.
 */

export type DateGroup =
  | 'Pinned'
  | 'Today'
  | 'Yesterday'
  | 'This Week'
  | 'This Month'
  | 'Older'

const MS_PER_DAY = 86_400_000

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function getDateGroup(date: Date | string | number): DateGroup {
  const now = startOfDay(new Date())
  const target = startOfDay(new Date(date))
  const diffDays = Math.floor(
    (now.getTime() - target.getTime()) / MS_PER_DAY,
  )

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays <= 7) return 'This Week'
  if (diffDays <= 30) return 'This Month'
  return 'Older'
}

export interface GroupedItem<T> {
  group: DateGroup
  items: T[]
}

/**
 * Groups an array of items by their date into ordered sections.
 * @param items - Array of items to group
 * @param getDate - Accessor function to extract a date from each item
 * @param pinnedIds - Optional set of IDs that should go into the "Pinned" group
 * @param getId - Accessor to extract ID from each item (required if pinnedIds is provided)
 */
export function groupByDate<T>(
  items: T[],
  getDate: (item: T) => Date | string | number,
  pinnedIds?: Set<string>,
  getId?: (item: T) => string,
): GroupedItem<T>[] {
  const groupOrder: DateGroup[] = [
    'Pinned',
    'Today',
    'Yesterday',
    'This Week',
    'This Month',
    'Older',
  ]

  const groups = new Map<DateGroup, T[]>()

  for (const item of items) {
    let group: DateGroup

    if (pinnedIds && getId && pinnedIds.has(getId(item))) {
      group = 'Pinned'
    } else {
      group = getDateGroup(getDate(item))
    }

    const existing = groups.get(group)
    if (existing) {
      existing.push(item)
    } else {
      groups.set(group, [item])
    }
  }

  return groupOrder
    .filter((g) => groups.has(g))
    .map((group) => ({
      group,
      items: groups.get(group)!,
    }))
}
