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
  updateTokenSpeed: (message: ThreadMessage, increment?: number) => void
  setTokenSpeed: (
    message: ThreadMessage,
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
  updateTokenSpeed: (message, increment = 1) =>
    set((state) => {
      const currentTimestamp = new Date().getTime() // Get current time in milliseconds
      if (!state.tokenSpeed) {
        // If this is the first update, just set the lastTimestamp and return
        return {
          tokenSpeed: {
            lastTimestamp: currentTimestamp,
            tokenSpeed: 0,
            tokenCount: increment,
            message: message.id,
          },
        }
      }

      const timeDiffInSeconds =
        (currentTimestamp - state.tokenSpeed.lastTimestamp) / 1000 // Time difference in seconds
      const totalTokenCount = state.tokenSpeed.tokenCount + increment
      const averageTokenSpeed =
        totalTokenCount / (timeDiffInSeconds > 0 ? timeDiffInSeconds : 1) // Calculate average token speed
      return {
        tokenSpeed: {
          ...state.tokenSpeed,
          tokenSpeed: averageTokenSpeed,
          tokenCount: totalTokenCount,
          message: message.id,
        },
      }
    }),
  resetTokenSpeed: () =>
    set({
      tokenSpeed: undefined,
    }),
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
