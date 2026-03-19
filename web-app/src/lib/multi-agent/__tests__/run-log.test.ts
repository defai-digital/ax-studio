import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MultiAgentRunLog } from '../run-log'

// Mock crypto.randomUUID
const MOCK_UUID = '11111111-2222-3333-4444-555555555555'
vi.stubGlobal('crypto', {
  randomUUID: () => MOCK_UUID,
})

describe('MultiAgentRunLog', () => {
  let originalDateNow: () => number

  beforeEach(() => {
    originalDateNow = Date.now
  })

  afterEach(() => {
    Date.now = originalDateNow
  })

  describe('constructor', () => {
    it('initializes with correct defaults', () => {
      Date.now = () => 1000
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      const data = log.getData()

      expect(data.id).toBe(MOCK_UUID)
      expect(data.team_id).toBe('team-1')
      expect(data.thread_id).toBe('thread-1')
      expect(data.status).toBe('running')
      expect(data.steps).toEqual([])
      expect(data.total_tokens).toBe(0)
      expect(data.orchestrator_tokens).toBe(0)
      expect(data.started_at).toBe(1000)
      expect(data.completed_at).toBeUndefined()
      expect(data.error).toBeUndefined()
    })

    it('defaults threadId to empty string when omitted', () => {
      const log = new MultiAgentRunLog('team-1')
      expect(log.getData().thread_id).toBe('')
    })

    it('defaults budget to 0 when omitted', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      expect(log.getUsage().budget).toBe(0)
    })

    it('accepts a custom budget', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1', 50000)
      expect(log.getUsage().budget).toBe(50000)
    })
  })

  describe('addAgentStep', () => {
    it('adds a step with correct fields', () => {
      Date.now = () => 1000
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      log.markAgentStart('agent-1')

      Date.now = () => 1500
      log.addAgentStep(
        { id: 'agent-1', name: 'Researcher', role: 'analyst' },
        { usage: { totalTokens: 200 }, steps: [] },
        200
      )

      const data = log.getData()
      expect(data.steps).toHaveLength(1)
      expect(data.steps[0]).toEqual({
        agent_id: 'agent-1',
        agent_name: 'Researcher',
        agent_role: 'analyst',
        tokens_used: 200,
        duration_ms: 500,
        status: 'complete',
        tool_calls: [],
      })
    })

    it('accumulates total_tokens across multiple steps', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')

      log.addAgentStep(
        { id: 'a1', name: 'A1' },
        { steps: [] },
        100
      )
      log.addAgentStep(
        { id: 'a2', name: 'A2' },
        { steps: [] },
        250
      )

      expect(log.getData().total_tokens).toBe(350)
    })

    it('extracts tool calls from result steps', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')

      log.addAgentStep(
        { id: 'a1', name: 'A1' },
        {
          steps: [
            {
              toolCalls: [
                { toolName: 'search', input: { query: 'test' } },
                { toolName: 'read', input: { file: 'a.ts' } },
              ],
            },
            {
              toolCalls: [{ toolName: 'write', input: { content: 'hi' } }],
            },
          ],
        },
        100
      )

      const step = log.getData().steps[0]
      expect(step.tool_calls).toEqual([
        { name: 'search', args: { query: 'test' } },
        { name: 'read', args: { file: 'a.ts' } },
        { name: 'write', args: { content: 'hi' } },
      ])
    })

    it('handles steps with no toolCalls', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')

      log.addAgentStep(
        { id: 'a1', name: 'A1' },
        { steps: [{}] },
        50
      )

      expect(log.getData().steps[0].tool_calls).toEqual([])
    })

    it('handles undefined steps in result', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')

      log.addAgentStep(
        { id: 'a1', name: 'A1' },
        {},
        50
      )

      expect(log.getData().steps[0].tool_calls).toBeUndefined()
    })

    it('sets duration_ms to 0 when markAgentStart was not called', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')

      log.addAgentStep(
        { id: 'a1', name: 'A1' },
        { steps: [] },
        100
      )

      expect(log.getData().steps[0].duration_ms).toBe(0)
    })

    it('clears the agent start time after recording step', () => {
      Date.now = () => 1000
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      log.markAgentStart('agent-1')

      Date.now = () => 2000
      log.addAgentStep(
        { id: 'agent-1', name: 'A1' },
        { steps: [] },
        100
      )

      // Second step for same agent without markAgentStart should have 0 duration
      Date.now = () => 3000
      log.addAgentStep(
        { id: 'agent-1', name: 'A1' },
        { steps: [] },
        100
      )

      expect(log.getData().steps[1].duration_ms).toBe(0)
    })

    it('handles agent without role', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')

      log.addAgentStep(
        { id: 'a1', name: 'A1' },
        { steps: [] },
        100
      )

      expect(log.getData().steps[0].agent_role).toBeUndefined()
    })
  })

  describe('addAgentError', () => {
    it('adds an error step with status error', () => {
      Date.now = () => 1000
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      log.markAgentStart('agent-1')

      Date.now = () => 1300
      log.addAgentError(
        { id: 'agent-1', name: 'Researcher', role: 'analyst' },
        'Model rate limited'
      )

      const step = log.getData().steps[0]
      expect(step.status).toBe('error')
      expect(step.error).toBe('Model rate limited')
      expect(step.tokens_used).toBe(0)
      expect(step.duration_ms).toBe(300)
    })

    it('does not increase total_tokens', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      log.addAgentStep({ id: 'a1', name: 'A1' }, { steps: [] }, 100)
      log.addAgentError({ id: 'a2', name: 'A2' }, 'fail')

      expect(log.getData().total_tokens).toBe(100)
    })

    it('sets duration_ms to 0 when no start time recorded', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      log.addAgentError({ id: 'a1', name: 'A1' }, 'error')
      expect(log.getData().steps[0].duration_ms).toBe(0)
    })
  })

  describe('setOrchestratorTokens', () => {
    it('sets orchestrator tokens and updates total', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      log.setOrchestratorTokens(500)

      const data = log.getData()
      expect(data.orchestrator_tokens).toBe(500)
      expect(data.total_tokens).toBe(500)
    })

    it('replaces previous orchestrator tokens in total', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      log.setOrchestratorTokens(500)
      log.setOrchestratorTokens(800)

      const data = log.getData()
      expect(data.orchestrator_tokens).toBe(800)
      expect(data.total_tokens).toBe(800)
    })

    it('preserves agent tokens when updating orchestrator tokens', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      log.addAgentStep({ id: 'a1', name: 'A1' }, { steps: [] }, 200)
      log.setOrchestratorTokens(500)

      expect(log.getData().total_tokens).toBe(700)

      log.setOrchestratorTokens(300)
      expect(log.getData().total_tokens).toBe(500)
    })
  })

  describe('complete', () => {
    it('sets status to completed and records completion time', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      Date.now = () => 5000
      log.complete()

      const data = log.getData()
      expect(data.status).toBe('completed')
      expect(data.completed_at).toBe(5000)
    })
  })

  describe('fail', () => {
    it('sets status to failed with error and records completion time', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      Date.now = () => 5000
      log.fail('Budget exceeded')

      const data = log.getData()
      expect(data.status).toBe('failed')
      expect(data.error).toBe('Budget exceeded')
      expect(data.completed_at).toBe(5000)
    })
  })

  describe('getUsage', () => {
    it('returns zero percentage when budget is 0', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1', 0)
      log.addAgentStep({ id: 'a1', name: 'A1' }, { steps: [] }, 500)

      const usage = log.getUsage()
      expect(usage.consumed).toBe(500)
      expect(usage.budget).toBe(0)
      expect(usage.percentage).toBe(0)
    })

    it('calculates percentage correctly', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1', 1000)
      log.addAgentStep({ id: 'a1', name: 'A1' }, { steps: [] }, 250)

      const usage = log.getUsage()
      expect(usage.consumed).toBe(250)
      expect(usage.budget).toBe(1000)
      expect(usage.percentage).toBe(25)
    })

    it('rounds percentage to nearest integer', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1', 300)
      log.addAgentStep({ id: 'a1', name: 'A1' }, { steps: [] }, 100)

      // 100/300 = 33.333... -> 33
      expect(log.getUsage().percentage).toBe(33)
    })

    it('can exceed 100% when over budget', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1', 100)
      log.addAgentStep({ id: 'a1', name: 'A1' }, { steps: [] }, 150)

      expect(log.getUsage().percentage).toBe(150)
    })
  })

  describe('getData', () => {
    it('returns a shallow copy (mutations do not affect internal state)', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      log.addAgentStep({ id: 'a1', name: 'A1' }, { steps: [] }, 100)

      const data1 = log.getData()
      data1.total_tokens = 999
      data1.steps.push({
        agent_id: 'fake',
        agent_name: 'Fake',
        tokens_used: 0,
        duration_ms: 0,
        status: 'complete',
      })

      const data2 = log.getData()
      expect(data2.total_tokens).toBe(100)
      expect(data2.steps).toHaveLength(1)
    })

    it('returns shallow copies of step objects', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')
      log.addAgentStep({ id: 'a1', name: 'A1' }, { steps: [] }, 100)

      const data1 = log.getData()
      data1.steps[0].tokens_used = 999

      const data2 = log.getData()
      expect(data2.steps[0].tokens_used).toBe(100)
    })
  })

  describe('markAgentStart', () => {
    it('overwrites previous start time for same agent', () => {
      const log = new MultiAgentRunLog('team-1', 'thread-1')

      Date.now = () => 1000
      log.markAgentStart('agent-1')

      Date.now = () => 2000
      log.markAgentStart('agent-1')

      Date.now = () => 2500
      log.addAgentStep(
        { id: 'agent-1', name: 'A1' },
        { steps: [] },
        100
      )

      // Duration should be from second markAgentStart (2000), not first (1000)
      expect(log.getData().steps[0].duration_ms).toBe(500)
    })
  })
})
