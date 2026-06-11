/**
 * MCP (Model Context Protocol) entities
 */

export interface MCPTool {
  name: string
  description?: string  // MCP protocol does not require a description
  inputSchema: Record<string, unknown>
  server: string
}

export interface MCPToolCallResult {
  error: string  // Always present; empty string when no error occurred
  content: Array<{
    type?: string
    text: string
  }>
}

/**
 * Props for MCP tool UI components
 */
export interface MCPToolComponentProps {
  /** List of available MCP tools */
  tools: MCPTool[]

  /** Function to check if a specific tool is currently enabled */
  isToolEnabled: (toolName: string) => boolean

  /** Function to toggle a tool's enabled/disabled state */
  onToolToggle: (toolName: string, enabled: boolean) => void
}
