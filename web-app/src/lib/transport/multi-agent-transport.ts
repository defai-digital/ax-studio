import { type UIMessage } from '@ai-sdk/react'
import {
  Experimental_Agent as Agent,
  convertToModelMessages,
  createUIMessageStream,
  stepCountIs,
  type LanguageModel,
  type Tool,
} from 'ai'
import type { UIMessageChunk, UIMessageStreamWriter } from 'ai'
import { ModelFactory } from '@/lib/model-factory'
import { useAssistant } from '@/hooks/useAssistant'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAgentTeamStore } from '@/stores/agent-team-store'
import { useThreads } from '@/hooks/useThreads'
import type { AgentStatusData } from '@/types/agent-data-parts'
import type { RunLogData } from '@/lib/multi-agent/run-log'
import {
  TokenUsageTracker,
  AgentHealthMonitor,
  MultiAgentRunLog,
  persistRunLog,
  validateTeamAgentNames,
  estimateTeamRunCost,
} from '@/lib/multi-agent'
import type { CostEstimate } from '@/lib/multi-agent/cost-estimation'
import { buildDelegationTools } from '@/lib/multi-agent/delegation-tools'
import { buildParallelOrchestration } from '@/lib/multi-agent/parallel-orchestration'
import {
  buildOrchestratorPrompt,
  resolveVariables,
} from '@/lib/multi-agent/orchestrator-prompt'
import { sanitize } from '@/lib/multi-agent/sanitize'
import type { TokenUsageCallback, SendMessagesOptions } from './transport-types'
import { stripUnavailableToolParts } from './transport-types'

export interface MultiAgentConfig {
  teamId: string
  model: LanguageModel
  tools: Record<string, Tool>
  systemMessage: string | undefined
  threadId: string | undefined
  inferenceParameters: Record<string, unknown>
  modelOverrideId: string | undefined
  onTokenUsage: TokenUsageCallback | undefined
  costApprovalCallback: ((estimate: CostEstimate) => Promise<boolean>) | undefined
  getThreadMetadata: () => Record<string, unknown> | null
  mapUserInlineAttachments: (messages: UIMessage[]) => UIMessage[]
  refreshTools: () => Promise<void>
  onFallbackToSingleAgent: (options: SendMessagesOptions) => Promise<ReadableStream<UIMessageChunk>>
}

export async function executeMultiAgentStream(
  options: SendMessagesOptions,
  config: MultiAgentConfig
): Promise<ReadableStream<UIMessageChunk>> {
  const {
    teamId,
    threadId,
    inferenceParameters,
    modelOverrideId,
    onTokenUsage,
    costApprovalCallback,
    getThreadMetadata,
    mapUserInlineAttachments,
    refreshTools,
    onFallbackToSingleAgent,
  } = config

  let runLog: MultiAgentRunLog | null = null
  let streamWriter: UIMessageStreamWriter | null = null

  const emitDataPart = (type: string, data: AgentStatusData | RunLogData): void => {
    if (streamWriter) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      streamWriter.write({ type: `data-${type}`, data } as any)
    }
  }

  /** Safely write a text message to the stream with proper text-start/delta/end lifecycle. */
  const writeTextMessage = (writer: UIMessageStreamWriter, id: string, text: string): void => {
    writer.write({ type: 'text-start', id })
    writer.write({ type: 'text-delta', id, delta: text })
    writer.write({ type: 'text-end', id })
  }

  try {
    const team = useAgentTeamStore.getState().getTeam(teamId)
    if (!team) throw new Error(`Agent team "${teamId}" not found`)

    const assistantStore = useAssistant.getState()
    const agents: Array<{
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
    }> = []
    for (const agentId of team.agent_ids) {
      const agent = assistantStore.assistants?.find((a: { id: string }) => a.id === agentId)
      if (agent) agents.push(agent)
    }

    if (agents.length === 0) throw new Error('No agents found for this team')

    const nameError = validateTeamAgentNames(agents)
    if (nameError) throw new Error(nameError)

    await refreshTools()

    const providerId = useModelProvider.getState().selectedProvider
    const providerConfig = useModelProvider.getState().getProviderByName(providerId)
    const activeModelId = modelOverrideId ?? useModelProvider.getState().selectedModel?.id

    if (!activeModelId || !providerConfig) {
      throw new Error('ServiceHub not initialized or model/provider missing.')
    }

    const activeProvider = useModelProvider.getState().getProviderByName(providerId) ?? providerConfig
    const currentAssistant = useAssistant.getState().currentAssistant
    const inferenceParams = {
      ...(currentAssistant?.parameters ?? {}),
      ...(inferenceParameters ?? {}),
    }
    const model = await ModelFactory.createModel(activeModelId, activeProvider, inferenceParams)

    // Save team config snapshot on first run
    const rawMetadata = getThreadMetadata() ?? {}
    if (!rawMetadata.agent_team_snapshot && threadId) {
      try {
        useThreads.getState().updateThread(threadId, {
          metadata: {
            ...rawMetadata,
            agent_team_snapshot: { ...team, snapshotted_at: Date.now() },
          },
        })
      } catch (snapshotErr) {
        console.warn('Failed to save team snapshot:', snapshotErr)
      }
    }

    const tokenBudget = team.token_budget ?? 100000
    runLog = new MultiAgentRunLog(team.id, threadId, tokenBudget)
    const healthMonitor = new AgentHealthMonitor()
    const tokenTracker = new TokenUsageTracker(tokenBudget)

    if (team.cost_approval_threshold) {
      const estimate = estimateTeamRunCost(team, agents)
      if (estimate.range.max > team.cost_approval_threshold) {
        if (costApprovalCallback) {
          const approved = await costApprovalCallback(estimate)
          if (!approved) throw new Error('Multi-agent run cancelled by user (cost threshold)')
        } else {
          console.warn(`[MultiAgent] Cost estimate ${estimate.range.max} exceeds threshold ${team.cost_approval_threshold}, no approval callback set`)
        }
      }
    }

    const delegationOptions = {
      model,
      allTools: config.tools,
      tokenTracker,
      healthMonitor,
      runLog,
      emitDataPart: (type: string, data: AgentStatusData) => emitDataPart(type, data),
      createModel: async (overrideModelId: string, params: Record<string, unknown>) =>
        ModelFactory.createModel(overrideModelId, activeProvider, params),
    }

    let orchestratorTools: Record<string, Tool>
    let orchestratorSystem: string

    if (team.orchestration.mode === 'parallel') {
      const { tools: parallelTools, system: parallelSystem } =
        buildParallelOrchestration(team, agents, delegationOptions)
      orchestratorTools = parallelTools
      orchestratorSystem = parallelSystem
    } else {
      orchestratorTools = buildDelegationTools(agents, delegationOptions)
      orchestratorSystem = buildOrchestratorPrompt(team, agents)
    }

    const rawMeta = getThreadMetadata() ?? {}
    const variableValues = (rawMeta.agent_team_variables ?? {}) as Record<string, string>
    const resolvedSystem = resolveVariables(orchestratorSystem, team.variables, variableValues)

    const routingModel = team.orchestrator_model_id
      ? await ModelFactory.createModel(team.orchestrator_model_id, activeProvider, {})
      : null

    const orchestrator = new Agent({
      model,
      system: resolvedSystem,
      tools: { ...orchestratorTools },
      stopWhen: [stepCountIs(agents.length * 2 + 5), tokenTracker.budgetExhausted()],
      prepareStep: async ({ stepNumber, steps }) => {
        const mode = team.orchestration.mode
        const delegationsMade = (steps ?? []).reduce((count, step) => {
          const calls = step.toolCalls ?? []
          return count + calls.filter(
            (tc: { toolName: string }) =>
              tc.toolName.startsWith('delegate_to_') || tc.toolName === 'run_all_agents_parallel'
          ).length
        }, 0)

        let stepToolChoice: undefined | 'required' | { type: 'tool'; toolName: string }

        switch (mode) {
          case 'parallel': {
            if (delegationsMade === 0) stepToolChoice = { type: 'tool', toolName: 'run_all_agents_parallel' }
            break
          }
          case 'sequential': {
            if (delegationsMade < agents.length) {
              stepToolChoice = { type: 'tool', toolName: `delegate_to_${sanitize(agents[delegationsMade].name)}` }
            }
            break
          }
          case 'evaluator-optimizer': {
            const maxIter = 'max_iterations' in team.orchestration ? (team.orchestration.max_iterations ?? 3) : 3
            const requiredDelegations = maxIter * 2
            if (delegationsMade < requiredDelegations && agents.length >= 2) {
              if (steps && steps.length > 0) {
                const lastStep = steps[steps.length - 1]
                const lastToolResult = lastStep?.response?.messages
                  ?.filter((m: { role: string }) => m.role === 'tool')?.pop()
                const resultText = typeof lastToolResult?.content === 'string' ? lastToolResult.content : ''
                if (/\bapproved?\b/i.test(resultText) || /\bpass(ed)?\b/i.test(resultText)) break
              }
              const agentIdx = delegationsMade % 2
              stepToolChoice = { type: 'tool', toolName: `delegate_to_${sanitize(agents[agentIdx].name)}` }
            }
            break
          }
          case 'router':
          default: {
            if (delegationsMade === 0) stepToolChoice = 'required'
            break
          }
        }

        const result: Record<string, unknown> = {}
        if (stepToolChoice) result.toolChoice = stepToolChoice
        if (stepNumber === 0 && routingModel && mode === 'router') result.model = routingModel

        if (steps && steps.length > 12) {
          const trimmedSteps = steps.slice(1, -8)
          const toolRelatedMessages = trimmedSteps.flatMap((s) =>
            (s.response?.messages ?? []).filter((m: { role: string }) =>
              m.role === 'tool' ||
              (m.role === 'assistant' && (m as { tool_calls?: unknown[] }).tool_calls?.length)
            )
          )
          const rawMessages = [
            ...(steps[0].response?.messages ?? []),
            ...toolRelatedMessages,
            ...steps.slice(-8).flatMap((s) => s.response?.messages ?? []),
          ]
          // Ensure role alternation: strip consecutive same-role messages
          // (except tool messages which follow assistant tool_calls)
          const normalized: typeof rawMessages = []
          for (const msg of rawMessages) {
            const prev = normalized[normalized.length - 1]
            if (prev && msg.role === prev.role && msg.role !== 'tool') {
              // Skip consecutive same-role (merge would be lossy, skip is safer)
              continue
            }
            normalized.push(msg)
          }
          result.messages = normalized
        }

        return Object.keys(result).length > 0 ? result : undefined
      },
    })

    // Strip tool invocation parts for tools no longer available (e.g., local knowledge toggled off).
    // Only check config.tools (MCP/RAG tools) — orchestratorTools are delegation tools that never
    // appear in conversation history from prior turns.
    const cleanedMessages = stripUnavailableToolParts(options.messages, new Set(Object.keys(config.tools)))

    const modelMessages = convertToModelMessages(mapUserInlineAttachments(cleanedMessages))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orchestratorResult = orchestrator.stream({ messages: modelMessages, abortSignal: options.abortSignal } as any)

    return createUIMessageStream({
      execute: async ({ writer }) => {
        streamWriter = writer
        try {
          await writer.merge(
            orchestratorResult.toUIMessageStream({
              onFinish: async () => {
                const totalUsage = await orchestratorResult.totalUsage
                runLog!.setOrchestratorTokens(totalUsage?.totalTokens ?? 0)

                const logData = runLog!.getData()
                if (logData.steps.length === 0) {
                  console.warn(`[MultiAgent] Orchestrator finished without delegating to any agent. Model: ${activeModelId}, Mode: ${team.orchestration.mode}`)
                  writeTextMessage(writer, 'agent-notice',
                    `\n\n> **Agent Team Notice:** The orchestrator model did not delegate to any agents. ` +
                    `This usually means the model doesn't support tool calling reliably. ` +
                    `Try switching to a model that supports tool calling (e.g. GPT-4o, Claude, Gemini, Llama 4 Scout).`)
                }

                runLog!.complete()
                await persistRunLog(runLog!)
                emitDataPart('runLog', runLog!.getData())

                const usage = runLog!.getUsage()
                if (onTokenUsage) {
                  onTokenUsage(
                    {
                      inputTokens: totalUsage?.inputTokens ?? 0,
                      outputTokens: totalUsage?.outputTokens ?? 0,
                      totalTokens: usage.consumed || (totalUsage?.totalTokens ?? 0),
                    },
                    options.messageId ?? ''
                  )
                }
              },
            })
          )
        } catch (streamError) {
          console.error('[MultiAgent] Orchestrator stream error:', streamError)
          const errMsg = streamError instanceof Error ? streamError.message : String(streamError)

          // Detect specific error patterns and provide actionable hints
          let hint = ''
          if (/bad request|400|unsupported.*tool.?choice/i.test(errMsg)) {
            hint = ' This model may not support forced tool calling (`tool_choice: required`). Try a model with full tool-calling support (e.g. GPT-4o, Claude, Gemini).'
          } else if (/roles must alternate|user\/assistant/i.test(errMsg)) {
            hint = ' This model requires strict user/assistant role alternation which the multi-agent orchestrator cannot guarantee. Try a model with flexible message ordering (e.g. GPT-4o, Claude, Gemini).'
          } else if (/type validation failed/i.test(errMsg)) {
            hint = ' The model returned an unexpected response format. This often happens with local models. Try a cloud model with standard OpenAI-compatible responses.'
          }

          // Extract a cleaner message from verbose Type validation errors
          let displayMsg = errMsg
          if (/^Type validation failed/i.test(displayMsg) && displayMsg.length > 200) {
            const innerMatch = displayMsg.match(/llama-server chat error \d+ [^:]+: (.*?)(?:","type")/s)
            displayMsg = innerMatch
              ? `Model error: ${innerMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').slice(0, 200)}`
              : displayMsg.slice(0, 200) + '…'
          }
          writeTextMessage(writer, 'agent-error', `\n\n> **Agent Team Error:** ${displayMsg}${hint}`)
          runLog!.fail(errMsg)
          persistRunLog(runLog!).catch(() => {})
          emitDataPart('runLog', runLog!.getData())
        } finally {
          streamWriter = null
        }
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error

    console.error('Multi-agent orchestration failed, falling back to single-agent:', error)

    if (runLog) {
      runLog.fail(error instanceof Error ? error.message : String(error))
      persistRunLog(runLog).catch(() => {})
    }

    const errMsg = error instanceof Error ? error.message : String(error)
    const fallbackStream = await onFallbackToSingleAgent(options)
    return createUIMessageStream({
      execute: async ({ writer }) => {
        writeTextMessage(writer, 'agent-error-notice', `> **Agent Team Error:** ${errMsg}. Falling back to single-agent mode.\n\n`)
        await writer.merge(fallbackStream)
      },
    })
  }
}
