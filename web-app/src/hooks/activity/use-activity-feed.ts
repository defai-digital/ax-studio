import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type ActivityType = 'research' | 'edit' | 'knowledge-base' | 'chat' | 'agent-team'

export interface ActivityEvent {
  id: string
  type: ActivityType
  /** Plain-language description (e.g., "Research completed: Q1 Analysis") */
  title: string
  /** Additional detail (e.g., "Found 12 sources, generated 2-page report") */
  detail?: string
  /** Thread ID for navigation */
  threadId?: string
  /** Thread title for display */
  threadTitle?: string
  /** Project name for filtering */
  projectName?: string
  timestamp: number
}

interface ActivityFeedState {
  events: ActivityEvent[]
  /** Add a new activity event */
  addEvent: (event: Omit<ActivityEvent, 'id' | 'timestamp'>) => void
  /** Get events for a date range */
  getEventsForDate: (date: Date) => ActivityEvent[]
  /** Clear all events */
  clearEvents: () => void
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** Max events to keep (rolling window) */
const MAX_EVENTS = 500

export const useActivityFeed = create<ActivityFeedState>()(
  persist(
    (set, get) => ({
      events: [],

      addEvent: (event) =>
        set((state) => {
          const newEvent: ActivityEvent = {
            ...event,
            id: generateId(),
            timestamp: Date.now(),
          }
          const events = [newEvent, ...state.events].slice(0, MAX_EVENTS)
          return { events }
        }),

      getEventsForDate: (date) => {
        const start = new Date(date)
        start.setHours(0, 0, 0, 0)
        const end = new Date(date)
        end.setHours(23, 59, 59, 999)
        return get().events.filter(
          (e) => e.timestamp >= start.getTime() && e.timestamp <= end.getTime()
        )
      },

      clearEvents: () => set({ events: [] }),
    }),
    {
      name: 'ax-activity-feed',
      storage: createJSONStorage(() => localStorage),
    }
  )
)

/**
 * Group events by date label (Today, Yesterday, This Week, Earlier).
 */
export function groupEventsByDate(events: ActivityEvent[]): Array<{ label: string; events: ActivityEvent[] }> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const groups: Record<string, ActivityEvent[]> = {
    Today: [],
    Yesterday: [],
    'This Week': [],
    Earlier: [],
  }

  for (const event of events) {
    const d = new Date(event.timestamp)
    if (d >= today) {
      groups['Today'].push(event)
    } else if (d >= yesterday) {
      groups['Yesterday'].push(event)
    } else if (d >= weekAgo) {
      groups['This Week'].push(event)
    } else {
      groups['Earlier'].push(event)
    }
  }

  return Object.entries(groups)
    .filter(([, events]) => events.length > 0)
    .map(([label, events]) => ({ label, events }))
}
