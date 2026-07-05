import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ulid } from 'ulidx'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'

export type AxBiSessionStatus = 'idle' | 'draft' | 'running' | 'ready' | 'error'

export type AxBiRun = {
  id: string
  prompt: string
  message: string
  status: Extract<AxBiSessionStatus, 'ready' | 'error'>
  url?: string
  createdAt: string
}

export type AxBiSession = {
  id: string
  title: string
  source: string
  prompt: string
  status: AxBiSessionStatus
  runs: AxBiRun[]
  createdAt: string
  updatedAt: string
}

type AxBiSessionDraft = Partial<
  Pick<AxBiSession, 'title' | 'source' | 'prompt' | 'status'>
>

type AxBiRunOutcome = {
  status: Extract<AxBiSessionStatus, 'ready' | 'error'>
  message: string
  prompt?: string
  url?: string
}

type AxBiSessionState = {
  sessions: Record<string, AxBiSession>
  activeSessionId?: string
  createSession: (draft?: AxBiSessionDraft) => AxBiSession
  setActiveSession: (sessionId: string) => void
  updateSession: (sessionId: string, patch: AxBiSessionDraft) => void
  deleteSession: (sessionId: string) => void
  recordRun: (sessionId: string, outcome: AxBiRunOutcome) => void
  reset: () => void
}

function createAxBiSession(draft: AxBiSessionDraft = {}): AxBiSession {
  const now = new Date().toISOString()
  return {
    id: ulid(),
    title: draft.title?.trim() || 'Untitled analysis',
    source: draft.source ?? '',
    prompt: draft.prompt ?? '',
    status: draft.status ?? 'idle',
    runs: [],
    createdAt: now,
    updatedAt: now,
  }
}

function chooseNextActiveSession(
  sessions: Record<string, AxBiSession>,
  removedSessionId: string
): string | undefined {
  return Object.values(sessions)
    .filter((session) => session.id !== removedSessionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id
}

export const useAxBiSessions = create<AxBiSessionState>()(
  persist(
    (set, get) => ({
      sessions: {},
      activeSessionId: undefined,

      createSession: (draft) => {
        const session = createAxBiSession(draft)
        set((state) => ({
          sessions: {
            ...state.sessions,
            [session.id]: session,
          },
          activeSessionId: session.id,
        }))
        return session
      },

      setActiveSession: (sessionId) => {
        if (!get().sessions[sessionId]) return
        set({ activeSessionId: sessionId })
      },

      updateSession: (sessionId, patch) => {
        set((state) => {
          const session = state.sessions[sessionId]
          if (!session) return state

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                ...patch,
                title: patch.title ?? session.title,
                updatedAt: new Date().toISOString(),
              },
            },
          }
        })
      },

      deleteSession: (sessionId) => {
        set((state) => {
          if (!state.sessions[sessionId]) return state
          const { [sessionId]: _removed, ...remainingSessions } = state.sessions
          const nextActiveSessionId =
            state.activeSessionId === sessionId
              ? chooseNextActiveSession(state.sessions, sessionId)
              : state.activeSessionId

          return {
            sessions: remainingSessions,
            activeSessionId: nextActiveSessionId,
          }
        })
      },

      recordRun: (sessionId, outcome) => {
        set((state) => {
          const session = state.sessions[sessionId]
          const prompt = outcome.prompt?.trim() || session?.prompt.trim()
          if (!session || !prompt) return state

          const now = new Date().toISOString()
          const run: AxBiRun = {
            id: ulid(),
            prompt,
            message: outcome.message,
            status: outcome.status,
            url: outcome.url,
            createdAt: now,
          }

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                status: outcome.status,
                runs: [run, ...session.runs].slice(0, 20),
                updatedAt: now,
              },
            },
          }
        })
      },

      reset: () => set({ sessions: {}, activeSessionId: undefined }),
    }),
    {
      name: localStorageKey.axBiSessions,
      storage: createSafeJSONStorage(() => localStorage, 'useAxBiSessions'),
    }
  )
)
