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
import { executeSingleAgentStream } from './transport/single-agent-transport'
import type { TokenUsageCallback, ServiceHub } from './transport/transport-types'
import { isLocalProvider, prepareProviderForChat } from './chat/model-session'
import { useLocalApiServer } from '@/hooks/settings/useLocalApiServer'
import { syncRemoteProviders } from './providers/provider-sync'

// Use native fetch — same reason as model-factory.ts (Tauri plugin ReadableStream
// incompatibility). Proxy accepts CORS from tauri:// origins on loopback.
const httpFetch = globalThis.fetch

// Cache preflight results so each model is only validated once.
// Successful models are cached for 10 minutes.
// Failed models are cached for 2 minutes (to allow retry after transient errors).
const PREFLIGHT_TTL_MS = 10 * 60 * 1000
const PREFLIGHT_FAIL_TTL_MS = 2 * 60 * 1000
const preflightCache = new Map<string, { ok: boolean; ts: number }>()

function modelProviderKey(modelId: string, providerId: string): string {
  return `${providerId}::${modelId}`
}

function isModelPreflightCached(modelId: string, providerId: string): boolean | null {
  const key = modelProviderKey(modelId, providerId)
  const entry = preflightCache.get(key)
  if (!entry) return null
  const ttl = entry.ok ? PREFLIGHT_TTL_MS : PREFLIGHT_FAIL_TTL_MS
  if (Date.now() - entry.ts > ttl) {
    preflightCache.delete(key)
    return null
  }
  if (!entry.ok) return false
  return true
}

function cachePreflightResult(modelId: string, providerId: string, ok: boolean) {
  preflightCache.set(modelProviderKey(modelId, providerId), { ok, ts: Date.now() })
}

function logRouterTrace(message: string, details?: Record<string, unknown>) {
  console.info(`[LLM Router] ${message}`, details ?? {})
}

async function syncProvidersForRouting(providers: ModelProvider[]) {
  try {
    await syncRemoteProviders(providers)
  } catch (error) {
    console.warn('[LLM Router] Provider sync before routing failed:', error)
  }
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
  private modelOverrideProviderId?: string

  constructor(
    systemMessage?: string,
    threadId?: string,
    inferenceParameters: Record<string, unknown> = {},
    modelOverrideId?: string,
    modelOverrideProviderId?: string
  ) {
    this.systemMessage = systemMessage
    this.threadId = threadId
    this.inferenceParameters = { ...inferenceParameters }
    this.modelOverrideId = modelOverrideId
    this.modelOverrideProviderId = modelOverrideProviderId
    this.serviceHub = useServiceStore.getState().serviceHub
  }

  updateSystemMessage(systemMessage: string | undefined) { this.systemMessage = systemMessage }
  updateInferenceParameters(parameters: Record<string, unknown>) { this.inferenceParameters = { ...parameters } }
  updateModelOverrideId(modelId: string | undefined) { this.modelOverrideId = modelId }
  updateModelOverrideProviderId(providerId: string | undefined) { this.modelOverrideProviderId = providerId }
  setOnTokenUsage(callback: TokenUsageCallback | undefined) { this.onTokenUsage = callback }

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
      const providerId =
        this.modelOverrideProviderId ?? useModelProvider.getState().selectedProvider
      const modelId =
        this.modelOverrideId ?? useModelProvider.getState().selectedModel?.id
      const provider = providerId
        ? useModelProvider.getState().getProviderByName(providerId)
        : undefined
      const model = provider?.models.find((entry) => entry.id === modelId)
      const modelSupportsTools = overrideModelSupportsTools
        ?? model?.capabilities?.includes('tools')
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
                if ((serverName === 'ax-studio' || serverName === 'ax-fabric') && !localKnowledgeEnabled) return
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
    const selectedModelId = useModelProvider.getState().selectedModel?.id
    const selectedProviderId = useModelProvider.getState().selectedProvider

    const fallbackModelId = this.modelOverrideId ?? selectedModelId ?? ''
    const fallbackProviderId = this.modelOverrideProviderId ?? selectedProviderId
    let finalModelId = fallbackModelId
    let finalProviderId = fallbackProviderId
    let preparedForPreflightKey: string | null = null
    this.lastRouterResult = null

    // LLM Router: when auto-routing is enabled, the router takes priority.
    // It decides the best model; on failure it falls back to the override/selected model.
    const routerSettings = useRouterSettings.getState()
    if (
      routerSettings.isAutoRouteEnabled(this.threadId) &&
      routerSettings.routerModelId &&
      routerSettings.routerProviderId
    ) {
      await syncProvidersForRouting(useModelProvider.getState().providers)
      const providers = useModelProvider.getState().providers
      const availableModels = getAvailableModelsForRouter(
        providers,
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
      logRouterTrace('decision complete', {
        routerModelId: routerSettings.routerModelId,
        routerProviderId: routerSettings.routerProviderId,
        selectedModelId: this.lastRouterResult.modelId,
        selectedProviderId: this.lastRouterResult.providerId,
        routed: this.lastRouterResult.routed,
        reason: this.lastRouterResult.reason,
        fallbackReason: this.lastRouterResult.fallbackReason,
        latencyMs: Math.round(this.lastRouterResult.latencyMs),
      })
      finalModelId = this.lastRouterResult.modelId
      finalProviderId = this.lastRouterResult.providerId
    }

    // Helper: prepare a model and execute the stream
    const executeWithModel = async (modelId: string, providerId: string) => {
      logRouterTrace('executing final model', {
        modelId,
        providerId,
        routed: this.lastRouterResult?.routed ?? false,
        fallbackReason: this.lastRouterResult?.fallbackReason,
      })
      const provider = useModelProvider.getState().getProviderByName(providerId)
      if (!this.serviceHub || !modelId || !provider) {
        throw new Error('ServiceHub not initialized or model/provider missing.')
      }

      if (preparedForPreflightKey !== modelProviderKey(modelId, providerId)) {
        await prepareProviderForChat(getServiceHub(), provider, modelId)
      }

      const currentAssistant = useAssistant.getState().currentAssistant
      const inferenceParams = { ...(currentAssistant?.parameters ?? {}), ...(this.inferenceParameters ?? {}) }

      this.model = await ModelFactory.createModel(modelId, provider, inferenceParams, {
        requestRole: 'final',
      })

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
          const routedProvider = useModelProvider.getState().getProviderByName(finalProviderId)
          if (!routedProvider) {
            throw new Error(`Provider "${finalProviderId}" is not configured`)
          }
          if (isLocalProvider(routedProvider)) {
            // Local routed models need to be started first so their localhost
            // provider is registered with the proxy before preflight runs.
            logRouterTrace('starting local routed model before preflight', {
              modelId: finalModelId,
              providerId: finalProviderId,
            })
            await prepareProviderForChat(getServiceHub(), routedProvider, finalModelId)
            preparedForPreflightKey = modelProviderKey(finalModelId, finalProviderId)
          }

          const { serverHost, serverPort, apiPrefix, apiKey: localProxyKey } =
            useLocalApiServer.getState()
          const proxyUrl = `http://${serverHost}:${serverPort}${apiPrefix}`
          const preflightHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Ax-Provider': finalProviderId,
            'X-Ax-Request-Role': 'preflight',
          }
          if (localProxyKey && localProxyKey.trim().length > 0) {
            preflightHeaders.Authorization = `Bearer ${localProxyKey}`
          }
          const preflight = await httpFetch(`${proxyUrl}/chat/completions`, {
            method: 'POST',
            headers: preflightHeaders,
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
          logRouterTrace('preflight passed', {
            modelId: finalModelId,
            providerId: finalProviderId,
          })
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
