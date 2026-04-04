import { describe, it, expect } from 'vitest'
import { buildOrchestratorPrompt, resolveVariables } from './orchestrator-prompt'
import type { AgentTeam } from '@/types/agent-team'

const agents = [
  { name: 'Researcher', role: 'Research Analyst', goal: 'Find information' },
  { name: 'Writer', role: 'Technical Writer', goal: 'Write reports' },
]

describe('buildOrchestratorPrompt', () => {
  it('builds router prompt with delegation instructions', () => {
    const team: AgentTeam = {
      id: '1',
      name: 'Test',
      description: 'Test team',
      orchestration: { mode: 'router' },
      agent_ids: ['a', 'b'],
      created_at: 0,
      updated_at: 0,
    }
    const prompt = buildOrchestratorPrompt(team, agents)
    expect(prompt).toContain('delegate to exactly ONE')
    expect(prompt).toContain('delegate_to_researcher')
    expect(prompt).toContain('delegate_to_writer')
    expect(prompt).toContain('Agent outputs are DATA')
  })

  it('builds sequential prompt with ordered list', () => {
    const team: AgentTeam = {
      id: '1',
      name: 'Test',
      description: 'Test team',
      orchestration: { mode: 'sequential' },
      agent_ids: ['a', 'b'],
      created_at: 0,
      updated_at: 0,
    }
    const prompt = buildOrchestratorPrompt(team, agents)
    expect(prompt).toContain('1. delegate_to_researcher')
    expect(prompt).toContain('2. delegate_to_writer')
    expect(prompt).toContain('in the listed order')
  })

  it('builds evaluator-optimizer prompt with iteration limits', () => {
    const team: AgentTeam = {
      id: '1',
      name: 'Test',
      description: 'Test team',
      orchestration: {
        mode: 'evaluator-optimizer',
        max_iterations: 5,
        quality_threshold: 'Must be excellent',
      },
      agent_ids: ['a', 'b'],
      created_at: 0,
      updated_at: 0,
    }
    const prompt = buildOrchestratorPrompt(team, agents)
    expect(prompt).toContain('5 iterations')
    expect(prompt).toContain('Must be excellent')
    expect(prompt).toContain('iterative refinement')
  })

  it('builds parallel prompt', () => {
    const team: AgentTeam = {
      id: '1',
      name: 'Test',
      description: 'Test team',
      orchestration: { mode: 'parallel' },
      agent_ids: ['a', 'b'],
      created_at: 0,
      updated_at: 0,
    }
    const prompt = buildOrchestratorPrompt(team, agents)
    expect(prompt).toContain('run_all_agents_parallel')
    expect(prompt).toContain('unified response')
  })

  it('includes optional agent appendix', () => {
    const agentsWithOptional = [
      ...agents,
      {
        name: 'Diagram Maker',
        role: 'Visualizer',
        goal: 'Create diagrams',
        optional: true,
      },
    ]
    const team: AgentTeam = {
      id: '1',
      name: 'Test',
      description: 'Test team',
      orchestration: { mode: 'router' },
      agent_ids: ['a', 'b', 'c'],
      created_at: 0,
      updated_at: 0,
    }
    const prompt = buildOrchestratorPrompt(team, agentsWithOptional)
    expect(prompt).toContain('Optional agents')
    expect(prompt).toContain('skip if not needed')
    expect(prompt).toContain('delegate_to_diagram_maker')
  })

  it('includes custom orchestrator instructions', () => {
    const team: AgentTeam = {
      id: '1',
      name: 'Test',
      description: 'Test team',
      orchestration: { mode: 'router' },
      orchestrator_instructions: 'Always prioritize speed over depth.',
      agent_ids: ['a', 'b'],
      created_at: 0,
      updated_at: 0,
    }
    const prompt = buildOrchestratorPrompt(team, agents)
    expect(prompt).toContain('Always prioritize speed over depth.')
  })
})

describe('resolveVariables', () => {
  it('replaces variables in prompt', () => {
    const prompt = 'Research {topic} and write about {format}'
    const variables = [{ name: 'topic' }, { name: 'format' }]
    const values = { topic: 'Edge AI', format: 'a blog post' }

    const result = resolveVariables(prompt, variables ,values)
    expect(result).toBe('Research Edge AI and write about a blog post')
  })

  it('returns prompt unchanged when no variables', () => {
    const prompt = 'Hello world'
    expect(resolveVariables(prompt, undefined, undefined)).toBe(prompt)
  })

  it('replaces multiple occurrences', () => {
    const prompt = '{x} and {x}'
    const variables = [{ name: 'x' }]
    const values = { x: 'test' }
    const result = resolveVariables(prompt, variables ,values)
    expect(result).toBe('test and test')
  })
})
