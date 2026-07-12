/**
 * Tauri MCP Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { MCPTool } from '@/types/mcp'
import { DEFAULT_MCP_SETTINGS } from '@/hooks/tools/useMCPServers'
import type { MCPServerConfig, MCPServers, MCPSettings } from '@/hooks/tools/useMCPServers'
import type { MCPConfig, MCPService, ToolCallWithCancellationResult } from './types'
import {
  mcpSettingsSchema,
  parseMcpServersRecord,
} from '@/schemas/mcp.schema'
import { extractErrorMessage, toError } from '@/lib/utils/error'

const DEFAULT_UNAVAILABLE_TOOL_ERROR = 'MCP service unavailable'
const DEFAULT_UNAVAILABLE_TOOL_ERROR_AFTER_RESTART =
  'MCP service unavailable after restart'

type MCPToolCallResult = Awaited<ReturnType<MCPService['callTool']>>

type MCPNativeApi = {
  callTool(args: {
    toolName: string
    serverName?: string
    arguments: object
    cancellationToken?: string
  }): Promise<MCPToolCallResult | null | undefined>
  cancelToolCall(args: { cancellationToken: string }): Promise<void>
  getConnectedServers(): Promise<string[] | null | undefined>
  getMcpConfigs(): Promise<string | null | undefined>
  getTools(): Promise<MCPTool[] | null | undefined>
  restartMcpServers(): Promise<void>
  saveMcpConfigs(args: { configs: string }): Promise<void>
}

function createUnavailableToolResult(errorMessage: string): MCPToolCallResult {
  return {
    error: errorMessage,
    content: [],
  }
}

const getCoreApi = (): MCPNativeApi => {
  if (!window.core?.api) {
    throw new Error('MCP API is unavailable')
  }

  return window.core.api as unknown as MCPNativeApi
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

const fallbackToolCallResult = (error: unknown): MCPToolCallResult => ({
  error: getErrorMessage(error),
  content: [],
})

function createToolCall(
  api: ReturnType<typeof getCoreApi>,
  args: {
    toolName: string
    serverName?: string
    arguments: object
    cancellationToken?: string
  },
  unavailableMessage: string
): () => Promise<MCPToolCallResult> {
  return () =>
    api.callTool(args).then((result) => result ?? createUnavailableToolResult(unavailableMessage))
}

async function executeToolCallWithRetry<T>(
  call: () => Promise<T>,
  retry: () => Promise<T>,
  fallback: (error: unknown) => T
): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (!isRecoverableMCPError(error)) {
      return fallback(error)
    }

    console.warn('MCP tool call failed, restarting MCP servers and retrying once:', error)
    try {
      const api = getCoreApi()
      await api.restartMcpServers()
      return await retry()
    } catch (retryError) {
      return fallback(retryError)
    }
  }
}

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

    // Parse entry-by-entry so one invalid server cannot wipe valid siblings.
    // Prefer explicit mcpServers; fall back to legacy top-level keys.
    let normalizedServers: MCPServers = parseMcpServersRecord(mcpServers)
    if (
      Object.keys(normalizedServers).length === 0 &&
      hasLegacyServers
    ) {
      normalizedServers = parseMcpServersRecord(legacyServers)
    }

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

    return executeToolCallWithRetry(
      () => createToolCall(api, args, DEFAULT_UNAVAILABLE_TOOL_ERROR)(),
      () => createToolCall(api, args, DEFAULT_UNAVAILABLE_TOOL_ERROR_AFTER_RESTART)(),
      fallbackToolCallResult
    )
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
      return executeToolCallWithRetry(
        () =>
          createToolCall(
            getCoreApi(),
            { ...args, cancellationToken: token },
            DEFAULT_UNAVAILABLE_TOOL_ERROR
          )(),
        () =>
          createToolCall(
            getCoreApi(),
            { ...args, cancellationToken: token },
            DEFAULT_UNAVAILABLE_TOOL_ERROR_AFTER_RESTART
          )(),
        fallbackToolCallResult
      )
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
