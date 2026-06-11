/**
 * Tauri MCP Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { MCPTool } from '@/types/mcp'
import { DEFAULT_MCP_SETTINGS } from '@/hooks/tools/useMCPServers'
import type { MCPServerConfig, MCPServers, MCPSettings } from '@/hooks/tools/useMCPServers'
import type { MCPConfig, MCPService, ToolCallWithCancellationResult } from './types'
import { mcpServersSchema, mcpSettingsSchema } from '@/schemas/mcp.schema'
import { extractErrorMessage, toError } from '@/lib/utils/error'

const getCoreApi = () => {
  if (!window.core?.api) {
    throw new Error('MCP API is unavailable')
  }

  return window.core.api
}

function getErrorMessage(error: unknown): string {
  return extractErrorMessage(error, String(error))
}

function isRecoverableMCPError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('transport closed') ||
    message.includes('connection closed') ||
    message.includes('server disconnected') ||
    message.includes('server') && message.includes('not found')
  )
}

const unavailableToolResult = (error: unknown) => ({
  error: getErrorMessage(error),
  content: [],
})

export class TauriMCPService implements MCPService {
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
    return ((await getCoreApi().getTools()) as MCPTool[]) ?? []
  }

  async getConnectedServers(): Promise<string[]> {
    return ((await getCoreApi().getConnectedServers()) as string[]) ?? []
  }

  async callTool(args: {
    toolName: string
    serverName?: string
    arguments: object
  }): Promise<{ error: string; content: { text: string }[] }> {
    const api = getCoreApi()
    try {
      return ((await api.callTool(args)) as { error: string; content: { text: string }[] }) ?? {
        error: 'MCP service unavailable',
        content: [],
      }
    } catch (error) {
      if (!isRecoverableMCPError(error)) {
        return unavailableToolResult(error)
      }

      console.warn('MCP tool call failed, restarting MCP servers and retrying once:', error)
      try {
        await api.restartMcpServers()
        return ((await api.callTool(args)) as { error: string; content: { text: string }[] }) ?? {
          error: 'MCP service unavailable after restart',
          content: [],
        }
      } catch (retryError) {
        return unavailableToolResult(retryError)
      }
    }
  }

  callToolWithCancellation(args: {
    toolName: string
    serverName?: string
    arguments: object
    cancellationToken?: string
  }): ToolCallWithCancellationResult {
    const token = args.cancellationToken ?? `tool_call_${crypto.randomUUID()}`

    // IIFE so any synchronous throw from getCoreApi() becomes a rejected promise,
    // and transport errors are recovered with the same restart+retry as callTool().
    const promise = (async () => {
      try {
        const api = getCoreApi()
        return ((await api.callTool({ ...args, cancellationToken: token })) as { error: string; content: { text: string }[] }) ?? {
          error: 'MCP service unavailable',
          content: [],
        }
      } catch (error) {
        if (!isRecoverableMCPError(error)) {
          return unavailableToolResult(error)
        }
        console.warn('MCP tool call failed, restarting MCP servers and retrying once:', error)
        try {
          const api = getCoreApi()
          await api.restartMcpServers()
          return ((await api.callTool({ ...args, cancellationToken: token })) as { error: string; content: { text: string }[] }) ?? {
            error: 'MCP service unavailable after restart',
            content: [],
          }
        } catch (retryError) {
          return unavailableToolResult(retryError)
        }
      }
    })()

    const cancel = async () => {
      try {
        await getCoreApi().cancelToolCall({ cancellationToken: token })
      } catch {
        // Token already consumed — tool completed or timed out before cancel arrived
      }
    }

    return { promise, cancel, token }
  }

  async cancelToolCall(cancellationToken: string): Promise<void> {
    await getCoreApi().cancelToolCall({ cancellationToken })
  }

  async activateMCPServer(name: string, config: MCPServerConfig): Promise<void> {
    try {
      await invoke('activate_mcp_server', { name, config })
    } catch (error) {
      console.error(`Failed to activate MCP server "${name}":`, error)
      throw toError(error, `Failed to activate MCP server "${name}"`)
    }
  }

  async deactivateMCPServer(name: string): Promise<void> {
    try {
      await invoke('deactivate_mcp_server', { name })
    } catch (error) {
      console.error(`Failed to deactivate MCP server "${name}":`, error)
      throw toError(error, `Failed to deactivate MCP server "${name}"`)
    }
  }

}
