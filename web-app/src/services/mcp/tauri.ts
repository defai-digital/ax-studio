/**
 * Tauri MCP Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { MCPTool } from '@/types/completion'
import { DEFAULT_MCP_SETTINGS } from '@/features/mcp/hooks/useMCPServers'
import type { MCPServerConfig, MCPServers, MCPSettings } from '@/features/mcp/hooks/useMCPServers'
import type { MCPConfig } from './types'
import { DefaultMCPService } from './default'
import { mcpServersSchema, mcpSettingsSchema } from '@/schemas/mcp.schema'

export class TauriMCPService extends DefaultMCPService {
  async updateMCPConfig(configs: string): Promise<void> {
    await window.core?.api?.saveMcpConfigs({ configs })
  }

  async restartMCPServers(): Promise<void> {
    await window.core?.api?.restartMcpServers()
  }

  async getMCPConfig(): Promise<MCPConfig> {
    const rawConfig = await window.core?.api?.getMcpConfigs()
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
    return (await window.core?.api?.getTools()) ?? []
  }

  async getConnectedServers(): Promise<string[]> {
    return (await window.core?.api?.getConnectedServers()) ?? []
  }

  async callTool(args: {
    toolName: string
    serverName?: string
    arguments: object
  }): Promise<{ error: string; content: { text: string }[] }> {
    return (await window.core?.api?.callTool(args)) ?? { error: 'MCP service unavailable', content: [] }
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
    const token = args.cancellationToken ?? `tool_call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Create the tool call promise with cancellation token
    const promise: Promise<{ error: string; content: { text: string }[] }> =
      window.core?.api?.callTool({
        ...args,
        cancellationToken: token
      }) ?? Promise.reject(new Error('MCP service unavailable'))

    // Create cancel function
    const cancel = async () => {
      await window.core?.api?.cancelToolCall({ cancellationToken: token })
    }

    return { promise, cancel, token }
  }

  async cancelToolCall(cancellationToken: string): Promise<void> {
    return await window.core?.api?.cancelToolCall({ cancellationToken })
  }

  async activateMCPServer(name: string, config: MCPServerConfig): Promise<void> {
    return await invoke('activate_mcp_server', { name, config })
  }

  async deactivateMCPServer(name: string): Promise<void> {
    return await invoke('deactivate_mcp_server', { name })
  }

}
