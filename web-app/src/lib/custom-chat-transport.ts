import { type UIMessage } from '@ai-sdk/react'
import {
  Experimental_Agent as Agent,
  convertToModelMessages,
  createUIMessageStream,
  streamText,
  stepCountIs,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
  type UIMessageStreamWriter,
  type Tool,
  type LanguageModelUsage,
  jsonSchema,
} from 'ai'
import { useServiceStore, getServiceHub } from '@/hooks/useServiceHub'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'
import type { AgentStatusData } from '@/types/agent-data-parts'
import type { RunLogData } from './multi-agent/run-log'
import {
  TokenUsageTracker,
  AgentHealthMonitor,
  MultiAgentRunLog,
  persistRunLog,
  validateTeamAgentNames,
  estimateTeamRunCost,
} from './multi-agent'
import type { CostEstimate } from './multi-agent/cost-estimation'
import { buildDelegationTools } from './multi-agent/delegation-tools'
import { buildParallelOrchestration } from './multi-agent/parallel-orchestration'
import {
  buildOrchestratorPrompt,
  resolveVariables,
} from './multi-agent/orchestrator-prompt'
import { sanitize } from './multi-agent/sanitize'
import { useAgentTeamStore } from '@/stores/agent-team-store'
import { useThreads } from '@/hooks/useThreads'

export type TokenUsageCallback = (
  usage: LanguageModelUsage,
  messageId: string
) => void
export type StreamingTokenSpeedCallback = (
  tokenCount: number,
  elapsedMs: number
) => void
export type OnFinishCallback = (params: {
  message: UIMessage
  isAbort?: boolean
}) => void
export type OnToolCallCallback = (params: {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
}) => void
export type ServiceHub = {
  mcp(): {
    getTools(): Promise<
      Array<{ name: string; description: string; inputSchema: unknown }>
    >
  }
  rag(): {
    getTools(): Promise<
      Array<{ name: string; description: string; inputSchema: unknown }>
    >
  }
}

export class CustomChatTransport implements ChatTransport<UIMessage> {
  public model: LanguageModel | null = null
  private tools: Record<string, Tool> = {}
  private onTokenUsage?: TokenUsageCallback
  private modelSupportsTools = false
  private hasDocuments = false
  private systemMessage?: string
  private serviceHub: ServiceHub | null
  private threadId?: string
  private inferenceParameters: Record<string, unknown>
  private modelOverrideId?: string
  private activeTeamId?: string
  private streamWriter: UIMessageStreamWriter | null = null
  private costApprovalCallback?: (
    estimate: CostEstimate
  ) => Promise<boolean>

  constructor(
    systemMessage?: string,
    threadId?: string,
    inferenceParameters: Record<string, unknown> = {},
    modelOverrideId?: string
  ) {
    this.systemMessage = systemMessage
    this.threadId = threadId
    this.inferenceParameters = { ...inferenceParameters }
    this.modelOverrideId = modelOverrideId
    this.serviceHub = useServiceStore.getState().serviceHub
  }

  updateSystemMessage(systemMessage: string | undefined) {
    this.systemMessage = systemMessage
  }

  updateInferenceParameters(parameters: Record<string, unknown>) {
    this.inferenceParameters = { ...parameters }
  }

  updateModelOverrideId(modelId: string | undefined) {
    this.modelOverrideId = modelId
  }

  setOnTokenUsage(callback: TokenUsageCallback | undefined) {
    this.onTokenUsage = callback
  }

  updateActiveTeamId(teamId: string | undefined) {
    this.activeTeamId = teamId
  }

  setCostApprovalCallback(
    callback: ((estimate: CostEstimate) => Promise<boolean>) | undefined
  ) {
    this.costApprovalCallback = callback
  }

  private getThreadMetadata(): Record<string, unknown> | null {
    if (!this.threadId) return null
    try {
      const thread = useThreads.getState().getThreadById(this.threadId)
      return (thread?.metadata as Record<string, unknown>) ?? null
    } catch {
      return null
    }
  }

  /**
   * Update tool availability based on model capabilities and document state.
   * Called whenever the thread's document state or selected model changes.
   */
  async updateRagToolsAvailability(
    hasDocuments: boolean,
    modelSupportsTools: boolean,
    ragFeatureAvailable: boolean
  ) {
    this.modelSupportsTools = modelSupportsTools
    // Only expose RAG tools when the feature is enabled AND documents have been indexed
    this.hasDocuments = ragFeatureAvailable && hasDocuments

    await this.refreshTools()
  }

  /**
   * Refresh tools based on current state.
   * Loads MCP tools and filters out disabled tools based on thread settings.
   * @private
   */
  async refreshTools() {
    const toolsRecord: Record<string, Tool> = {}

    // Get disabled tools for this thread
    const getDisabledToolsForThread =
      useToolAvailable.getState().getDisabledToolsForThread
    const disabledToolKeys = this.threadId
      ? getDisabledToolsForThread(this.threadId)
      : useToolAvailable.getState().getDefaultDisabledTools()
    // Helper to check if a tool is disabled
    const isToolDisabled = (serverName: string, toolName: string): boolean => {
      const toolKey = `${serverName}::${toolName}`
      return disabledToolKeys.includes(toolKey)
    }

    // Load MCP and RAG tools only when a service hub is available and model supports tools
    if (this.serviceHub) {
      const selectedModel = useModelProvider.getState().selectedModel
      const modelSupportsTools = selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools

      // Only load external tools if model supports them
      if (modelSupportsTools) {
        // Load MCP tools
        try {
          const mcpTools = await this.serviceHub.mcp().getTools()
          if (Array.isArray(mcpTools) && mcpTools.length > 0) {
            // Convert MCP tools to AI SDK format, filtering out disabled tools
            mcpTools.forEach((tool) => {
              // MCP tools use MCPTool interface with server field
              const serverName = (tool as { server?: string }).server || 'unknown'
              if (!isToolDisabled(serverName, tool.name)) {
                toolsRecord[tool.name] = {
                  description: tool.description,
                  inputSchema: jsonSchema(
                    tool.inputSchema as Record<string, unknown>
                  ),
                } as Tool
              }
            })
          }
        } catch (error) {
          console.warn('Failed to load MCP tools:', error)
        }

        // Load RAG tools when documents have been indexed into the thread/project.
        // RAG tools come from the Retrieval Service (/tools endpoint) and are
        // routed to rag().callTool() in the thread component — not through MCP.
        if (this.hasDocuments) {
          try {
            const ragTools = await this.serviceHub.rag().getTools()
            if (Array.isArray(ragTools) && ragTools.length > 0) {
              ragTools.forEach((tool) => {
                // Use 'retrieval' as the server namespace for the disable-check key
                if (!isToolDisabled('retrieval', tool.name)) {
                  toolsRecord[tool.name] = {
                    description: tool.description,
                    inputSchema: jsonSchema(
                      tool.inputSchema as Record<string, unknown>
                    ),
                  } as Tool
                }
              })
            }
          } catch (error) {
            console.warn('Failed to load RAG tools (retrieval service may be offline):', error)
          }
        }
      }
    }

    // Built-in diagram tool — runs client-side, no MCP server or backend needed.
    // Always registered regardless of serviceHub or model capability detection,
    // because most modern models support tool calling even if not in the token.js list.
    // The execute function runs in the browser and returns the Mermaid source;
    // MessageItem renders it through the Streamdown → Mermaid pipeline.
    if (!isToolDisabled('built-in', 'generate_diagram')) {
      toolsRecord['generate_diagram'] = {
        description:
          'Generate a visual Mermaid diagram. ALWAYS call this proactively — never wait to be asked. ' +
          'Use it whenever a visual aids understanding. Type selection guide:\n' +
          '• mindmap — "what are the concepts/parts/ideas of X", conceptual overviews\n' +
          '• flowchart — step-by-step processes, decision trees, algorithms, how X works\n' +
          '• sequenceDiagram — message passing between distinct actors/systems (login, API calls)\n' +
          '• classDiagram — object models, class hierarchies, OOP structure\n' +
          '• erDiagram — database schemas, entity relationships\n' +
          '• stateDiagram-v2 — states and transitions of a system or object\n' +
          '• gantt — project timelines, schedules, task planning\n' +
          '• mindmap — also use for listing main topics, categories, or branches of a subject',
        inputSchema: jsonSchema({
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short descriptive title for the diagram',
            },
            diagramType: {
              type: 'string',
              enum: [
                'flowchart',
                'sequenceDiagram',
                'classDiagram',
                'erDiagram',
                'stateDiagram-v2',
                'gantt',
                'mindmap',
                'timeline',
                'gitGraph',
                'pie',
              ],
              description:
                'Mermaid diagram type. Choose based on content: ' +
                'flowchart=processes/steps/decisions, ' +
                'sequenceDiagram=actor-to-actor message flow, ' +
                'classDiagram=OOP class structure, ' +
                'erDiagram=database/entity schema, ' +
                'stateDiagram-v2=state machine/transitions, ' +
                'gantt=timeline/schedule, ' +
                'mindmap=concepts/topics/overview/categories, ' +
                'timeline=chronological events, ' +
                'gitGraph=git branches, ' +
                'pie=proportional breakdown',
            },
            source: {
              type: 'string',
              description:
                'Complete valid Mermaid syntax for the diagram body, without the ```mermaid fence',
            },
          },
          required: ['title', 'diagramType', 'source'],
        }),
        execute: async ({
          title,
          diagramType,
          source,
        }: {
          title: string
          diagramType: string
          source: string
        }) => ({ title, diagramType, source }),
      } as Tool
    }

    this.tools = toolsRecord
  }

  /**
   * Get current tools
   */
  getTools(): Record<string, Tool> {
    return this.tools
  }

  async sendMessages(
    options: {
      chatId: string
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & {
      trigger: 'submit-message' | 'regenerate-message'
      messageId: string | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    // Check if thread has an active agent team
    if (this.activeTeamId) {
      return this.sendMultiAgentMessages(options, this.activeTeamId)
    }

    // Ensure tools updated before sending messages
    await this.refreshTools()

    // Initialize model if not already initialized
    const modelId =
      this.modelOverrideId ?? useModelProvider.getState().selectedModel?.id
    const providerId = useModelProvider.getState().selectedProvider
    const provider = useModelProvider.getState().getProviderByName(providerId)
    if (this.serviceHub && modelId && provider) {
      try {
        const updatedProvider = useModelProvider
          .getState()
          .getProviderByName(providerId)

        const activeProvider = updatedProvider ?? provider

        // Guard: remote providers must have an API key registered.
        // Local providers (llamacpp, mlx, ollama) are exempted.
        const isLocalProvider = ['llamacpp', 'mlx', 'ollama'].includes(activeProvider.provider)
        if (!activeProvider.api_key && !isLocalProvider) {
          throw new Error(
            `No API key configured for provider "${activeProvider.provider}". ` +
            `Go to Settings → AI Providers and add your API key.`
          )
        }

        // For local providers, ensure the model is loaded (llama-server running)
        // before sending a request. startModel is a no-op if already loaded.
        // The OnModelReady event handler in GlobalEventHandler registers the
        // local server with the Rust proxy so the proxy can route the request.
        if (isLocalProvider) {
          try {
            const hub = getServiceHub()
            await hub.models().startModel(activeProvider, modelId)
          } catch (loadError) {
            console.error('Failed to load local model:', loadError)
            throw new Error(
              `Failed to load model "${modelId}": ${loadError instanceof Error ? loadError.message : String(loadError)}`
            )
          }
        }

        // Get assistant parameters from current assistant
        const currentAssistant = useAssistant.getState().currentAssistant
        const inferenceParams = {
          ...(currentAssistant?.parameters ?? {}),
          ...(this.inferenceParameters ?? {}),
        }

        // Create the model using the factory
        this.model = await ModelFactory.createModel(
          modelId,
          activeProvider,
           inferenceParams
         )
      } catch (error) {
        console.error('Failed to create model:', error)
        throw new Error(
          `Failed to create model: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        )
      }
    } else {
      throw new Error('ServiceHub not initialized or model/provider missing.')
    }

    // Convert UI messages to model messages
    const modelMessages = convertToModelMessages(
      this.mapUserInlineAttachments(options.messages)
    )

    // Gate all tools (MCP, RAG, and built-in generate_diagram) behind the model
    // capability check. Local models (Ollama, LMStudio) that are not in the
    // token.js supportsToolCalls list get modelSupportsTools=false and use the
    // text path instead (the model outputs ```mermaid blocks per the system prompt,
    // which streamdown renders). Cloud models (GPT-4, Claude, Gemini, etc.) that
    // are in the list get tools passed and use the agentic tool path.
    const hasTools = Object.keys(this.tools).length > 0
    const selectedModel = useModelProvider.getState().selectedModel
    const modelSupportsTools = selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools
    const shouldEnableTools = hasTools && modelSupportsTools

    // Track stream timing and token count for token speed calculation
    let streamStartTime: number | undefined

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: shouldEnableTools ? this.tools : undefined,
      toolChoice: shouldEnableTools ? 'auto' : undefined,
      system: this.systemMessage,
      // When tools are enabled allow up to 3 steps so the model can:
      // call generate_diagram → see result → write follow-up text.
      stopWhen: shouldEnableTools ? stepCountIs(3) : stepCountIs(1),
    })

    let tokensPerSecond = 0

    return result.toUIMessageStream({
      messageMetadata: ({ part }) => {
        // Track stream start time on start
        if (part.type === 'start' && !streamStartTime) {
          streamStartTime = Date.now()
        }

        if (part.type === 'finish-step') {
          tokensPerSecond =
            (part.providerMetadata?.providerMetadata
              ?.tokensPerSecond as number) || 0
        }

        // Add usage and token speed to metadata on finish
        if (part.type === 'finish') {
          const finishPart = part as {
            type: 'finish'
            totalUsage: LanguageModelUsage
            finishReason: string
          }
          const usage = finishPart.totalUsage
          const durationMs = streamStartTime ? Date.now() - streamStartTime : 0
          const durationSec = durationMs / 1000

          const outputTokens = usage?.outputTokens ?? 0
          const inputTokens = usage?.inputTokens

          let tokenSpeed: number
          if (durationSec > 0 && outputTokens > 0) {
            tokenSpeed =
              tokensPerSecond > 0 ? tokensPerSecond : outputTokens / durationSec
          } else {
            tokenSpeed = 0
          }

          return {
            usage: {
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              totalTokens:
                usage?.totalTokens ?? (inputTokens ?? 0) + outputTokens,
            },
            tokenSpeed: {
              tokenSpeed: Math.round(tokenSpeed * 10) / 10, // Round to 1 decimal
              tokenCount: outputTokens,
              durationMs,
            },
          }
        }

        return undefined
      },
      onError: (error) => {
        // Note: By default, the AI SDK will return "An error occurred",
        // which is intentionally vague in case the error contains sensitive information like API keys.
        // If you want to provide more detailed error messages, keep the code below. Otherwise, remove this whole onError callback.
        if (error == null) {
          return 'Unknown error'
        }
        if (typeof error === 'string') {
          return error
        }
        if (error instanceof Error) {
          return error.message
        }
        return JSON.stringify(error)
      },
      onFinish: ({ responseMessage }) => {
        // Call the token usage callback with usage data when stream completes
        if (responseMessage) {
          const metadata = responseMessage.metadata as
            | Record<string, unknown>
            | undefined
          const usage = metadata?.usage as LanguageModelUsage | undefined
          if (usage) {
            this.onTokenUsage?.(usage, responseMessage.id)
          }
        }
      },
    })
  }

  private emitDataPart(
    type: string,
    data: AgentStatusData | RunLogData
  ): void {
    if (this.streamWriter) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.streamWriter.write({ type: `data-${type}`, data } as any)
    }
  }

  private async sendMultiAgentMessages(
    options: {
      chatId: string
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & {
      trigger: 'submit-message' | 'regenerate-message'
      messageId: string | undefined
    } & ChatRequestOptions,
    teamId: string
  ): Promise<ReadableStream<UIMessageChunk>> {
    let runLog: MultiAgentRunLog | null = null
    try {
      // Load team
      const team = useAgentTeamStore.getState().getTeam(teamId)
      if (!team) {
        throw new Error(`Agent team "${teamId}" not found`)
      }

      // Load agents from the assistant store
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
        const agent = assistantStore.assistants?.find(
          (a: { id: string }) => a.id === agentId
        )
        if (agent) {
          agents.push(agent)
        }
      }

      if (agents.length === 0) {
        throw new Error('No agents found for this team')
      }

      // Validate agent name uniqueness
      const nameError = validateTeamAgentNames(agents)
      if (nameError) throw new Error(nameError)

      // Ensure tools are loaded
      await this.refreshTools()

      // Initialize model
      const modelId =
        this.modelOverrideId ??
        useModelProvider.getState().selectedModel?.id
      const providerId = useModelProvider.getState().selectedProvider
      const providerConfig =
        useModelProvider.getState().getProviderByName(providerId)

      if (!this.serviceHub || !modelId || !providerConfig) {
        throw new Error(
          'ServiceHub not initialized or model/provider missing.'
        )
      }

      const activeProvider =
        useModelProvider.getState().getProviderByName(providerId) ??
        providerConfig

      // Create the main model
      const currentAssistant = useAssistant.getState().currentAssistant
      const inferenceParams = {
        ...(currentAssistant?.parameters ?? {}),
        ...(this.inferenceParameters ?? {}),
      }
      this.model = await ModelFactory.createModel(
        modelId,
        activeProvider,
        inferenceParams
      )

      // Save team config snapshot on first run (PRD Section 3.6)
      const rawMetadata = this.getThreadMetadata() ?? {}
      if (!rawMetadata.agent_team_snapshot && this.threadId) {
        try {
          useThreads.getState().updateThread(this.threadId, {
            metadata: {
              ...rawMetadata,
              agent_team_snapshot: { ...team, snapshotted_at: Date.now() },
            },
          })
        } catch (snapshotErr) {
          console.warn('Failed to save team snapshot:', snapshotErr)
        }
      }

      // Initialize per-run state
      const tokenBudget = team.token_budget ?? 100000
      runLog = new MultiAgentRunLog(team.id, this.threadId, tokenBudget)
      const healthMonitor = new AgentHealthMonitor()
      const tokenTracker = new TokenUsageTracker(tokenBudget)

      // Pre-flight cost gating: block execution if threshold exceeded
      if (team.cost_approval_threshold) {
        const estimate = estimateTeamRunCost(team, agents)
        if (estimate.range.max > team.cost_approval_threshold) {
          if (this.costApprovalCallback) {
            const approved = await this.costApprovalCallback(estimate)
            if (!approved) {
              throw new Error(
                'Multi-agent run cancelled by user (cost threshold)'
              )
            }
          } else {
            console.warn(
              `[MultiAgent] Cost estimate ${estimate.range.max} exceeds threshold ${team.cost_approval_threshold}, no approval callback set`
            )
          }
        }
      }

      // Shared options for delegation tools and parallel orchestration
      const delegationOptions = {
        model: this.model,
        allTools: this.tools,
        tokenTracker,
        healthMonitor,
        runLog,
        emitDataPart: (type: string, data: AgentStatusData) =>
          this.emitDataPart(type, data),
        createModel: async (
          overrideModelId: string,
          params: Record<string, unknown>
        ) =>
          ModelFactory.createModel(overrideModelId, activeProvider, params),
      }

      // Build tools and system prompt based on orchestration mode
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

      // Resolve variables from thread metadata
      const rawMeta = this.getThreadMetadata() ?? {}
      const variableValues = (rawMeta.agent_team_variables ?? {}) as Record<string, string>
      const resolvedSystem = resolveVariables(
        orchestratorSystem,
        team.variables,
        variableValues
      )

      // Resolve routing model for cost optimization
      const routingModel = team.orchestrator_model_id
        ? await ModelFactory.createModel(
            team.orchestrator_model_id,
            activeProvider,
            {}
          )
        : null

      // Create orchestrator Agent
      const orchestrator = new Agent({
        model: this.model,
        system: resolvedSystem,
        tools: { ...orchestratorTools },
        stopWhen: [
          stepCountIs(agents.length * 2 + 5),
          tokenTracker.budgetExhausted(),
        ],
        prepareStep: async ({ stepNumber, steps }) => {
          const mode = team.orchestration.mode

          // Count delegation tool calls made so far
          const delegationsMade = (steps ?? []).reduce((count, step) => {
            const calls = step.toolCalls ?? []
            return (
              count +
              calls.filter(
                (tc: { toolName: string }) =>
                  tc.toolName.startsWith('delegate_to_') ||
                  tc.toolName === 'run_all_agents_parallel'
              ).length
            )
          }, 0)

          // Determine toolChoice for this step.
          // Use SPECIFIC tool names (not generic 'required') because many
          // providers (Cloudflare Workers AI, some Gemini endpoints) silently
          // ignore tool_choice: "required" and generate text instead.
          // Specific tool names map to { type: "function", function: { name } }
          // in the OpenAI-compatible API, which is more widely enforced.
          let stepToolChoice:
            | undefined
            | 'required'
            | { type: 'tool'; toolName: string }

          switch (mode) {
            case 'parallel': {
              if (delegationsMade === 0) {
                stepToolChoice = {
                  type: 'tool',
                  toolName: 'run_all_agents_parallel',
                }
              }
              break
            }
            case 'sequential': {
              if (delegationsMade < agents.length) {
                const nextAgent = agents[delegationsMade]
                stepToolChoice = {
                  type: 'tool',
                  toolName: `delegate_to_${sanitize(nextAgent.name)}`,
                }
              }
              break
            }
            case 'evaluator-optimizer': {
              const maxIter =
                'max_iterations' in team.orchestration
                  ? (team.orchestration.max_iterations ?? 3)
                  : 3
              const requiredDelegations = maxIter * 2
              if (delegationsMade < requiredDelegations && agents.length >= 2) {
                // Check if the last evaluator approved the output
                if (steps && steps.length > 0) {
                  const lastStep = steps[steps.length - 1]
                  const lastToolResult = lastStep?.messages
                    ?.filter((m: any) => m.role === 'tool')
                    ?.pop()
                  const resultText = typeof lastToolResult?.content === 'string'
                    ? lastToolResult.content
                    : ''
                  if (/\bapproved?\b/i.test(resultText) || /\bpass(ed)?\b/i.test(resultText)) {
                    break // Evaluator approved, stop forcing more steps
                  }
                }
                // Alternate: even steps -> worker (agents[0]), odd -> evaluator (agents[1])
                const agentIdx = delegationsMade % 2
                stepToolChoice = {
                  type: 'tool',
                  toolName: `delegate_to_${sanitize(agents[agentIdx].name)}`,
                }
              }
              break
            }
            case 'router':
            default: {
              // Router: let the model choose which agent, but force it to pick one
              if (delegationsMade === 0) {
                stepToolChoice = 'required'
              }
              break
            }
          }

          const result: Record<string, unknown> = {}

          if (stepToolChoice) {
            result.toolChoice = stepToolChoice
          }

          // Use cheaper routing model for the first step in router mode
          if (stepNumber === 0 && routingModel && mode === 'router') {
            result.model = routingModel
          }

          // Context compression for long conversations
          // Increased threshold to 12 steps (default agents.length * 2 + 5 can be up to 25)
          // Keep original user messages (step 0) plus the last 8 steps
          if (steps && steps.length > 12) {
            // Keep tool call/result pairs from trimmed steps to maintain API validity
            const trimmedSteps = steps.slice(1, -8)
            const toolRelatedMessages = trimmedSteps.flatMap((s) =>
              s.messages.filter((m) =>
                m.role === 'tool' ||
                (m.role === 'assistant' && (m as any).tool_calls?.length)
              )
            )
            result.messages = [
              ...steps[0].messages,
              ...toolRelatedMessages,
              ...steps.slice(-8).flatMap((s) => s.messages),
            ]
          }

          return Object.keys(result).length > 0 ? result : undefined
        },
      })

      // Stream with typed data parts
      const modelMessages = convertToModelMessages(
        this.mapUserInlineAttachments(options.messages)
      )

      const orchestratorResult = orchestrator.stream({
        messages: modelMessages,
        abortSignal: options.abortSignal,
      })

      // Wrap in createUIMessageStream for data part support
      return createUIMessageStream({
        execute: async ({ writer }) => {
          this.streamWriter = writer

          try {
            await writer.merge(
              orchestratorResult.toUIMessageStream({
                onFinish: async ({ totalUsage }) => {
                  runLog.setOrchestratorTokens(
                    totalUsage?.totalTokens ?? 0
                  )

                  // Detect zero-delegation runs: the model didn't call any
                  // delegation tools, so no agents ran and output is empty.
                  const logData = runLog.getData()
                  if (logData.steps.length === 0) {
                    console.warn(
                      '[MultiAgent] Orchestrator finished without delegating to any agent. ' +
                      'The model may not support tool calling. ' +
                      `Model: ${modelId}, Mode: ${team.orchestration.mode}`
                    )
                    // Write a visible error message so the user isn't left with blank output
                    writer.write({
                      type: 'text',
                      text: `\n\n> **Agent Team Notice:** The orchestrator model did not delegate to any agents. ` +
                        `This usually means the model doesn't support tool calling reliably. ` +
                        `Try switching to a model that supports tool calling (e.g. GPT-4o, Claude, Gemini, Llama 4 Scout).`,
                    })
                  }

                  runLog.complete()
                  await persistRunLog(runLog)

                  // Emit run log summary as data part for UI
                  this.emitDataPart('runLog', runLog.getData())

                  const usage = runLog.getUsage()
                  if (this.onTokenUsage) {
                    this.onTokenUsage(
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
            const errMsg = streamError instanceof Error
              ? streamError.message
              : String(streamError)
            // Detect toolChoice-related failures (models that don't support tool_choice: required)
            const isBadRequest = /bad request|400|unsupported.*tool.?choice/i.test(errMsg)
            const hint = isBadRequest
              ? ' This model may not support forced tool calling (`tool_choice: required`). Try a model with full tool-calling support (e.g. GPT-4o, Claude, Gemini).'
              : ''
            writer.write({
              type: 'text',
              text: `\n\n> **Agent Team Error:** ${errMsg}${hint}`,
            })
            runLog.fail(errMsg)
            persistRunLog(runLog).catch(() => {})
            this.emitDataPart('runLog', runLog.getData())
          } finally {
            this.streamWriter = null
          }
        },
      })
    } catch (error) {
      // Re-throw abort errors — they should not trigger fallback
      if (error instanceof Error && error.name === 'AbortError') throw error

      console.error(
        'Multi-agent orchestration failed, falling back to single-agent:',
        error
      )

      // Persist failed run log if it was created
      if (runLog) {
        runLog.fail(error instanceof Error ? error.message : String(error))
        persistRunLog(runLog).catch(() => {})
      }

      // Emit error data part
      this.emitDataPart('agentStatus', {
        agent_id: 'orchestrator',
        agent_name: 'Orchestrator',
        status: 'error',
        tokens_used: 0,
        error: `Multi-agent failed: ${error instanceof Error ? error.message : String(error)}. Falling back to single-agent mode.`,
      })

      // Fall back to single-agent for this message only (don't permanently clear activeTeamId)
      const savedTeamId = this.activeTeamId
      this.activeTeamId = undefined
      try {
        return await this.sendMessages(options)
      } finally {
        this.activeTeamId = savedTeamId
      }
    }
  }

  async reconnectToStream(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: {
      chatId: string
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    // This function normally handles reconnecting to a stream on the backend, e.g. /api/chat
    // Since this project has no backend, we can't reconnect to a stream, so this is intentionally no-op.
    return null
  }

  /**
   *  Map user messages to include inline attachments in the message parts
   * @param messages
   * @returns
   */
  mapUserInlineAttachments(messages: UIMessage[]): UIMessage[] {
    return messages.map((message) => {
      if (message.role === 'user') {
        const metadata = message.metadata as
          | {
              inline_file_contents?: Array<{ name?: string; content?: string }>
            }
          | undefined
        const inlineFileContents = Array.isArray(metadata?.inline_file_contents)
          ? metadata.inline_file_contents.filter((f) => f?.content)
          : []
        // Tool messages have content as array of ToolResultPart
        if (inlineFileContents.length > 0) {
          const buildInlineText = (base: string) => {
            if (!inlineFileContents.length) return base
            const formatted = inlineFileContents
              .map((f) => `File: ${f.name || 'attachment'}\n${f.content ?? ''}`)
              .join('\n\n')
            return base ? `${base}\n\n${formatted}` : formatted
          }

          if (message.parts.length > 0) {
            const parts = message.parts.map((part) => {
              if (part.type === 'text') {
                return {
                  type: 'text' as const,
                  text: buildInlineText(part.text ?? ''),
                }
              }
              return part
            })
            return { ...message, parts }
          }
        }
      }

      return message
    })
  }
}
