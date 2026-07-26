import { useAxBiSessions } from '@/stores/ax-bi-session-store'

/**
 * Chat-first run history (migration matrix §4): AX BI delegations that happen
 * in the main chat (and quick runs from the slim `/ax-bi` page) are recorded
 * into a single rolling session so the demoted `/ax-bi` history view has
 * something to show. Electron-only callers — the Tauri workspace records its
 * own per-session runs.
 */
const CHAT_SESSION_TITLE = 'Chat analyses'

export type AxBiChatRunOutcome = {
  prompt: string
  message: string
  status: 'ready' | 'error'
  url?: string
}

export function recordAxBiChatRun(outcome: AxBiChatRunOutcome): void {
  const state = useAxBiSessions.getState()
  const existing = Object.values(state.sessions)
    .filter((session) => session.title === CHAT_SESSION_TITLE)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  const session = existing ?? state.createSession({ title: CHAT_SESSION_TITLE })
  state.recordRun(session.id, outcome)
}
