import { create } from 'zustand'
import { ThreadMessage } from '@ax-studio/core'
import { MCPTool } from '@/types/mcp'
import { ChatCompletionMessageToolCall } from 'openai/resources'

export type PromptProgress = {
  cache: number
  processed: number
  time_ms: number
  total: number
}

type AppErrorMessage = {
  message?: string
  title?: string
  subtitle: string
}

type AppState = {
  streamingContent?: ThreadMessage
  loadingModel?: boolean
  tools: MCPTool[]
  mcpToolNames: Set<string>
  serverStatus: 'running' | 'stopped' | 'pending'
  abortControllers: Record<string, AbortController>
  tokenSpeed?: TokenSpeed
  currentToolCall?: ChatCompletionMessageToolCall
  showOutOfContextDialog?: boolean
  errorMessage?: AppErrorMessage
  promptProgress?: PromptProgress
  activeModels: string[]
  toolCallCancellations: Record<string, () => void>
  setServerStatus: (value: 'running' | 'stopped' | 'pending') => void
  updateStreamingContent: (content: ThreadMessage | undefined) => void
  updateCurrentToolCall: (
    toolCall: ChatCompletionMessageToolCall | undefined
  ) => void
  updateLoadingModel: (loading: boolean) => void
  updateTools: (tools: MCPTool[]) => void
  updateMcpToolNames: (names: string[]) => void
  setAbortController: (threadId: string, controller: AbortController) => void
  clearAbortController: (threadId: string) => void
  updateTokenSpeed: (message: Pick<ThreadMessage, 'id'>, increment?: number) => void
  setTokenSpeed: (
    message: Pick<ThreadMessage, 'id'>,
    speed: number,
    completionTokens: number
  ) => void
  resetTokenSpeed: () => void
  clearAppState: () => void
  setOutOfContextDialog: (show: boolean) => void
  setToolCallCancellation: (threadId: string, cancel: () => void) => void
  clearToolCallCancellation: (threadId: string, cancel?: () => void) => void
  cancelToolCall: (threadId: string) => void
  setErrorMessage: (error: AppErrorMessage | undefined) => void
  updatePromptProgress: (progress: PromptProgress | undefined) => void
  setActiveModels: (models: string[]) => void
}

type TokenSpeed = {
  lastTimestamp: number
  tokenSpeed: number
  tokenCount: number
  message?: string
}

const getOwnAbortController = (
  abortControllers: Record<string, AbortController>,
  threadId: string
): AbortController | undefined =>
  Object.prototype.hasOwnProperty.call(abortControllers, threadId)
    ? abortControllers[threadId]
    : undefined

const getOwnToolCallCancellation = (
  cancellations: Record<string, () => void>,
  threadId: string
): (() => void) | undefined =>
  Object.prototype.hasOwnProperty.call(cancellations, threadId)
    ? cancellations[threadId]
    : undefined

// ── Token speed throttle ────────────────────────────────────────────────────
// Streaming can deliver 30+ tokens/sec. Committing each increment to Zustand
// triggers a React reconciliation per token. We buffer increments and flush
// at most every TOKEN_SPEED_FLUSH_MS so subscribers re-render ~10×/sec.
const TOKEN_SPEED_FLUSH_MS = 100
let pendingTokenIncrement = 0
let pendingTokenMessageId: string | undefined
let lastTokenSpeedFlush = 0

export const useAppState = create<AppState>()((set) => ({
  streamingContent: undefined,
  loadingModel: false,
  tools: [],
  mcpToolNames: new Set<string>(),
  serverStatus: 'stopped',
  abortControllers: {},
  tokenSpeed: undefined,
  currentToolCall: undefined,
  promptProgress: undefined,
  toolCallCancellations: {},
  activeModels: [],
  updateStreamingContent: (content: ThreadMessage | undefined) => {
    set(() => ({
      streamingContent: content
        ? {
            ...content,
            created_at: content.created_at || Date.now(),
          }
        : undefined,
    }))
  },
  updateCurrentToolCall: (toolCall) => {
    set(() => ({
      currentToolCall: toolCall,
    }))
  },
  updateLoadingModel: (loading) => {
    set({ loadingModel: loading })
  },
  updateTools: (tools) => {
    set({ tools })
  },
  updateMcpToolNames: (names) => {
    set({ mcpToolNames: new Set(names) })
  },
  setServerStatus: (value) => set({ serverStatus: value }),
  setAbortController: (threadId, controller) => {
    set((state) => {
      // Abort any previous controller for this thread so we don't keep
      // signal listeners alive and so a second send cancels an in-flight one.
      getOwnAbortController(state.abortControllers, threadId)?.abort()
      return {
        abortControllers: {
          ...state.abortControllers,
          [threadId]: controller,
        },
      }
    })
  },
  clearAbortController: (threadId) => {
    set((state) => {
      const controller = getOwnAbortController(state.abortControllers, threadId)
      if (!controller) return state
      controller.abort()

      const { [threadId]: _removed, ...rest } = state.abortControllers
      return { abortControllers: rest }
    })
  },
  setTokenSpeed: (message, speed, completionTokens) => {
    set((state) => ({
      tokenSpeed: {
        ...state.tokenSpeed,
        lastTimestamp: new Date().getTime(),
        tokenSpeed: speed,
        tokenCount: completionTokens,
        message: message.id,
      },
    }))
  },
  updateTokenSpeed: (message, increment = 1) => {
    // Accumulate in the module-level buffer.
    const wasEmpty = pendingTokenMessageId === undefined
    pendingTokenIncrement += increment
    pendingTokenMessageId = message.id

    const now = Date.now()
    // Flush immediately on the first token of a new stream (wasEmpty) so the
    // UI shows progress without delay; subsequent tokens are throttled.
    if (!wasEmpty && now - lastTokenSpeedFlush < TOKEN_SPEED_FLUSH_MS) return
    lastTokenSpeedFlush = now

    const flushedIncrement = pendingTokenIncrement
    const flushedMessageId = pendingTokenMessageId
    pendingTokenIncrement = 0
    pendingTokenMessageId = undefined

    set((state) => {
      const currentTimestamp = now
      if (!state.tokenSpeed) {
        return {
          tokenSpeed: {
            lastTimestamp: currentTimestamp,
            tokenSpeed: 0,
            tokenCount: flushedIncrement,
            message: flushedMessageId,
          },
        }
      }

      const timeDiffInSeconds =
        (currentTimestamp - state.tokenSpeed.lastTimestamp) / 1000
      const totalTokenCount = state.tokenSpeed.tokenCount + flushedIncrement
      const averageTokenSpeed =
        totalTokenCount / (timeDiffInSeconds > 0 ? timeDiffInSeconds : 1)
      return {
        tokenSpeed: {
          ...state.tokenSpeed,
          tokenSpeed: averageTokenSpeed,
          tokenCount: totalTokenCount,
          message: flushedMessageId,
        },
      }
    })
  },
  resetTokenSpeed: () => {
    pendingTokenIncrement = 0
    pendingTokenMessageId = undefined
    lastTokenSpeedFlush = 0
    set({ tokenSpeed: undefined })
  },
  clearAppState: () =>
    set((state) => {
      // Abort every in-flight stream before clearing — dropping the map
      // without calling `.abort()` leaves the underlying fetch/reader
      // alive, wasting bandwidth and risking stale setState calls after
      // the user clears their session.
      Object.values(state.abortControllers).forEach((controller) => {
        try {
          controller?.abort()
        } catch {
          /* ignore — controller may already be aborted */
        }
      })
      Object.values(state.toolCallCancellations).forEach((cancel) => {
        try {
          cancel()
        } catch {
          /* ignore — cancellation is best-effort during global teardown */
        }
      })
      return {
        streamingContent: undefined,
        abortControllers: {},
        tokenSpeed: undefined,
        currentToolCall: undefined,
        toolCallCancellations: {},
        errorMessage: undefined,
        showOutOfContextDialog: false,
        loadingModel: false,
        promptProgress: undefined,
        activeModels: [],
      }
    }),
  setOutOfContextDialog: (show) => {
    set(() => ({
      showOutOfContextDialog: show,
    }))
  },
  setToolCallCancellation: (threadId, cancel) => {
    set((state) => ({
      toolCallCancellations: {
        ...state.toolCallCancellations,
        [threadId]: cancel,
      },
    }))
  },
  clearToolCallCancellation: (threadId, cancel) => {
    set((state) => {
      const current = getOwnToolCallCancellation(
        state.toolCallCancellations,
        threadId
      )
      if (!current || (cancel && current !== cancel)) return state
      const { [threadId]: _removed, ...rest } = state.toolCallCancellations
      return { toolCallCancellations: rest }
    })
  },
  cancelToolCall: (threadId) => {
    const cancel = getOwnToolCallCancellation(
      useAppState.getState().toolCallCancellations,
      threadId
    )
    cancel?.()
  },
  setErrorMessage: (error) => {
    set(() => ({
      errorMessage: error,
    }))
  },
  updatePromptProgress: (progress) => {
    set(() => ({
      promptProgress: progress,
    }))
  },
  setActiveModels: (models: string[]) => {
    set(() => ({
      activeModels: models,
    }))
  },
}))
