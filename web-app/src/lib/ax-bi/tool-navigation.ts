import type { MCPTool } from '@/types/mcp'
import { isRecord, parseJsonMcpResult } from './mcp-result'

export type AxBiToolResult = {
  success?: boolean
  url?: string
  explore_url?: string
  dashboard_url?: string
  remote_navigation_queued?: boolean
  remote_navigation_url?: string | null
  live_update_attempted?: boolean
  live_update_command_id?: string | null
  live_update_url?: string | null
  error?: unknown
}

const AX_BI_SERVER = 'ax-bi'
const AUTO_OPEN_RESULT_TOOLS = new Set([
  'add_chart_to_existing_dashboard',
  'generate_chart',
  'generate_dashboard',
  'generate_explore_link',
  'open_sql_lab_with_context',
  'remote_navigate',
  'update_chart',
  'update_chart_preview',
])

function getSchemaProperties(schema: unknown): Record<string, unknown> | undefined {
  if (!isRecord(schema)) return undefined
  const properties = schema.properties
  return isRecord(properties) ? properties : undefined
}

function getRequestSchema(tool: MCPTool): Record<string, unknown> | undefined {
  const properties = getSchemaProperties(tool.inputSchema)
  const request = properties?.request
  return isRecord(request) ? request : undefined
}

function supportsTopLevelAutoNavigate(tool: MCPTool): boolean {
  return Boolean(getSchemaProperties(tool.inputSchema)?.auto_navigate)
}

function supportsRequestAutoNavigate(tool: MCPTool): boolean {
  return Boolean(getSchemaProperties(getRequestSchema(tool))?.auto_navigate)
}

export function findAxBiTool(tools: MCPTool[], toolName: string): MCPTool | undefined {
  return tools.find((tool) => tool.server === AX_BI_SERVER && tool.name === toolName)
}

export function withAxBiAutoNavigate(
  tools: MCPTool[],
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  const tool = findAxBiTool(tools, toolName)
  if (!tool) return input

  if (supportsRequestAutoNavigate(tool)) {
    const request = isRecord(input.request) ? input.request : {}
    return {
      ...input,
      request: {
        ...request,
        auto_navigate: true,
      },
    }
  }

  if (supportsTopLevelAutoNavigate(tool)) {
    return {
      ...input,
      auto_navigate: true,
    }
  }

  return input
}

export function parseAxBiToolResult(result: {
  content?: Array<{ text?: string }>
  structuredContent?: unknown
  structured_content?: unknown
}): AxBiToolResult | null {
  return parseJsonMcpResult<Record<string, unknown>>(result) as AxBiToolResult | null
}

export function getAxBiResultUrl(
  toolName: string,
  result: AxBiToolResult
): string | undefined {
  if (!AUTO_OPEN_RESULT_TOOLS.has(toolName)) return undefined
  return result.explore_url ?? result.dashboard_url ?? result.url ?? undefined
}

export function didAxBiQueueLiveUpdate(result: AxBiToolResult): boolean {
  return Boolean(
    result.remote_navigation_queued === true ||
      result.live_update_command_id
  )
}
