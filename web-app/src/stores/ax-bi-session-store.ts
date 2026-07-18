import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ulid } from 'ulidx'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'

export type AxBiSessionStatus = 'idle' | 'draft' | 'running' | 'ready' | 'error'
type AxBiRunStatus = Extract<AxBiSessionStatus, 'ready' | 'error'>

export type AxBiRun = {
  id: string
  prompt: string
  message: string
  status: AxBiRunStatus
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
  status: AxBiRunStatus
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

const SESSION_STATUSES = new Set<AxBiSessionStatus>([
  'idle',
  'draft',
  'running',
  'ready',
  'error',
])
const RUN_STATUSES = new Set<AxBiRunStatus>(['ready', 'error'])
const MAX_SESSIONS = 50
const MAX_RUNS_PER_SESSION = 20

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeNonEmptyString(
  value: unknown,
  fallback: string
): string {
  const normalized = normalizeString(value).trim()
  return normalized || fallback
}

function isSessionStatus(value: unknown): value is AxBiSessionStatus {
  return (
    typeof value === 'string' &&
    SESSION_STATUSES.has(value as AxBiSessionStatus)
  )
}

function isRunStatus(value: unknown): value is AxBiRunStatus {
  return typeof value === 'string' && RUN_STATUSES.has(value as AxBiRunStatus)
}

function normalizeIsoString(value: unknown, fallback: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? value
    : fallback
}

function normalizeAxBiRun(value: unknown): AxBiRun | undefined {
  if (!isPlainRecord(value)) return undefined

  const id = normalizeNonEmptyString(value.id, '')
  const prompt = normalizeNonEmptyString(value.prompt, '')
  const message = normalizeString(value.message)
  const now = new Date().toISOString()
  const createdAt = normalizeIsoString(value.createdAt, now)

  if (!id || !prompt || !isRunStatus(value.status)) return undefined

  return {
    id,
    prompt,
    message,
    status: value.status,
    url: typeof value.url === 'string' ? value.url : undefined,
    createdAt,
  }
}

function normalizeAxBiSession(
  sessionId: string,
  value: unknown
): AxBiSession | undefined {
  if (!isPlainRecord(value)) return undefined

  const now = new Date().toISOString()
  const runs = Array.isArray(value.runs)
    ? value.runs
        .map(normalizeAxBiRun)
        .filter((run): run is AxBiRun => run !== undefined)
        .slice(0, MAX_RUNS_PER_SESSION)
    : []

  return {
    id: sessionId,
    title: normalizeNonEmptyString(value.title, 'Untitled analysis'),
    source: normalizeString(value.source),
    prompt: normalizeString(value.prompt),
    status: isSessionStatus(value.status) ? value.status : 'idle',
    runs,
    createdAt: normalizeIsoString(value.createdAt, now),
    updatedAt: normalizeIsoString(value.updatedAt, now),
  }
}

function normalizeSessions(value: unknown): Record<string, AxBiSession> {
  if (!isPlainRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .map(([sessionId, session]) => [sessionId.trim(), session] as const)
      .filter(([sessionId]) => sessionId !== '')
      .slice(-MAX_SESSIONS)
      .map(([sessionId, session]) => [
        sessionId,
        normalizeAxBiSession(sessionId, session),
      ])
      .filter(
        (entry): entry is [string, AxBiSession] => entry[1] !== undefined
      )
  )
}

function getOwnSession(
  sessions: Record<string, AxBiSession>,
  sessionId: string
): AxBiSession | undefined {
  return Object.prototype.hasOwnProperty.call(sessions, sessionId)
    ? sessions[sessionId]
    : undefined
}

function sanitizePersistedAxBiSessions(
  persisted: unknown,
  current: AxBiSessionState
): AxBiSessionState {
  if (!isPlainRecord(persisted)) return current

  const sessions = normalizeSessions(persisted.sessions)
  const activeSessionId =
    typeof persisted.activeSessionId === 'string' &&
    getOwnSession(sessions, persisted.activeSessionId)
      ? persisted.activeSessionId
      : undefined

  return {
    ...current,
    sessions,
    activeSessionId,
  }
}

function createAxBiSession(draft: AxBiSessionDraft = {}): AxBiSession {
  const now = new Date().toISOString()
  return {
    id: ulid(),
    title: normalizeNonEmptyString(draft.title, 'Untitled analysis'),
    source: normalizeString(draft.source),
    prompt: normalizeString(draft.prompt),
    status: isSessionStatus(draft.status) ? draft.status : 'idle',
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
        if (!getOwnSession(get().sessions, sessionId)) return
        set({ activeSessionId: sessionId })
      },

      updateSession: (sessionId, patch) => {
        set((state) => {
          const session = getOwnSession(state.sessions, sessionId)
          if (!session) return state
          const nextStatus =
            patch.status === undefined
              ? session.status
              : isSessionStatus(patch.status)
                ? patch.status
                : session.status

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                title:
                  typeof patch.title !== 'string'
                    ? session.title
                    : patch.title.trim() || session.title,
                source:
                  typeof patch.source === 'string'
                    ? patch.source
                    : session.source,
                prompt:
                  typeof patch.prompt === 'string'
                    ? patch.prompt
                    : session.prompt,
                status: nextStatus,
                updatedAt: new Date().toISOString(),
              },
            },
          }
        })
      },

      deleteSession: (sessionId) => {
        set((state) => {
          if (!getOwnSession(state.sessions, sessionId)) return state
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
          const session = getOwnSession(state.sessions, sessionId)
          const submittedPrompt =
            typeof outcome.prompt === 'string' ? outcome.prompt.trim() : ''
          const prompt = submittedPrompt || session?.prompt.trim()
          if (!session || !prompt || !isRunStatus(outcome.status)) return state

          const now = new Date().toISOString()
          const run: AxBiRun = {
            id: ulid(),
            prompt,
            message: normalizeString(outcome.message),
            status: outcome.status,
            url: typeof outcome.url === 'string' ? outcome.url : undefined,
            createdAt: now,
          }

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                status: outcome.status,
                runs: [run, ...session.runs].slice(0, MAX_RUNS_PER_SESSION),
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
      merge: (persisted, current) =>
        sanitizePersistedAxBiSessions(persisted, current),
      partialize: (state) => ({
        sessions: normalizeSessions(state.sessions),
        activeSessionId: state.activeSessionId,
      }),
    }
  )
)
