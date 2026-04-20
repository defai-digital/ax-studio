/**
 * Tauri MCP Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { MCPTool } from '@/types/completion'
import { DEFAULT_MCP_SETTINGS } from '@/hooks/tools/useMCPServers'
import type { MCPServerConfig, MCPServers, MCPSettings } from '@/hooks/tools/useMCPServers'
import type { MCPConfig } from './types'
import { DefaultMCPService } from './default'
import { mcpServersSchema, mcpSettingsSchema } from '@/schemas/mcp.schema'

const getCoreApi = () => {
  if (!window.core?.api) {
    throw new Error('MCP API is unavailable')
  }

  return window.core.api
}

export class TauriMCPService extends DefaultMCPService {
  async updateMCPConfig(configs: string): Promise<void> {
    await getCoreApi().saveMcpConfigs({ configs })
  }

  async restartMCPServers(): Promise<void> {
    await getCoreApi().restartMcpServers()
  }

  async getMCPConfig(): Promise<MCPConfig> {
    const rawConfig = await getCoreApi().getMcpConfigs()
    const configString = typeof rawConfig === 'string' ? rawConfig.trim() : ''

    const defaultResponse = (): MCPConfig => ({
      mcpServers: {},
      mcpSettings: { ...DEFAULT_MCP_SETTINGS },
    })

    if (!configString) {
      return defaultResponse()
    }

    let parsed: MCPConfig & Record<string, unknown>
    try {
      parsed = JSON.parse(configString) as MCPConfig & Record<string, unknown>
    } catch {
      console.error('Failed to parse MCP config JSON:', configString)
      return defaultResponse()
    }

    if (!parsed || typeof parsed !== 'object') {
      return defaultResponse()
    }

    const { mcpServers, mcpSettings, ...legacyServers } = parsed
    const hasLegacyServers = Object.keys(legacyServers).length > 0

    // Try the explicit mcpServers field first, fall back to legacy top-level keys
    let serversParsed = mcpServersSchema.safeParse(mcpServers)
    if (!serversParsed.success && hasLegacyServers) {
      serversParsed = mcpServersSchema.safeParse(legacyServers)
    }
    if (!serversParsed.success) {
      console.warn('MCP servers config did not match expected schema:', serversParsed.error.message)
    }
    const normalizedServers: MCPServers = (serversParsed.success ? serversParsed.data : {}) as MCPServers

    const settingsParsed = mcpSettingsSchema.safeParse(mcpSettings)
    const normalizedSettings: MCPSettings = {
      ...DEFAULT_MCP_SETTINGS,
      ...(settingsParsed.success ? settingsParsed.data : {}),
    }

    return {
      mcpServers: normalizedServers,
      mcpSettings: normalizedSettings,
    }
  }

  async getTools(): Promise<MCPTool[]> {
    return (await getCoreApi().getTools()) ?? []
  }

  async getConnectedServers(): Promise<string[]> {
    return (await getCoreApi().getConnectedServers()) ?? []
  }

  async callTool(args: {
    toolName: string
    serverName?: string
    arguments: object
  }): Promise<{ error: string; content: { text: string }[] }> {
    return (await getCoreApi().callTool(args)) ?? {
      error: 'MCP service unavailable',
      content: [],
    }
  }

  callToolWithCancellation(args: {
    toolName: string
    serverName?: string
    arguments: object
    cancellationToken?: string
  }): {
    promise: Promise<{ error: string; content: { text: string }[] }>
    cancel: () => Promise<void>
    token: string
  } {
    // Generate a unique cancellation token if not provided
    const token = args.cancellationToken ?? `tool_call_${crypto.randomUUID()}`

    // Create the tool call promise with cancellation token
    const promise: Promise<{ error: string; content: { text: string }[] }> =
      getCoreApi().callTool({
        ...args,
        cancellationToken: token
      }) ?? Promise.reject(new Error('MCP service unavailable'))

    // Create cancel function
  const cancel = async () => {
      await getCoreApi().cancelToolCall({ cancellationToken: token })
    }

    return { promise, cancel, token }
  }

  async cancelToolCall(cancellationToken: string): Promise<void> {
    return await getCoreApi().cancelToolCall({ cancellationToken })
  }

  async activateMCPServer(name: string, config: MCPServerConfig): Promise<void> {
    try {
      await invoke('activate_mcp_server', { name, config })
    } catch (error) {
      console.error(`Failed to activate MCP server "${name}":`, error)
      throw error instanceof Error
        ? error
        : new Error(`Failed to activate MCP server "${name}"`)
    }
  }

  async deactivateMCPServer(name: string): Promise<void> {
    try {
      await invoke('deactivate_mcp_server', { name })
    } catch (error) {
      console.error(`Failed to deactivate MCP server "${name}":`, error)
      throw error instanceof Error
        ? error
        : new Error(`Failed to deactivate MCP server "${name}"`)
    }
  }

}
