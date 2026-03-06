export type OrchestrationType =
  | { mode: 'router' }
  | { mode: 'sequential' }
  | { mode: 'parallel' }
  | {
      mode: 'evaluator-optimizer'
      max_iterations?: number
      quality_threshold?: string
    }

export type TeamVariable = {
  name: string
  label: string
  description?: string
  default_value?: string
}

export type AgentTeam = {
  id: string
  name: string
  description: string
  orchestration: OrchestrationType
  orchestrator_instructions?: string
  orchestrator_model_id?: string
  agent_ids: string[]
  variables?: TeamVariable[]
  token_budget?: number
  cost_approval_threshold?: number
  parallel_stagger_ms?: number
  created_at: number
  updated_at: number
}
