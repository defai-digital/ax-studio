import { useAxBiSessions } from '@/stores/ax-bi-session-store'

/**
 * Compatibility history for chat-first AX BI: delegations are kept in one
 * bounded local session so activity recorded by older builds remains valid.
 * There is no separate workspace route; the visible result stays in chat.
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
