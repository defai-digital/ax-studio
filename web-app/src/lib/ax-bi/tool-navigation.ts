import type { MCPTool } from '@/types/mcp'

export type AxBiToolResult = {
  success?: boolean
  url?: string
  explore_url?: string
  dashboard_url?: string
  remote_navigation_queued?: boolean
  live_update_command_id?: string
  error?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseAxBiToolResult(result: {
  content?: Array<{ text?: string }>
  structuredContent?: unknown
  structured_content?: unknown
}): AxBiToolResult | null {
  const structuredContent =
    result.structuredContent ?? result.structured_content
  if (isRecord(structuredContent)) return structuredContent as AxBiToolResult

  const content = result.content ?? []
  for (const item of content) {
    if (typeof item.text !== 'string') continue
    try {
      const parsed = JSON.parse(item.text)
      if (isRecord(parsed)) {
        return parsed as AxBiToolResult
      }
    } catch {
      // MCP text content may be plain prose. Keep scanning for structured JSON.
    }
  }
  return null
}

export function getAxBiResultUrl(
  toolName: string,
  result: AxBiToolResult
): string | undefined {
  const AUTO_OPEN_RESULT_TOOLS = new Set([
    'generate_chart',
    'generate_dashboard',
    'create_chart_from_intent',
  ])
  if (!AUTO_OPEN_RESULT_TOOLS.has(toolName)) return undefined
  return result.explore_url ?? result.dashboard_url ?? result.url ?? undefined
}

export function didAxBiQueueLiveUpdate(result: AxBiToolResult): boolean {
  return Boolean(
    result.remote_navigation_queued === true ||
      result.live_update_command_id
  )
}

export function withAxBiAutoNavigate<T extends Record<string, unknown>>(
  tools: MCPTool[],
  toolName: string,
  input: T
): T {
  const AUTO_OPEN_RESULT_TOOLS = new Set([
    'generate_chart',
    'generate_dashboard',
    'create_chart_from_intent',
  ])
  if (!AUTO_OPEN_RESULT_TOOLS.has(toolName)) return input

  const tool = tools.find((t) => t.name === toolName)
  if (!tool) return input

  const schema = tool.inputSchema as Record<string, unknown>
  const properties = (schema.properties ?? {}) as Record<string, unknown>
  if (!('auto_open' in properties)) {
    ;(schema.properties as Record<string, unknown>).auto_open = {
      type: 'boolean',
      description: 'Automatically open the result URL in AX-BI',
    }
  }

  const inputCopy = { ...input }
  if (inputCopy.request && isRecord(inputCopy.request)) {
    ;(inputCopy.request as Record<string, unknown>).auto_open = true
  }

  return inputCopy
}
