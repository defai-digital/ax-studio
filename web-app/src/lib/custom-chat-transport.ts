import { type UIMessage } from '@ai-sdk/react'
import {
  convertToModelMessages,
  streamText,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
  type Tool,
  type LanguageModelUsage,
  jsonSchema,
} from 'ai'
import { useServiceStore, getServiceHub } from '@/hooks/useServiceHub'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'

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
    if (!this.serviceHub) {
      this.tools = {}
      return
    }

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

    const selectedModel = useModelProvider.getState().selectedModel
    const modelSupportsTools = selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools

    // Only load tools if model supports them
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

    // Include tools only if we have tools loaded AND model supports them
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
            message.parts = parts
          }
        }
      }

      return message
    })
  }
}
