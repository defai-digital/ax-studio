import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAxBiSessions } from '../ax-bi-session-store'

let idCounter = 0

vi.mock('ulidx', () => ({
  ulid: () => `ax-bi-${++idCounter}`,
}))

describe('useAxBiSessions', () => {
  beforeEach(() => {
    idCounter = 0
    useAxBiSessions.getState().reset()
  })

  it('creates a dedicated active Ax-BI session', () => {
    const session = useAxBiSessions
      .getState()
      .createSession({ title: 'Revenue dashboard' })

    expect(session.id).toBe('ax-bi-1')
    expect(useAxBiSessions.getState().activeSessionId).toBe(session.id)
    expect(useAxBiSessions.getState().sessions[session.id]?.title).toBe(
      'Revenue dashboard'
    )
  })

  it('records prompt runs without touching other sessions', () => {
    const first = useAxBiSessions
      .getState()
      .createSession({ title: 'First', prompt: 'Chart sales by region' })
    const second = useAxBiSessions
      .getState()
      .createSession({ title: 'Second', prompt: 'Chart margin by product' })

    useAxBiSessions.getState().recordRun(first.id, {
      status: 'ready',
      message: 'Created chart',
      url: 'http://127.0.0.1:8080/explore/?slice_id=1',
    })

    const state = useAxBiSessions.getState()
    expect(state.sessions[first.id]?.runs).toHaveLength(1)
    expect(state.sessions[first.id]?.runs[0]?.prompt).toBe(
      'Chart sales by region'
    )
    expect(state.sessions[first.id]?.runs[0]?.message).toBe('Created chart')
    expect(state.sessions[first.id]?.runs[0]?.url).toBe(
      'http://127.0.0.1:8080/explore/?slice_id=1'
    )
    expect(state.sessions[second.id]?.runs).toHaveLength(0)
  })

  it('records the submitted prompt even if the draft changes before completion', () => {
    const session = useAxBiSessions
      .getState()
      .createSession({ title: 'Draft', prompt: 'Original prompt' })

    useAxBiSessions
      .getState()
      .updateSession(session.id, { prompt: 'Edited prompt' })

    useAxBiSessions.getState().recordRun(session.id, {
      status: 'ready',
      message: 'Created chart',
      prompt: 'Original prompt',
    })

    expect(
      useAxBiSessions.getState().sessions[session.id]?.runs[0]?.prompt
    ).toBe('Original prompt')
  })

  it('moves active selection when deleting the active session', () => {
    const first = useAxBiSessions.getState().createSession({ title: 'First' })
    const second = useAxBiSessions.getState().createSession({ title: 'Second' })

    useAxBiSessions.getState().deleteSession(second.id)

    expect(useAxBiSessions.getState().sessions[second.id]).toBeUndefined()
    expect(useAxBiSessions.getState().activeSessionId).toBe(first.id)
  })
})
