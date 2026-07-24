import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
// Pure types and the default-settings constant are owned by the MCP service
// layer; re-exported here so existing import sites keep working.
export type {
  MCPServerConfig,
  MCPServers,
  MCPSettings,
} from '@/services/mcp/types'
import {
  DEFAULT_MCP_SETTINGS,
  type MCPServerConfig,
  type MCPServers,
  type MCPSettings,
} from '@/services/mcp/types'

export { DEFAULT_MCP_SETTINGS }

type MCPServerStoreState = {
  open: boolean
  mcpServers: MCPServers
  settings: MCPSettings
  loading: boolean
  deletedServerKeys: string[]
  getServerConfig: (key: string) => MCPServerConfig | undefined
  setLeftPanel: (value: boolean) => void
  addServer: (key: string, config: MCPServerConfig) => void
  editServer: (key: string, config: MCPServerConfig) => void
  renameServer: (
    oldKey: string,
    newKey: string,
    config: MCPServerConfig
  ) => void
  deleteServer: (key: string) => void
  setServers: (servers: MCPServers) => void
  setSettings: (settings: MCPSettings) => void
  updateSettings: (partial: Partial<MCPSettings>) => void
  syncServers: () => Promise<void>
  syncServersAndRestart: () => Promise<void>
}

const hasOwnServer = (servers: MCPServers, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(servers, key)
}

export const useMCPServers = create<MCPServerStoreState>()((set, get) => ({
  open: true,
  mcpServers: {}, // Start with empty object
  settings: { ...DEFAULT_MCP_SETTINGS },
  loading: false,
  deletedServerKeys: [],
  setLeftPanel: (value) => set({ open: value }),
  getServerConfig: (key) => {
    const mcpServers = get().mcpServers
    // Return the server configuration if it exists, otherwise return undefined
    return hasOwnServer(mcpServers, key) ? mcpServers[key] : undefined
  },
  // Add a new MCP server or update if the key already exists
  addServer: (key, config) =>
    set((state) => {
      // Remove the key first if it exists to maintain insertion order
       
      const { [key]: _, ...restServers } = state.mcpServers
      const mcpServers = { [key]: config, ...restServers }
      return { mcpServers }
    }),

  // Edit an existing MCP server configuration
  editServer: (key, config) =>
    set((state) => {
      // Only proceed if the server exists
      if (!hasOwnServer(state.mcpServers, key)) return state

      const mcpServers = { ...state.mcpServers, [key]: config }
      return { mcpServers }
    }),

  // Rename a server while preserving its position
  renameServer: (oldKey, newKey, config) =>
    set((state) => {
      // Only proceed if the server exists
      if (!hasOwnServer(state.mcpServers, oldKey)) return state

      const entries = Object.entries(state.mcpServers)
      // Object.fromEntries defines own data properties even for keys such as
      // "__proto__", while preserving the existing server order.
      const mcpServers = Object.fromEntries(
        entries.map(([key, serverConfig]) =>
          key === oldKey ? [newKey, config] : [key, serverConfig]
        )
      ) as MCPServers

      return { mcpServers }
    }),
  setServers: (servers) =>
    set((state) => {
      const mcpServers = { ...state.mcpServers, ...servers }
      return { mcpServers }
    }),
  setSettings: (settings) =>
    set(() => ({
      settings: {
        ...DEFAULT_MCP_SETTINGS,
        ...settings,
      },
    })),
  updateSettings: (partial) =>
    set((state) => ({
      settings: {
        ...state.settings,
        ...partial,
      },
    })),
  // Delete an MCP server by key
  deleteServer: (key) =>
    set((state) => {
      // Create a copy of the current state
      const updatedServers = { ...state.mcpServers }

      // Delete the server if it exists
      if (hasOwnServer(updatedServers, key)) {
        delete updatedServers[key]
      }
      return {
        mcpServers: updatedServers,
        deletedServerKeys: [...state.deletedServerKeys, key],
      }
    }),
  syncServers: async () => {
    const { mcpServers, settings } = get()
    await getServiceHub().mcp().updateMCPConfig(
      JSON.stringify({
        mcpServers,
        mcpSettings: settings,
      })
    )
  },
  syncServersAndRestart: async () => {
    const { mcpServers, settings } = get()
    try {
      await getServiceHub().mcp().updateMCPConfig(
        JSON.stringify({
          mcpServers,
          mcpSettings: settings,
        })
      )
      await getServiceHub().mcp().restartMCPServers()
    } catch (error) {
      console.error('Failed to sync and restart MCP servers:', error)
      throw error
    }
  },
}))
