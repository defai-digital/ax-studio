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
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'
import type { CostEstimate } from './multi-agent/cost-estimation'
import { executeSingleAgentStream } from './transport/single-agent-transport'
import { executeMultiAgentStream } from './transport/multi-agent-transport'
import type { TokenUsageCallback, ServiceHub, SendMessagesOptions } from './transport/transport-types'
import { prepareProviderForChat } from './chat/model-session'

export type { TokenUsageCallback }

export class CustomChatTransport implements ChatTransport<UIMessage> {
  public model: LanguageModel | null = null
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

  async refreshTools() {
    const toolsRecord: Record<string, Tool> = {}
    const getDisabledToolsForThread = useToolAvailable.getState().getDisabledToolsForThread
    const disabledToolKeys = this.threadId
      ? getDisabledToolsForThread(this.threadId)
      : useToolAvailable.getState().getDefaultDisabledTools()
    const isToolDisabled = (serverName: string, toolName: string): boolean =>
      disabledToolKeys.includes(`${serverName}::${toolName}`)

    if (this.serviceHub) {
      const selectedModel = useModelProvider.getState().selectedModel
      const modelSupportsTools = selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools

      if (modelSupportsTools) {
        try {
          const mcpTools = await this.serviceHub.mcp().getTools()
          if (Array.isArray(mcpTools) && mcpTools.length > 0) {
            mcpTools.forEach((tool) => {
              const serverName = (tool as { server?: string }).server || 'unknown'
              if (!isToolDisabled(serverName, tool.name)) {
                toolsRecord[tool.name] = {
                  description: tool.description,
                  inputSchema: jsonSchema(tool.inputSchema as Record<string, unknown>),
                } as Tool
              }
            })
          }
        } catch (error) { console.warn('Failed to load MCP tools:', error) }

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

    await this.refreshTools()

    const modelId = this.modelOverrideId ?? useModelProvider.getState().selectedModel?.id
    const providerId = useModelProvider.getState().selectedProvider
    const provider = useModelProvider.getState().getProviderByName(providerId)
    if (!this.serviceHub || !modelId || !provider) {
      throw new Error('ServiceHub not initialized or model/provider missing.')
    }

    const activeProvider = useModelProvider.getState().getProviderByName(providerId) ?? provider
    await prepareProviderForChat(getServiceHub(), activeProvider, modelId)

    const currentAssistant = useAssistant.getState().currentAssistant
    const inferenceParams = { ...(currentAssistant?.parameters ?? {}), ...(this.inferenceParameters ?? {}) }

    try {
      this.model = await ModelFactory.createModel(modelId, activeProvider, inferenceParams)
    } catch (error) {
      throw new Error(`Failed to create model: ${error instanceof Error ? error.message : JSON.stringify(error)}`)
    }

    const selectedModel = useModelProvider.getState().selectedModel
    const modelSupportsTools = selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools

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
