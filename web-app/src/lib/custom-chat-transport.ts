import { type UIMessage } from '@ai-sdk/react'
import {
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
  type Tool,
  jsonSchema,
} from 'ai'
import { useServiceStore, getServiceHub } from '@/hooks/useServiceHub'
import { useToolAvailable } from '@/hooks/tools/useToolAvailable'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useAssistant } from '@/hooks/chat/useAssistant'
import { useThreads } from '@/hooks/threads/useThreads'
import { useFileRegistry, threadCollectionId, projectCollectionId } from '@/lib/file-registry'
import { useRouterSettings } from '@/hooks/settings/useRouterSettings'
import { routeMessage, getAvailableModelsForRouter } from './llm-router'
import type { CostEstimate } from './multi-agent/cost-estimation'
import { executeSingleAgentStream } from './transport/single-agent-transport'
import { executeMultiAgentStream } from './transport/multi-agent-transport'
import type { TokenUsageCallback, ServiceHub, SendMessagesOptions } from './transport/transport-types'
import { prepareProviderForChat } from './chat/model-session'
import { useLocalApiServer } from '@/hooks/settings/useLocalApiServer'

// Use native fetch — same reason as model-factory.ts (Tauri plugin ReadableStream
// incompatibility). Proxy accepts CORS from tauri:// origins on loopback.
const httpFetch = globalThis.fetch

// Cache preflight results so each model is only validated once.
// Failed models are remembered permanently (until page reload).
// Successful models are cached for 10 minutes.
const PREFLIGHT_TTL_MS = 10 * 60 * 1000
const preflightCache = new Map<string, { ok: boolean; ts: number }>()

function isModelPreflightCached(modelId: string, providerId: string): boolean | null {
  const key = `${providerId}::${modelId}`
  const entry = preflightCache.get(key)
  if (!entry) return null
  if (!entry.ok) return false // failed models stay rejected
  if (Date.now() - entry.ts > PREFLIGHT_TTL_MS) {
    preflightCache.delete(key)
    return null
  }
  return true
}

function cachePreflightResult(modelId: string, providerId: string, ok: boolean) {
  preflightCache.set(`${providerId}::${modelId}`, { ok, ts: Date.now() })
}

export type { TokenUsageCallback }

export class CustomChatTransport implements ChatTransport<UIMessage> {
  public model: LanguageModel | null = null
  public lastRouterResult: RouterResult | null = null
  private tools: Record<string, Tool> = {}
  private onTokenUsage?: TokenUsageCallback
  private modelSupportsTools = false
  private systemMessage?: string
  private serviceHub: ServiceHub | null
  private threadId?: string
  private inferenceParameters: Record<string, unknown>
  private modelOverrideId?: string
  private activeTeamId?: string
  private costApprovalCallback?: (estimate: CostEstimate) => Promise<boolean>

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

  updateSystemMessage(systemMessage: string | undefined) { this.systemMessage = systemMessage }
  updateInferenceParameters(parameters: Record<string, unknown>) { this.inferenceParameters = { ...parameters } }
  updateModelOverrideId(modelId: string | undefined) { this.modelOverrideId = modelId }
  setOnTokenUsage(callback: TokenUsageCallback | undefined) { this.onTokenUsage = callback }
  updateActiveTeamId(teamId: string | undefined) { this.activeTeamId = teamId }
  setCostApprovalCallback(callback: ((estimate: CostEstimate) => Promise<boolean>) | undefined) {
    this.costApprovalCallback = callback
  }

  private getThreadMetadata(): Record<string, unknown> | null {
    if (!this.threadId) return null
    try {
      const thread = useThreads.getState().getThreadById(this.threadId)
      return (thread?.metadata as Record<string, unknown>) ?? null
    } catch { return null }
  }

  async updateRagToolsAvailability(_hasDocuments: boolean, modelSupportsTools: boolean, _ragFeatureAvailable: boolean) {
    this.modelSupportsTools = modelSupportsTools
    await this.refreshTools()
  }

  async refreshTools(overrideModelSupportsTools?: boolean) {
    const toolsRecord: Record<string, Tool> = {}
    const getDisabledToolsForThread = useToolAvailable.getState().getDisabledToolsForThread
    const disabledToolKeys = this.threadId
      ? getDisabledToolsForThread(this.threadId)
      : useToolAvailable.getState().getDefaultDisabledTools()
    const isToolDisabled = (serverName: string, toolName: string): boolean =>
      disabledToolKeys.includes(`${serverName}::${toolName}`)

    if (this.serviceHub) {
      const modelSupportsTools = overrideModelSupportsTools
        ?? useModelProvider.getState().selectedModel?.capabilities?.includes('tools')
        ?? this.modelSupportsTools

      if (modelSupportsTools) {
        const localKnowledgeEnabled = this.threadId
          ? useLocalKnowledge.getState().isLocalKnowledgeEnabledForThread(this.threadId)
          : useLocalKnowledge.getState().localKnowledgeEnabled

        try {
          const mcpTools = await this.serviceHub.mcp().getTools()
          if (Array.isArray(mcpTools) && mcpTools.length > 0) {
            mcpTools.forEach((tool) => {
              const serverName = (tool as { server?: string }).server || 'unknown'
              if (!isToolDisabled(serverName, tool.name)) {
                if (serverName === 'ax-studio' && !localKnowledgeEnabled) return
                toolsRecord[tool.name] = {
                  description: tool.description,
                  inputSchema: jsonSchema(tool.inputSchema as Record<string, unknown>),
                } as Tool
              }
            })
          }
        } catch (error) { console.warn('Failed to load MCP tools:', error) }

        // Load RAG tools when thread has indexed documents
        try {
          if (this.threadId) {
            const threadMeta = this.getThreadMetadata()
            const hasThreadDocsFlag = threadMeta?.hasDocuments === true
            const threadProjectId = (threadMeta?.project as Record<string, unknown> | undefined)?.id as string | undefined

            let hasProjectDocs = false
            if (threadProjectId) {
              hasProjectDocs = useFileRegistry.getState().hasFiles(projectCollectionId(threadProjectId))
            }
            const hasThreadFiles = useFileRegistry.getState().hasFiles(threadCollectionId(this.threadId))

            // Correct stale hasDocuments metadata from the old fake pipeline:
            // if the flag is true but no files exist in the registry, clear it.
            if (hasThreadDocsFlag && !hasThreadFiles) {
              try {
                useThreads.getState().updateThread(this.threadId, {
                  metadata: { hasDocuments: false },
                })
              } catch { /* best-effort correction */ }
            }

            if (hasThreadFiles || hasProjectDocs) {
              const ragTools = await this.serviceHub.rag().getTools()
              for (const tool of ragTools) {
                const serverName = (tool as { server?: string }).server || 'unknown'
                if (!isToolDisabled(serverName, tool.name)) {
                  toolsRecord[tool.name] = {
                    description: tool.description,
                    inputSchema: jsonSchema(tool.inputSchema as Record<string, unknown>),
                  } as Tool
                }
              }
            }
          }
        } catch (error) { console.warn('Failed to load RAG tools:', error) }

      }
    }

    this.tools = toolsRecord
  }

  getTools(): Record<string, Tool> { return this.tools }

  async sendMessages(
    options: { chatId: string; messages: UIMessage[]; abortSignal: AbortSignal | undefined }
      & { trigger: 'submit-message' | 'regenerate-message'; messageId: string | undefined }
      & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    if (this.activeTeamId) {
      return executeMultiAgentStream(options as SendMessagesOptions, {
        teamId: this.activeTeamId,
        model: this.model!,
        tools: this.tools,
        systemMessage: this.systemMessage,
        threadId: this.threadId,
        inferenceParameters: this.inferenceParameters,
        modelOverrideId: this.modelOverrideId,
        onTokenUsage: this.onTokenUsage,
        costApprovalCallback: this.costApprovalCallback,
        getThreadMetadata: () => this.getThreadMetadata(),
        mapUserInlineAttachments: (msgs) => this.mapUserInlineAttachments(msgs),
        refreshTools: () => this.refreshTools(),
        onFallbackToSingleAgent: (opts) => {
          const savedTeamId = this.activeTeamId
          this.activeTeamId = undefined
          return this.sendMessages(opts as Parameters<typeof this.sendMessages>[0])
            .finally(() => { this.activeTeamId = savedTeamId })
        },
      })
    }

    const selectedModelId = useModelProvider.getState().selectedModel?.id
    const selectedProviderId = useModelProvider.getState().selectedProvider

    const fallbackModelId = this.modelOverrideId ?? selectedModelId ?? ''
    const fallbackProviderId = selectedProviderId
    let finalModelId = fallbackModelId
    let finalProviderId = fallbackProviderId
    this.lastRouterResult = null

    // LLM Router: when auto-routing is enabled, the router takes priority.
    // It decides the best model; on failure it falls back to the override/selected model.
    const routerSettings = useRouterSettings.getState()
    if (
      routerSettings.isAutoRouteEnabled(this.threadId) &&
      routerSettings.routerModelId &&
      routerSettings.routerProviderId
    ) {
      const availableModels = getAvailableModelsForRouter(
        useModelProvider.getState().providers,
        routerSettings.routerModelId,
      )
      this.lastRouterResult = await routeMessage(
        options.messages,
        routerSettings.routerModelId,
        routerSettings.routerProviderId,
        availableModels,
        fallbackModelId,
        fallbackProviderId,
        routerSettings.timeout,
      )
      finalModelId = this.lastRouterResult.modelId
      finalProviderId = this.lastRouterResult.providerId
    }

    // Helper: prepare a model and execute the stream
    const executeWithModel = async (modelId: string, providerId: string) => {
      const provider = useModelProvider.getState().getProviderByName(providerId)
      if (!this.serviceHub || !modelId || !provider) {
        throw new Error('ServiceHub not initialized or model/provider missing.')
      }

      await prepareProviderForChat(getServiceHub(), provider, modelId)

      const currentAssistant = useAssistant.getState().currentAssistant
      const inferenceParams = { ...(currentAssistant?.parameters ?? {}), ...(this.inferenceParameters ?? {}) }

      this.model = await ModelFactory.createModel(modelId, provider, inferenceParams)

      // Determine tool support for this model
      const providerModels = provider.models ?? []
      const modelEntry = providerModels.find((m) => m.id === modelId)
      const modelSupportsTools = modelEntry?.capabilities?.includes('tools') ?? this.modelSupportsTools

      // Refresh tools AFTER routing so the correct model's capabilities are used
      await this.refreshTools(modelSupportsTools)

      return executeSingleAgentStream({
        model: this.model,
        tools: this.tools,
        systemMessage: this.systemMessage,
        messages: options.messages,
        abortSignal: options.abortSignal,
        modelSupportsTools,
        onTokenUsage: this.onTokenUsage,
        mapUserInlineAttachments: (msgs) => this.mapUserInlineAttachments(msgs),
      })
    }

    // If the router picked a different model, validate it before streaming.
    // AI SDK's toUIMessageStream() encodes errors as stream protocol messages
    // (not thrown errors), so we can't catch them by reading the stream.
    // Instead, send a lightweight preflight request (max_tokens: 1, non-streaming)
    // to verify the model is reachable. Results are cached so the preflight
    // only runs once per model — subsequent messages skip it entirely.
    if (this.lastRouterResult?.routed && finalModelId !== fallbackModelId) {
      const cached = isModelPreflightCached(finalModelId, finalProviderId)

      if (cached === false) {
        // Previously failed — skip directly to fallback
        console.warn(`[LLM Router] Routed model "${finalModelId}" previously failed, using fallback`)
        this.lastRouterResult = {
          modelId: fallbackModelId,
          providerId: fallbackProviderId,
          reason: 'fallback',
          routed: false,
          fallbackReason: 'routed model previously failed preflight',
          latencyMs: this.lastRouterResult.latencyMs,
        }
        return executeWithModel(fallbackModelId, fallbackProviderId)
      }

      if (cached === null) {
        // Not cached — run preflight
        const routerResult = this.lastRouterResult
        try {
          const { serverHost, serverPort, apiPrefix } = useLocalApiServer.getState()
          const proxyUrl = `http://${serverHost}:${serverPort}${apiPrefix}`
          const preflight = await httpFetch(`${proxyUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Ax-Provider': finalProviderId,
            },
            body: JSON.stringify({
              model: finalModelId,
              messages: [{ role: 'user', content: '.' }],
              max_tokens: 1,
              stream: false,
            }),
          })
          if (!preflight.ok) {
            const body = await preflight.text().catch(() => '')
            throw new Error(`${preflight.status}: ${body.slice(0, 200)}`)
          }
          cachePreflightResult(finalModelId, finalProviderId, true)
        } catch (error) {
          cachePreflightResult(finalModelId, finalProviderId, false)
          console.warn(
            `[LLM Router] Routed model "${finalModelId}" preflight failed, falling back to "${fallbackModelId}":`,
            error instanceof Error ? error.message : error,
          )
          this.lastRouterResult = {
            modelId: fallbackModelId,
            providerId: fallbackProviderId,
            reason: 'fallback',
            routed: false,
            fallbackReason: `routed model failed: ${error instanceof Error ? error.message : 'unknown error'}`,
            latencyMs: routerResult.latencyMs,
          }
          return executeWithModel(fallbackModelId, fallbackProviderId)
        }
      }
      // cached === true — model verified, proceed directly
    }

    return executeWithModel(finalModelId, finalProviderId)
  }

  async reconnectToStream(_options: { chatId: string } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  mapUserInlineAttachments(messages: UIMessage[]): UIMessage[] {
    return messages.map((message) => {
      if (message.role !== 'user') return message
      const metadata = message.metadata as { inline_file_contents?: Array<{ name?: string; content?: string }> } | undefined
      const inlineFileContents = Array.isArray(metadata?.inline_file_contents)
        ? metadata.inline_file_contents.filter((f) => f?.content)
        : []
      if (inlineFileContents.length > 0 && message.parts.length > 0) {
        const buildInlineText = (base: string) => {
          if (!inlineFileContents.length) return base
          const formatted = inlineFileContents.map((f) => `File: ${f.name || 'attachment'}\n${f.content ?? ''}`).join('\n\n')
          return base ? `${base}\n\n${formatted}` : formatted
        }
        const parts = message.parts.map((part) =>
          part.type === 'text' ? { type: 'text' as const, text: buildInlineText(part.text ?? '') } : part
        )
        return { ...message, parts }
      }
      return message
    })
  }
}
