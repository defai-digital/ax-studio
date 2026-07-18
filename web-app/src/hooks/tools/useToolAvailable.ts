import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'
import type { MCPTool } from '@/types/mcp'
import { appendUniqueString, uniqueStrings } from '@/lib/utils/array'

const MAX_DISABLED_TOOL_THREADS = 200
const MAX_DISABLED_TOOLS_PER_THREAD = 200

// Helper function to create composite key for server+tool
const createToolKey = (serverName: string, toolName: string) => {
  return `${serverName}::${toolName}`
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const normalizeNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

const normalizeToolKey = (value: unknown): string | null => {
  const normalized = normalizeNonEmptyString(value)
  if (!normalized) return null

  const [serverName, toolName, ...extra] = normalized.split('::')
  if (extra.length > 0) return null

  const normalizedServerName = normalizeNonEmptyString(serverName)
  const normalizedToolName = normalizeNonEmptyString(toolName)
  if (!normalizedServerName || !normalizedToolName) return null

  return createToolKey(normalizedServerName, normalizedToolName)
}

const normalizeToolList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []

  const tools: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const toolKey = normalizeToolKey(item)
    if (!toolKey || seen.has(toolKey)) continue

    seen.add(toolKey)
    tools.push(toolKey)
    if (tools.length >= MAX_DISABLED_TOOLS_PER_THREAD) break
  }

  return tools
}

const normalizeDisabledTools = (
  value: unknown
): Record<string, string[]> => {
  if (!isPlainRecord(value)) return {}

  const disabledTools = new Map<string, string[]>()
  for (const [threadId, tools] of Object.entries(value)) {
    const normalizedThreadId = normalizeNonEmptyString(threadId)
    if (!normalizedThreadId) continue

    disabledTools.set(normalizedThreadId, normalizeToolList(tools))
    if (disabledTools.size >= MAX_DISABLED_TOOL_THREADS) break
  }

  return Object.fromEntries(disabledTools)
}

const getOwnToolList = (
  disabledTools: Record<string, unknown>,
  threadId: string
): unknown => {
  return Object.prototype.hasOwnProperty.call(disabledTools, threadId)
    ? disabledTools[threadId]
    : undefined
}

const isOldFormatKey = (key: string): boolean => {
  return !key.includes('::')
}

const containsOldFormatToolKey = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false
  return value.some((toolKey) => {
    const normalizedToolKey = normalizeNonEmptyString(toolKey)
    return normalizedToolKey ? isOldFormatKey(normalizedToolKey) : false
  })
}

const containsOldFormatDisabledTools = (value: unknown): boolean => {
  if (!isPlainRecord(value)) return false
  return Object.values(value).some(containsOldFormatToolKey)
}

const sanitizePersistedToolAvailability = (
  persisted: unknown
): Pick<
  ToolDisabledState,
  'disabledTools' | 'defaultDisabledTools' | 'defaultsInitialized'
> => {
  if (!isPlainRecord(persisted)) {
    return {
      disabledTools: {},
      defaultDisabledTools: [],
      defaultsInitialized: false,
    }
  }

  const hasLegacyToolKeys =
    containsOldFormatDisabledTools(persisted.disabledTools) ||
    containsOldFormatToolKey(persisted.defaultDisabledTools)

  if (hasLegacyToolKeys) {
    return {
      disabledTools: {},
      defaultDisabledTools: [],
      defaultsInitialized: false,
    }
  }

  return {
    disabledTools: normalizeDisabledTools(persisted.disabledTools),
    defaultDisabledTools: normalizeToolList(persisted.defaultDisabledTools),
    defaultsInitialized: persisted.defaultsInitialized === true,
  }
}

type ToolDisabledState = {
  // Track disabled tools per thread using server::tool composite keys
  disabledTools: Record<string, string[]> // threadId -> toolKeys[] (server::tool format)
  // Global default disabled tools (for new threads/index page) using composite keys
  defaultDisabledTools: string[]
  // Flag to track if defaults have been initialized from extension
  defaultsInitialized: boolean

  // Actions - now require both server and tool name
  setToolDisabledForThread: (
    threadId: string,
    serverName: string,
    toolName: string,
    available: boolean
  ) => void
  isToolDisabled: (threadId: string, serverName: string, toolName: string) => boolean
  getDisabledToolsForThread: (threadId: string) => string[]
  setDefaultDisabledTools: (toolKeys: string[]) => void
  getDefaultDisabledTools: () => string[]
  isDefaultsInitialized: () => boolean
  markDefaultsAsInitialized: () => void
  // Initialize thread tools from default or existing thread settings
  initializeThreadTools: (threadId: string, allTools: MCPTool[]) => void
}

export const useToolAvailable = create<ToolDisabledState>()(
  persist(
    (set, get) => ({
      disabledTools: {},
      defaultDisabledTools: [],
      defaultsInitialized: false,

      setToolDisabledForThread: (
        threadId: string,
        serverName: string,
        toolName: string,
        available: boolean
      ) => {
        const normalizedThreadId = normalizeNonEmptyString(threadId)
        const normalizedServerName = normalizeNonEmptyString(serverName)
        const normalizedToolName = normalizeNonEmptyString(toolName)
        if (
          !normalizedThreadId ||
          !normalizedServerName ||
          !normalizedToolName ||
          typeof available !== 'boolean'
        ) {
          return
        }

        set((state) => {
          const currentTools = normalizeToolList(
            state.disabledTools[normalizedThreadId]
          )
          const toolKey = createToolKey(normalizedServerName, normalizedToolName)
          let updatedTools: string[]

          if (available) {
            // Remove disabled tool
            updatedTools = [...currentTools.filter((key) => key !== toolKey)]
          } else {
            // Disable tool
            updatedTools = appendUniqueString(currentTools, toolKey)
          }

          return {
            disabledTools: {
              ...state.disabledTools,
              [normalizedThreadId]: updatedTools,
            },
          }
        })
      },

      isToolDisabled: (threadId: string, serverName: string, toolName: string) => {
        const state = get()
        const normalizedThreadId = normalizeNonEmptyString(threadId)
        const normalizedServerName = normalizeNonEmptyString(serverName)
        const normalizedToolName = normalizeNonEmptyString(toolName)
        if (!normalizedThreadId || !normalizedServerName || !normalizedToolName) {
          return false
        }

        const toolKey = createToolKey(normalizedServerName, normalizedToolName)
        const disabledTools = isPlainRecord(state.disabledTools)
          ? state.disabledTools
          : {}
        const threadTools = getOwnToolList(disabledTools, normalizedThreadId)
        // If no thread-specific settings, use default
        if (threadTools === undefined) {
          return normalizeToolList(state.defaultDisabledTools).includes(toolKey)
        }
        return normalizeToolList(threadTools).includes(toolKey)
      },

      getDisabledToolsForThread: (threadId: string) => {
        const state = get()
        const normalizedThreadId = normalizeNonEmptyString(threadId)
        if (!normalizedThreadId) return []

        const disabledTools = isPlainRecord(state.disabledTools)
          ? state.disabledTools
          : {}
        const threadTools = getOwnToolList(disabledTools, normalizedThreadId)
        // If no thread-specific settings, use default
        if (threadTools === undefined) {
          return normalizeToolList(state.defaultDisabledTools)
        }
        return normalizeToolList(threadTools)
      },

      setDefaultDisabledTools: (toolKeys: string[]) => {
        set({ defaultDisabledTools: normalizeToolList(toolKeys) })
      },

      getDefaultDisabledTools: () => {
        return normalizeToolList(get().defaultDisabledTools)
      },

      isDefaultsInitialized: () => {
        return get().defaultsInitialized
      },

      markDefaultsAsInitialized: () => {
        set({ defaultsInitialized: true })
      },

      initializeThreadTools: (threadId: string, allTools: MCPTool[]) => {
        const normalizedThreadId = normalizeNonEmptyString(threadId)
        if (!normalizedThreadId || !Array.isArray(allTools)) return

        const state = get()
        const disabledTools = isPlainRecord(state.disabledTools)
          ? state.disabledTools
          : {}
        // If thread already has settings, don't override
        if (getOwnToolList(disabledTools, normalizedThreadId) !== undefined) {
          return
        }

        // Initialize with default tools only
        // Don't auto-enable all tools if defaults are explicitly empty
        const availableToolKeys = new Set(
          allTools
            .map((tool) => {
              const serverName = normalizeNonEmptyString(tool?.server)
              const toolName = normalizeNonEmptyString(tool?.name)
              return serverName && toolName
                ? createToolKey(serverName, toolName)
                : null
            })
            .filter((toolKey): toolKey is string => toolKey !== null)
        )
        const initialTools = normalizeToolList(state.defaultDisabledTools).filter(
          (toolKey) => availableToolKeys.has(toolKey)
        )

        set((currentState) => ({
          disabledTools: {
            ...currentState.disabledTools,
            [normalizedThreadId]: uniqueStrings(initialTools),
          },
        }))
      },
    }),
    {
      name: localStorageKey.toolAvailability,
      storage: createSafeJSONStorage(() => localStorage, 'useToolAvailable'),
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePersistedToolAvailability(persisted),
      }),
      partialize: (state) => ({
        ...sanitizePersistedToolAvailability(state),
      }),
      // Migration function to handle old format data
      migrate: (persistedState: unknown) => {
        return sanitizePersistedToolAvailability(persistedState)
      },
      version: 1, // Increment version to trigger migration
    }
  )
)
