import { describe, it, expect } from 'vitest'
import { TEMPLATES } from './templates'
import type { TeamTemplate, TemplateAgent } from './templates'

describe('TEMPLATES', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(TEMPLATES)).toBe(true)
    expect(TEMPLATES.length).toBeGreaterThan(0)
  })

  it('contains exactly 5 templates', () => {
    expect(TEMPLATES).toHaveLength(5)
  })

  describe('structural integrity', () => {
    it.each(TEMPLATES.map((t) => [t.name, t]))(
      '%s has required fields',
      (_name, template) => {
        const t = template as TeamTemplate
        expect(typeof t.name).toBe('string')
        expect(t.name.length).toBeGreaterThan(0)
        expect(typeof t.description).toBe('string')
        expect(t.description.length).toBeGreaterThan(0)
        expect(t.orchestration).toBeDefined()
        expect(typeof t.orchestration.mode).toBe('string')
        expect(Array.isArray(t.agents)).toBe(true)
        expect(t.agents.length).toBeGreaterThan(0)
      }
    )

    it.each(TEMPLATES.map((t) => [t.name, t]))(
      '%s has valid token_budget',
      (_name, template) => {
        const t = template as TeamTemplate
        if (t.token_budget !== undefined) {
          expect(typeof t.token_budget).toBe('number')
          expect(t.token_budget).toBeGreaterThan(0)
        }
      }
    )
  })

  describe('agent structural integrity', () => {
    const allAgents: [string, string, TemplateAgent][] = TEMPLATES.flatMap(
      (t) => t.agents.map((a) => [t.name, a.name, a] as [string, string, TemplateAgent])
    )

    it.each(allAgents)(
      'template "%s" agent "%s" has required fields',
      (_templateName, _agentName, agent) => {
        expect(typeof agent.name).toBe('string')
        expect(agent.name.length).toBeGreaterThan(0)
        expect(typeof agent.role).toBe('string')
        expect(agent.role.length).toBeGreaterThan(0)
        expect(typeof agent.goal).toBe('string')
        expect(agent.goal.length).toBeGreaterThan(0)
        expect(typeof agent.instructions).toBe('string')
        expect(agent.instructions.length).toBeGreaterThan(0)
      }
    )

    it.each(allAgents)(
      'template "%s" agent "%s" has valid optional fields',
      (_templateName, _agentName, agent) => {
        if (agent.max_steps !== undefined) {
          expect(typeof agent.max_steps).toBe('number')
          expect(agent.max_steps).toBeGreaterThan(0)
        }
        if (agent.max_result_tokens !== undefined) {
          expect(typeof agent.max_result_tokens).toBe('number')
          expect(agent.max_result_tokens).toBeGreaterThan(0)
        }
        if (agent.timeout !== undefined) {
          if (agent.timeout.total_ms !== undefined) {
            expect(agent.timeout.total_ms).toBeGreaterThan(0)
          }
          if (agent.timeout.step_ms !== undefined) {
            expect(agent.timeout.step_ms).toBeGreaterThan(0)
          }
        }
      }
    )
  })

  describe('tool_scope validation', () => {
    const agentsWithToolScope = TEMPLATES.flatMap((t) =>
      t.agents
        .filter((a) => a.tool_scope !== undefined)
        .map((a) => [t.name, a.name, a] as [string, string, TemplateAgent])
    )

    it('at least one agent has tool_scope defined', () => {
      expect(agentsWithToolScope.length).toBeGreaterThan(0)
    })

    it.each(agentsWithToolScope)(
      'template "%s" agent "%s" has valid tool_scope',
      (_templateName, _agentName, agent) => {
        const scope = agent.tool_scope!
        expect(['all', 'include', 'exclude']).toContain(scope.mode)
        expect(Array.isArray(scope.tool_keys)).toBe(true)
        expect(scope.tool_keys.length).toBeGreaterThan(0)
        for (const key of scope.tool_keys) {
          expect(typeof key).toBe('string')
          expect(key.length).toBeGreaterThan(0)
        }
      }
    )
  })

  describe('orchestration modes', () => {
    it('includes at least one sequential template', () => {
      const sequential = TEMPLATES.filter(
        (t) => t.orchestration.mode === 'sequential'
      )
      expect(sequential.length).toBeGreaterThan(0)
    })

    it('includes at least one parallel template', () => {
      const parallel = TEMPLATES.filter(
        (t) => t.orchestration.mode === 'parallel'
      )
      expect(parallel.length).toBeGreaterThan(0)
    })

    it('includes at least one evaluator-optimizer template', () => {
      const evalOpt = TEMPLATES.filter(
        (t) => t.orchestration.mode === 'evaluator-optimizer'
      )
      expect(evalOpt.length).toBeGreaterThan(0)
    })

    it('parallel template "Code Review" has parallel_stagger_ms set', () => {
      const codeReview = TEMPLATES.find((t) => t.name === 'Code Review')
      expect(codeReview).toBeDefined()
      expect(codeReview!.parallel_stagger_ms).toBe(200)
    })
  })

  describe('specific templates', () => {
    it('Research & Report has Researcher then Writer', () => {
      const template = TEMPLATES.find((t) => t.name === 'Research & Report')
      expect(template).toBeDefined()
      expect(template!.agents).toHaveLength(2)
      expect(template!.agents[0].name).toBe('Researcher')
      expect(template!.agents[1].name).toBe('Writer')
    })

    it('Code Review has three parallel reviewers', () => {
      const template = TEMPLATES.find((t) => t.name === 'Code Review')
      expect(template).toBeDefined()
      expect(template!.agents).toHaveLength(3)
      expect(template!.orchestration.mode).toBe('parallel')
    })

    it('Debate has Proponent, Opponent, and Moderator', () => {
      const template = TEMPLATES.find((t) => t.name === 'Debate')
      expect(template).toBeDefined()
      const names = template!.agents.map((a) => a.name)
      expect(names).toEqual(['Proponent', 'Opponent', 'Moderator'])
    })

    it('Content Pipeline has three sequential agents', () => {
      const template = TEMPLATES.find((t) => t.name === 'Content Pipeline')
      expect(template).toBeDefined()
      expect(template!.agents).toHaveLength(3)
      expect(template!.orchestration.mode).toBe('sequential')
    })

    it('Iterative Refiner uses evaluator-optimizer with max_iterations', () => {
      const template = TEMPLATES.find((t) => t.name === 'Iterative Refiner')
      expect(template).toBeDefined()
      const orch = template!.orchestration as {
        mode: 'evaluator-optimizer'
        max_iterations: number
        quality_threshold: string
      }
      expect(orch.mode).toBe('evaluator-optimizer')
      expect(orch.max_iterations).toBe(3)
      expect(typeof orch.quality_threshold).toBe('string')
      expect(orch.quality_threshold.length).toBeGreaterThan(0)
    })
  })

  describe('uniqueness', () => {
    it('all template names are unique', () => {
      const names = TEMPLATES.map((t) => t.name)
      expect(new Set(names).size).toBe(names.length)
    })

    it('agent names within each template are unique', () => {
      for (const template of TEMPLATES) {
        const names = template.agents.map((a) => a.name)
        expect(new Set(names).size).toBe(names.length)
      }
    })
  })
})
