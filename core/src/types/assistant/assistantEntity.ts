/**
 * Assistant type defines the shape of an assistant object.
 * @stored
 */

export type AssistantTool = {
  type: string
  enabled: boolean
  useTimeWeightedRetriever?: boolean
  settings: any
}

export type ToolScope = {
  mode: 'all' | 'include' | 'exclude'
  tool_keys: string[]
}

export type AgentTimeout = {
  total_ms?: number
  step_ms?: number
}

export type Assistant = {
  /** Represents the avatar of the user. */
  avatar: string
  /** Represents the location of the thread. */
  thread_location: string | undefined
  /** Represents the unique identifier of the object. */
  id: string
  /** Represents the object. */
  object: string
  /** Represents the creation timestamp of the object. */
  created_at: number
  /** Represents the name of the object. */
  name: string
  /** Represents the description of the object. */
  description?: string
  /** Represents the model of the object. */
  model: string
  /** Represents the instructions for the object. */
  instructions?: string
  /** Represents the tools associated with the object. */
  tools?: AssistantTool[]
  /** Represents the file identifiers associated with the object. */
  file_ids: string[]
  /** Represents the metadata of the object. */
  metadata?: Record<string, unknown>
  /** Inference parameters (temperature, top_p, etc.) */
  parameters?: Record<string, unknown>
  /** Whether this assistant is a plain assistant or an agent */
  type?: 'assistant' | 'agent'
  /** Short role label, e.g. "Researcher" */
  role?: string
  /** What this agent optimizes for */
  goal?: string
  /** Use a different model than thread default */
  model_override_id?: string
  /** Which tools this agent can access */
  tool_scope?: ToolScope
  /** Max tool-calling iterations (default: 10) */
  max_steps?: number
  /** Time-based limits per agent */
  timeout?: AgentTimeout
  /** Truncate output before returning to orchestrator (default: 4000) */
  max_result_tokens?: number
  /** If true, orchestrator may skip this agent when not needed */
  optional?: boolean
}

export interface CodeInterpreterTool {
  /**
   * The type of tool being defined: `code_interpreter`
   */
  type: 'code_interpreter'
}
