import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAxBiSessions } from '../ax-bi-session-store'
import type { AxBiSession } from '../ax-bi-session-store'

let idCounter = 0

vi.mock('ulidx', () => ({
  ulid: () => `ax-bi-${++idCounter}`,
}))

describe('useAxBiSessions', () => {
  beforeEach(() => {
    idCounter = 0
    useAxBiSessions.getState().reset()
  })

  it('creates a dedicated active AX BI session', () => {
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

  it('keeps the active session when deleting an inactive session', () => {
    const first = useAxBiSessions.getState().createSession({ title: 'First' })
    const second = useAxBiSessions.getState().createSession({ title: 'Second' })

    useAxBiSessions.getState().setActiveSession(second.id)
    useAxBiSessions.getState().deleteSession(first.id)

    expect(useAxBiSessions.getState().sessions[first.id]).toBeUndefined()
    expect(useAxBiSessions.getState().activeSessionId).toBe(second.id)
  })

  it('sanitizes malformed persisted sessions during merge', () => {
    const merge = useAxBiSessions.persist.getOptions().merge
    const current = useAxBiSessions.getState()

    const merged = merge?.(
      {
        activeSessionId: 'missing',
        sessions: {
          ' session-1 ': {
            id: '../wrong',
            title: ' Revenue dashboard ',
            source: 42,
            prompt: 'Chart revenue by month',
            status: 'done',
            runs: [
              {
                id: ' run-1 ',
                prompt: ' Show revenue ',
                message: 100,
                status: 'ready',
                url: 123,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              {
                id: 'bad-run',
                prompt: '',
                message: 'missing prompt',
                status: 'ready',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              {
                id: 'bad-status',
                prompt: 'Prompt',
                message: 'bad status',
                status: 'running',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            createdAt: 'not-a-date',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
          broken: ['not-a-session'],
        },
      },
      current
    )

    expect(merged?.activeSessionId).toBeUndefined()
    expect(Object.keys(merged?.sessions ?? {})).toEqual(['session-1'])
    expect(merged?.sessions['session-1']).toEqual(
      expect.objectContaining({
        id: 'session-1',
        title: 'Revenue dashboard',
        source: '',
        prompt: 'Chart revenue by month',
        status: 'idle',
        updatedAt: '2026-01-02T00:00:00.000Z',
      })
    )
    expect(merged?.sessions['session-1']?.createdAt).not.toBe('not-a-date')
    expect(merged?.sessions['session-1']?.runs).toEqual([
      {
        id: 'run-1',
        prompt: 'Show revenue',
        message: '',
        status: 'ready',
        url: undefined,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })

  it('keeps active session only when the persisted id exists', () => {
    const merge = useAxBiSessions.persist.getOptions().merge
    const current = useAxBiSessions.getState()
    const session = {
      id: 'session-1',
      title: 'Revenue dashboard',
      source: '',
      prompt: '',
      status: 'ready',
      runs: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    } satisfies AxBiSession

    const merged = merge?.(
      {
        activeSessionId: 'session-1',
        sessions: { 'session-1': session },
      },
      current
    )

    expect(merged?.activeSessionId).toBe('session-1')
  })

  it('caps persisted sessions and runs', () => {
    const merge = useAxBiSessions.persist.getOptions().merge
    const current = useAxBiSessions.getState()
    const sessions = Object.fromEntries(
      Array.from({ length: 55 }, (_, sessionIndex) => [
        `session-${sessionIndex}`,
        {
          id: `session-${sessionIndex}`,
          title: `Session ${sessionIndex}`,
          source: '',
          prompt: 'Prompt',
          status: 'ready',
          runs: Array.from({ length: 25 }, (_, runIndex) => ({
            id: `run-${sessionIndex}-${runIndex}`,
            prompt: 'Prompt',
            message: 'Message',
            status: 'ready',
            createdAt: '2026-01-01T00:00:00.000Z',
          })),
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ])
    )

    const merged = merge?.({ sessions, activeSessionId: 'session-0' }, current)
    const sessionKeys = Object.keys(merged?.sessions ?? {})

    expect(sessionKeys).toHaveLength(50)
    expect(sessionKeys[0]).toBe('session-5')
    expect(merged?.activeSessionId).toBeUndefined()
    expect(merged?.sessions['session-54']?.runs).toHaveLength(20)
  })

  it('ignores invalid runtime statuses', () => {
    const session = useAxBiSessions
      .getState()
      .createSession({ title: 'Draft', status: 'draft' })

    useAxBiSessions.getState().updateSession(session.id, {
      status: 'done',
    } as never)
    useAxBiSessions.getState().recordRun(session.id, {
      status: 'running',
      message: 'Should not record',
      prompt: 'Prompt',
    } as never)

    const updated = useAxBiSessions.getState().sessions[session.id]
    expect(updated?.status).toBe('draft')
    expect(updated?.runs).toEqual([])
  })

  it('ignores malformed runtime drafts and patches', () => {
    const session = useAxBiSessions.getState().createSession({
      title: 123,
      source: 42,
      prompt: {},
      status: 'complete',
    } as never)

    expect(session).toEqual(
      expect.objectContaining({
        title: 'Untitled analysis',
        source: '',
        prompt: '',
        status: 'idle',
      })
    )

    expect(() =>
      useAxBiSessions.getState().updateSession(session.id, {
        title: 123,
        source: 42,
        prompt: {},
        status: 'complete',
      } as never)
    ).not.toThrow()

    expect(useAxBiSessions.getState().sessions[session.id]).toEqual(
      expect.objectContaining({
        title: 'Untitled analysis',
        source: '',
        prompt: '',
        status: 'idle',
      })
    )
  })
})
