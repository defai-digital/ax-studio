/**
 * Default MCP Service - Generic implementation with minimal returns
 */

import { MCPTool, MCPToolCallResult } from '@ax-studio/core'
import type { MCPServerConfig } from '@/hooks/tools/useMCPServers'
import type { MCPService, MCPConfig, ToolCallWithCancellationResult } from './types'

export class DefaultMCPService implements MCPService {
  async updateMCPConfig(configs: string): Promise<void> {
    // No-op - not implemented in default service
  }

  async restartMCPServers(): Promise<void> {
    // No-op
  }

  async getMCPConfig(): Promise<MCPConfig> {
    return {}
  }

  async getTools(): Promise<MCPTool[]> {
    return []
  }

  async getConnectedServers(): Promise<string[]> {
    return []
  }

  async callTool(args: { toolName: string; arguments: object }): Promise<MCPToolCallResult> {
    return {
      error: '',
      content: []
    }
  }

  callToolWithCancellation(args: {
    toolName: string
    arguments: object
    cancellationToken?: string
  }): ToolCallWithCancellationResult {
    return {
      promise: Promise.resolve({
        error: '',
        content: []
      }),
      cancel: () => Promise.resolve(),
      token: ''
    }
  }

  async cancelToolCall(cancellationToken: string): Promise<void> {
    // No-op - not implemented in default service
  }

  async activateMCPServer(name: string, config: MCPServerConfig): Promise<void> {
    // No-op - not implemented in default service
  }

  async deactivateMCPServer(name: string): Promise<void> {
    // No-op - not implemented in default service
  }

}
