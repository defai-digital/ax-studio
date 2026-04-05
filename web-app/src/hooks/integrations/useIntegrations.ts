import { create } from 'zustand'
import { DefaultIntegrationsService } from '@/services/integrations/default'
import { INTEGRATIONS, getIntegration } from '@/lib/integrations-registry'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { MCPServerConfig } from '@/hooks/tools/useMCPServers'

export type IntegrationStatus = 'idle' | 'connecting' | 'connected' | 'error'

const service = new DefaultIntegrationsService()

type IntegrationStoreState = {
  statuses: Record<string, IntegrationStatus>
  errors: Record<string, string>
  refreshStatuses: () => Promise<void>
  connect: (id: string, credentials: Record<string, string>) => Promise<void>
  connectOAuth: (id: string, credentials: Record<string, string>) => Promise<void>
  disconnect: (id: string) => Promise<void>
  testConnection: (id: string, credentials: Record<string, string>) => Promise<string>
}

export const useIntegrations = create<IntegrationStoreState>()((set) => ({
  statuses: Object.fromEntries(INTEGRATIONS.map((i) => [i.id, 'idle' as IntegrationStatus])),
  errors: {},

  refreshStatuses: async () => {
    try {
      const stored = await service.getAllStatuses()
      let connectedServers: string[] = []
      try {
        connectedServers = await getServiceHub().mcp().getConnectedServers()
      } catch {
        // MCP service may not be available
      }

      const statuses: Record<string, IntegrationStatus> = {}
      for (const integration of INTEGRATIONS) {
        const hasCredentials = stored[integration.id] ?? false
        const serverName = `integration-${integration.id}`
        const isConnected = connectedServers.includes(serverName)

        if (hasCredentials && isConnected) {
          statuses[integration.id] = 'connected'
        } else if (hasCredentials) {
          statuses[integration.id] = 'connecting'
        } else {
          statuses[integration.id] = 'idle'
        }
      }
      set({ statuses })
    } catch (error) {
      console.error('Failed to refresh integration statuses:', error)
    }
  },

  connect: async (id, credentials) => {
    const integration = getIntegration(id)
    if (!integration) throw new Error(`Unknown integration: ${id}`)

    set((state) => ({
      statuses: { ...state.statuses, [id]: 'connecting' },
      errors: { ...state.errors, [id]: '' },
    }))

    try {
      // Save credentials (currently stored as plaintext JSON via tauri-plugin-store)
      await service.saveToken(id, credentials)

      // Build the MCP server config for this integration
      const serverName = `integration-${id}`

      // PostgreSQL passes connection string as CLI arg, not env var
      const args = id === 'postgres' && credentials['POSTGRES_CONNECTION_STRING']
        ? [...integration.mcpArgs, credentials['POSTGRES_CONNECTION_STRING']]
        : [...integration.mcpArgs]

      const config: MCPServerConfig = {
        command: integration.mcpCommand,
        args,
        env: {},
        active: true,
        managed: true,
        integration: id,
      }

      // Activate the MCP server (credentials injected from storage at spawn time)
      await getServiceHub().mcp().activateMCPServer(serverName, config)

      // Persist to mcp_config.json so it survives restart
      const mcpConfig = await getServiceHub().mcp().getMCPConfig()
      const servers = mcpConfig.mcpServers ?? {}
      servers[serverName] = config
      await getServiceHub().mcp().updateMCPConfig(
        JSON.stringify({ mcpServers: servers, mcpSettings: mcpConfig.mcpSettings })
      )

      set((state) => ({
        statuses: { ...state.statuses, [id]: 'connected' },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => ({
        statuses: { ...state.statuses, [id]: 'error' },
        errors: { ...state.errors, [id]: message },
      }))
      throw error
    }
  },

  connectOAuth: async (id, credentials) => {
    const integration = getIntegration(id)
    if (!integration) throw new Error(`Unknown integration: ${id}`)

    set((state) => ({
      statuses: { ...state.statuses, [id]: 'connecting' },
      errors: { ...state.errors, [id]: '' },
    }))

    try {
      // Run the OAuth flow (blocks until user authorizes in browser)
      await service.startOAuthFlow(id, credentials)

      // Build the MCP server config for this integration
      const serverName = `integration-${id}`
      const config: MCPServerConfig = {
        command: integration.mcpCommand,
        args: integration.mcpArgs,
        env: {},
        active: true,
        managed: true,
        integration: id,
      }

      // Activate the MCP server
      await getServiceHub().mcp().activateMCPServer(serverName, config)

      // Persist to mcp_config.json so it survives restart
      const mcpConfig = await getServiceHub().mcp().getMCPConfig()
      const servers = mcpConfig.mcpServers ?? {}
      servers[serverName] = config
      await getServiceHub().mcp().updateMCPConfig(
        JSON.stringify({ mcpServers: servers, mcpSettings: mcpConfig.mcpSettings })
      )

      set((state) => ({
        statuses: { ...state.statuses, [id]: 'connected' },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => ({
        statuses: { ...state.statuses, [id]: 'error' },
        errors: { ...state.errors, [id]: message },
      }))
      throw error
    }
  },

  disconnect: async (id) => {
    const serverName = `integration-${id}`
    try {
      // Deactivate the MCP server
      await getServiceHub().mcp().deactivateMCPServer(serverName)

      // Remove from mcp_config.json
      const mcpConfig = await getServiceHub().mcp().getMCPConfig()
      const servers = { ...mcpConfig.mcpServers }
      delete servers[serverName]
      await getServiceHub().mcp().updateMCPConfig(
        JSON.stringify({ mcpServers: servers, mcpSettings: mcpConfig.mcpSettings })
      )

      // Delete credentials from storage
      await service.deleteToken(id)

      set((state) => ({
        statuses: { ...state.statuses, [id]: 'idle' },
        errors: { ...state.errors, [id]: '' },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => ({
        errors: { ...state.errors, [id]: message },
      }))
      throw error
    }
  },

  testConnection: async (id, credentials) => {
    return await service.validateToken(id, credentials)
  },
}))
