import type { MCPTool } from '@/types/mcp'
import { AX_BI_SERVER, DEFAULT_AX_BI_WEB_URL } from './endpoints'
import { parseJsonMcpResult } from './mcp-result'

export type AxBiToolResult = {
  success?: boolean
  url?: string
  explore_url?: string
  dashboard_url?: string
  preview_url?: string
  error?: unknown
}

const AUTO_OPEN_RESULT_TOOLS = new Set([
  'add_chart_to_existing_dashboard',
  'add_dashboard_filter',
  'compose_dashboard',
  'create_chart_from_intent',
  'generate_chart',
  'generate_dashboard',
  'generate_explore_link',
  'open_sql_lab_with_context',
  'prompt_to_dashboard',
  'update_chart',
  'update_chart_preview',
  'update_dashboard',
])

export function findAxBiTool(
  tools: MCPTool[],
  toolName: string
): MCPTool | undefined {
  return tools.find(
    (tool) => tool.server === AX_BI_SERVER && tool.name === toolName
  )
}

export function parseAxBiToolResult(result: {
  content?: Array<{ text?: string }>
  structuredContent?: unknown
  structured_content?: unknown
}): AxBiToolResult | null {
  return parseJsonMcpResult<Record<string, unknown>>(
    result
  ) as AxBiToolResult | null
}

function isTrustedAxBiHostname(hostname: string): boolean {
  // URL.hostname may be `::1` or bracketed `[::1]` depending on runtime.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  // Treat IPv6 loopback the same as 127.0.0.1 / localhost.
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return true
  }
  try {
    const defaultHost = new URL(DEFAULT_AX_BI_WEB_URL).hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
    return host === defaultHost
  } catch {
    return false
  }
}

export function normalizeAxBiResultUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  // Protocol-relative URLs (`//evil.example/...`) resolve against the default
  // BI base and become absolute attacker hosts while still passing http(s).
  if (trimmed.startsWith('//')) return undefined

  let url: URL
  try {
    url = new URL(trimmed, DEFAULT_AX_BI_WEB_URL)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  // Auto-open only trusted local/default BI hosts — absolute https://evil/… must not open.
  if (!isTrustedAxBiHostname(url.hostname)) return undefined

  if (/^\/superset\/dashboard(?:\/|$)/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(
      /^\/superset\/dashboard/i,
      '/ax-bi/dashboard'
    )
  } else if (/^\/dashboard(?:\/|$)/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/^\/dashboard/i, '/ax-bi/dashboard')
  } else if (/^\/superset\/explore(?:\/|$)/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/^\/superset\/explore/i, '/explore')
  }

  return url.toString()
}

export function getAxBiResultUrl(
  toolName: string,
  result: AxBiToolResult
): string | undefined {
  if (!AUTO_OPEN_RESULT_TOOLS.has(toolName)) return undefined
  const resultUrl =
    result.explore_url ??
    result.dashboard_url ??
    result.preview_url ??
    result.url
  return resultUrl ? normalizeAxBiResultUrl(resultUrl) : undefined
}
