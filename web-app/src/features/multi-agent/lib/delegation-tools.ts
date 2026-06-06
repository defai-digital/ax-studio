import {
  Experimental_Agent as Agent,
  stepCountIs,
  jsonSchema,
  type Tool,
  type LanguageModel,
} from 'ai'
import type { AgentStatusData } from '@/types/agent-data-parts'
import { sanitize } from './sanitize'
import { truncateToTokenLimit } from './truncate'
import { extractAgentText } from './extract-agent-text'
import { handleSubAgentError, isAbortError, isTimeoutError } from './error-handling'
import type { TokenUsageTracker } from './token-usage-tracker'
import type { AgentHealthMonitor } from './agent-health-monitor'
import type { MultiAgentRunLog } from './run-log'

export type AgentDef = {
  id: string
  name: string
  role?: string
  goal?: string
  description?: string
  instructions?: string
  model_override_id?: string
  tool_scope?: { mode: 'all' | 'include' | 'exclude'; tool_keys: string[] }
  max_steps?: number
  timeout?: { total_ms?: number; step_ms?: number }
  max_result_tokens?: number
  parameters?: Record<string, unknown>
  optional?: boolean
}

export type DelegationToolOptions = {
  model: LanguageModel
  allTools: Record<string, Tool>
  tokenTracker: TokenUsageTracker
  healthMonitor: AgentHealthMonitor
  runLog: MultiAgentRunLog
  emitDataPart: (type: string, data: AgentStatusData) => void
  createModel: (
    modelId: string,
    params: Record<string, unknown>
  ) => Promise<LanguageModel>
}

export function resolveToolsForAgent(
  agent: AgentDef,
  allTools: Record<string, Tool>
): Record<string, Tool> {
  if (!agent.tool_scope || agent.tool_scope.mode === 'all') {
    return allTools
  }

  const matchToolKey = (scopeKey: string, toolName: string): boolean => {
    // scopeKey format: "server::tool" or just "tool"
    // toolName format: could be "server::tool" (qualified) or just "tool" (unqualified)
    if (scopeKey.includes('::')) {
      // Qualified scope key: match exactly, or match just the tool part if toolName is unqualified
      if (toolName === scopeKey) return true
      return toolName === scopeKey.split('::').pop()
    }
    // Unqualified scope key: match the tool name part regardless of server prefix
    const toolPart = toolName.includes('::') ? toolName.split('::').pop() : toolName
    return toolPart === scopeKey
  }

  if (agent.tool_scope.mode === 'include') {
    return Object.fromEntries(
      Object.entries(allTools).filter(([name]) =>
        agent.tool_scope!.tool_keys.some((key) => matchToolKey(key, name))
      )
    )
  }

  if (agent.tool_scope.mode === 'exclude') {
    return Object.fromEntries(
      Object.entries(allTools).filter(
        ([name]) =>
          !agent.tool_scope!.tool_keys.some((key) => matchToolKey(key, name))
      )
    )
  }

  return allTools
}

export function buildDelegationTools(
  agents: AgentDef[],
  options: DelegationToolOptions
): Record<string, Tool> {
  const tools: Record<string, Tool> = {}

  for (const agent of agents) {
    const toolName = `delegate_to_${sanitize(agent.name)}`

    tools[toolName] = {
      description: `Delegate a task to ${agent.name} (${agent.role ?? 'specialist'}).
Goal: ${agent.goal ?? 'Complete the delegated task'}
Capabilities: ${agent.description ?? agent.role ?? agent.name}`,

      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The specific task for this agent',
          },
          context: {
            type: 'string',
            description: 'Relevant context from prior agents',
          },
        },
        required: ['task'],
      }),

      execute: async (
        { task, context }: { task: string; context?: string },
        { abortSignal }: { abortSignal?: AbortSignal }
      ) => {
        // Circuit breaker check
        if (!options.healthMonitor.shouldCall(agent.id)) {
          return {
            error: `Agent "${agent.name}" is temporarily unavailable (circuit open after repeated failures). Proceed without it.`,
          }
        }

        // Budget check
        if (options.tokenTracker.isExhausted()) {
          return {
            error: 'Token budget exhausted. Cannot run this agent.',
          }
        }

        // Scoped input: task + context only, no thread history
        const scopedPrompt = context
          ? `${task}\n\n<prior_agent_context>\n${context}\n</prior_agent_context>`
          : task

        // Record start time for duration tracking
        options.runLog.markAgentStart(agent.id)

        // Emit running status
        options.emitDataPart('agentStatus', {
          agent_id: agent.id,
          agent_name: agent.name,
          agent_role: agent.role,
          status: 'running',
          tokens_used: 0,
        })

        try {
          // Create sub-agent model (on demand)
          const subAgentModel = agent.model_override_id
            ? await options.createModel(
                agent.model_override_id,
                agent.parameters ?? {}
              )
            : options.model

          const agentTools = resolveToolsForAgent(agent, options.allTools)

          // Build abort signal with timeout if configured
          let agentAbortSignal = abortSignal
          if (agent.timeout?.total_ms) {
            const timeoutSignal = AbortSignal.timeout(agent.timeout.total_ms)
            agentAbortSignal = abortSignal
              ? AbortSignal.any([abortSignal, timeoutSignal])
              : timeoutSignal
          }

          const subAgent = new Agent({
            model: subAgentModel,
            system: agent.instructions,
            tools: agentTools,
            stopWhen: stepCountIs(agent.max_steps ?? 10),
          })

          // Run sub-agent with scoped prompt (not messages)
          const result = await subAgent.generate({
            prompt: scopedPrompt,
            abortSignal: agentAbortSignal,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)

          // Track tokens
          const agentTokens = result.usage?.totalTokens ?? 0
          options.tokenTracker.add(agentTokens)
          options.runLog.addAgentStep(agent, result, agentTokens)

          // Record success
          options.healthMonitor.recordSuccess(agent.id)

          // Collect tool calls for UI
          const toolCallLog = result.steps
            .flatMap((s) => s.toolCalls ?? [])
            .map((tc) => ({ name: tc.toolName, args: tc.input }))

          const agentText = extractAgentText(result)

          // Diagnostic: log when result.text is empty
          if (!result.text && agentText) {
            console.warn(
              `[MultiAgent] Agent "${agent.name}" had empty result.text but extractAgentText recovered ${agentText.length} chars`
            )
          } else if (!result.text && !agentText) {
            console.warn(
              `[MultiAgent] Agent "${agent.name}" produced no text at all.`,
              `Steps: ${result.steps.length},`,
              `Tokens: ${agentTokens},`,
              `FinishReason: ${result.steps[result.steps.length - 1]?.finishReason}`
            )
          }

          // Emit completion status
          options.emitDataPart('agentStatus', {
            agent_id: agent.id,
            agent_name: agent.name,
            agent_role: agent.role,
            status: 'complete',
            tokens_used: agentTokens,
            tool_calls: toolCallLog,
          })

          return {
            text: agentText,
            toolCalls: toolCallLog,
            tokensUsed: agentTokens,
          }
        } catch (error) {
          // Re-throw user-initiated aborts immediately (not timeouts)
          if (isAbortError(error) && !isTimeoutError(error)) {
            throw error
          }

          options.healthMonitor.recordFailure(agent.id)

          const errorMsg =
            error instanceof Error ? error.message : String(error)

          // Emit error status
          options.emitDataPart('agentStatus', {
            agent_id: agent.id,
            agent_name: agent.name,
            agent_role: agent.role,
            status: 'error',
            tokens_used: 0,
            error: errorMsg,
          })

          options.runLog.addAgentError(agent, errorMsg)

          return handleSubAgentError(agent, error)
        }
      },

      // toModelOutput: controls what the ORCHESTRATOR sees (truncated)
      // The raw execute() return value goes to the UI stream
      toModelOutput: (output: unknown) => {
        if (!output || typeof output === 'string') {
          return {
            type: 'text' as const,
            value: (typeof output === 'string' && output.trim().length > 0)
              ? output
              : 'Agent completed with no output.',
          }
        }
        if (typeof output === 'object' && output !== null) {
          const result = output as Record<string, unknown>
          if (typeof result.error === 'string') {
            return { type: 'text' as const, value: result.error }
          }
          const text = typeof result.text === 'string' ? result.text : ''
          const maxResultTokens = agent.max_result_tokens ?? 4000
          const truncated = truncateToTokenLimit(text, maxResultTokens)
          return {
            type: 'text' as const,
            value: truncated || 'Agent completed with no text output.',
          }
        }
        return { type: 'text' as const, value: String(output) }
      },
    } as Tool
  }

  return tools
}
