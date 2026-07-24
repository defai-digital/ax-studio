/**
 * MCP Service Types
 *
 * The pure data contracts (`MCPServerConfig`, `MCPServers`, `MCPSettings`) and
 * the `DEFAULT_MCP_SETTINGS` constant live here in the service layer so lower
 * layers (services, lib) do not need to import from a UI hook. The
 * `useMCPServers` hook re-exports them for its existing call sites.
 */

import { MCPTool, MCPToolCallResult } from '@ax-studio/core'

// Define the structure of an MCP server configuration
export type MCPServerConfig = {
  command: string
  args: string[]
  env: Record<string, string>
  active?: boolean
  type?: 'stdio' | 'http' | 'sse'
  url?: string
  headers?: Record<string, string>
  timeout?: number
  official?: boolean
  managed?: boolean
  integration?: string
}

// Define the structure of all MCP servers
export type MCPServers = {
  [key: string]: MCPServerConfig
}

export type MCPSettings = {
  toolCallTimeoutSeconds: number
  baseRestartDelayMs: number
  maxRestartDelayMs: number
  backoffMultiplier: number
}

export const DEFAULT_MCP_SETTINGS: MCPSettings = {
  toolCallTimeoutSeconds: 30,
  baseRestartDelayMs: 1000,
  maxRestartDelayMs: 30000,
  backoffMultiplier: 2,
}

export interface MCPConfig {
  mcpServers?: MCPServers
  mcpSettings?: MCPSettings
}

export interface ToolCallWithCancellationResult {
  promise: Promise<MCPToolCallResult>
  cancel: () => Promise<void>
  token: string
}

export interface MCPService {
  updateMCPConfig(configs: string): Promise<void>
  restartMCPServers(): Promise<void>
  getMCPConfig(): Promise<MCPConfig>
  getTools(): Promise<MCPTool[]>
  getConnectedServers(): Promise<string[]>
  callTool(args: {
    toolName: string
    serverName?: string
    arguments: object
    retryOnTransportFailure?: boolean
  }): Promise<MCPToolCallResult>
  callToolWithCancellation(args: {
    toolName: string
    serverName?: string
    arguments: object
    cancellationToken?: string
  }): ToolCallWithCancellationResult
  cancelToolCall(cancellationToken: string): Promise<void>

  // MCP Server lifecycle management
  activateMCPServer(name: string, config: MCPServerConfig): Promise<void>
  deactivateMCPServer(name: string): Promise<void>
}
