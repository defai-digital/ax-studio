import {
  Experimental_Agent as Agent,
  stepCountIs,
  jsonSchema,
  type Tool,
  type LanguageModel,
} from 'ai'
import type { AgentTeam } from '@/types/agent-team'
import type { AgentStatusData } from '@/types/agent-data-parts'
import { truncateToTokenLimit } from './truncate'
import type { TokenUsageTracker } from './token-usage-tracker'
import type { AgentHealthMonitor } from './agent-health-monitor'
import type { MultiAgentRunLog } from './run-log'
import type { AgentDef } from './delegation-tools'
import { resolveToolsForAgent } from './delegation-tools'
import { handleSubAgentError, isAbortError } from './error-handling'
import { buildOrchestratorPrompt } from './orchestrator-prompt'
import { extractAgentText } from './extract-agent-text'

export type ParallelOrchestrationOptions = {
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

export function buildParallelOrchestration(
  team: AgentTeam,
  agents: AgentDef[],
  options: ParallelOrchestrationOptions
): { tools: Record<string, Tool>; system: string } {
  const staggerMs = team.parallel_stagger_ms ?? 0

  const agentNames = agents
    .map((a) => `${a.name} (${a.role ?? 'specialist'})`)
    .join(', ')

  // Use the canonical prompt from orchestrator-prompt.ts to avoid duplication
  const system = buildOrchestratorPrompt(team, agents)

  const parallelTool: Tool = {
    description: `Run ALL specialist agents in parallel on the given task. Agents: ${agentNames}`,

    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task to give to all agents',
        },
      },
      required: ['task'],
    }),

    execute: async (
      { task }: { task: string },
      { abortSignal }: { abortSignal?: AbortSignal }
    ) => {
      const results = await Promise.allSettled(
        agents.map(async (agent, index) => {
          // Staggered start to avoid rate limit bursts
          if (staggerMs > 0 && index > 0) {
            if (abortSignal?.aborted) throw abortSignal.reason
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                clearTimeout(timer)
                reject(abortSignal!.reason)
              }
              const timer = setTimeout(() => {
                abortSignal?.removeEventListener('abort', onAbort)
                resolve()
              }, staggerMs * index)
              abortSignal?.addEventListener('abort', onAbort, { once: true })
            })
          }

          // Circuit breaker check
          if (!options.healthMonitor.shouldCall(agent.id)) {
            throw new Error(
              `Agent "${agent.name}" is temporarily unavailable (circuit open)`
            )
          }

          // Budget check
          if (options.tokenTracker.isExhausted()) {
            throw new Error('Token budget exhausted')
          }

          // Record start time
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
            // Create sub-agent model
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

            const result = await subAgent.generate({
              prompt: task,
              abortSignal: agentAbortSignal,
            })

            const agentTokens = result.usage?.totalTokens ?? 0
            options.tokenTracker.add(agentTokens)
            options.runLog.addAgentStep(agent, result, agentTokens)
            options.healthMonitor.recordSuccess(agent.id)

            const toolCallLog = result.steps
              .flatMap((s) => s.toolCalls ?? [])
              .map((tc) => ({ name: tc.toolName, args: tc.input }))

            const agentText = extractAgentText(result)

            // Diagnostic: log when result.text is empty but we recovered text
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
              agent: agent.name,
              role: agent.role,
              output: truncateToTokenLimit(
                agentText,
                agent.max_result_tokens ?? 4000
              ),
            }
          } catch (error) {
            options.healthMonitor.recordFailure(agent.id)

            // Re-throw abort errors (user cancellation) — handleSubAgentError also does this
            if (isAbortError(error)) throw error

            // Use raw error for UI display, structured error for orchestrator context
            const errorMsg =
              error instanceof Error ? error.message : String(error)

            options.emitDataPart('agentStatus', {
              agent_id: agent.id,
              agent_name: agent.name,
              agent_role: agent.role,
              status: 'error',
              tokens_used: 0,
              error: errorMsg,
            })

            options.runLog.addAgentError(agent, errorMsg)

            // Re-throw so Promise.allSettled captures it as a rejection
            // The fan-in code uses r.reason.message for the orchestrator's XML
            throw error
          }
        })
      )

      // Fan-in: combine results
      const combined = results.map((r, i) => {
        if (r.status === 'fulfilled') {
          const output = r.value.output || '(Agent produced no text output)'
          return `<agent_output name="${agents[i].name}" role="${agents[i].role ?? 'specialist'}">\n${output}\n</agent_output>`
        }
        return `<agent_output name="${agents[i].name}" role="${agents[i].role ?? 'specialist'}" status="error">\nError: ${r.reason?.message ?? 'Agent failed'}\n</agent_output>`
      })

      return combined.join('\n\n')
    },

    toModelOutput: (output: unknown) => {
      if (typeof output === 'string' && output.trim().length > 0) {
        return { type: 'text' as const, value: output }
      }
      return {
        type: 'text' as const,
        value: String(output ?? '') || 'No output from parallel execution.',
      }
    },
  } as Tool

  return {
    tools: { run_all_agents_parallel: parallelTool },
    system,
  }
}
