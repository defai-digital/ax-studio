import { net } from 'electron'
import { str } from './args.js'
import type { CommandHandler } from './registry.js'
import { getStoredSecret } from './secrets.js'

type Args = Record<string, unknown>

const AX_BI_MCP_TOKEN_SECRET = 'ax-bi-mcp-token'
const DEFAULT_TIMEOUT_MS = 60_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 120_000

type FetchResponse = {
  ok: boolean
  status: number
  statusText: string
  headers: { get: (name: string) => string | null }
  text: () => Promise<string>
}

type FetchMcp = (
  input: string,
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
    redirect: 'error'
    signal: AbortSignal
  }
) => Promise<FetchResponse>

export type AxBiCommandDependencies = {
  fetchMcp: FetchMcp
  getToken: () => string | null
}

export type AxBiMcpResponse = {
  ok: boolean
  status: number
  statusText: string
  contentType: string | null
  sessionId: string | null
  body: string
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function normalizeToken(token: string | null): string {
  let normalized = token?.trim() ?? ''
  if (/^bearer\s+/i.test(normalized)) {
    normalized = normalized.replace(/^bearer\s+/i, '').trim()
  }
  if (!normalized) {
    throw new Error('AX BI API key or JWT is required.')
  }
  if (containsControlCharacter(normalized)) {
    throw new Error('AX BI API key or JWT contains invalid characters.')
  }
  return normalized
}

/**
 * The renderer may only ask the main process to contact a local MCP endpoint.
 * Restricting the protocol, host, path, and redirects prevents this credential
 * broker from becoming a general authenticated request primitive.
 */
export function validateAxBiMcpUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('AX BI MCP URL is required.')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('AX BI MCP URL is invalid.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('AX BI MCP URL must use HTTP or HTTPS.')
  }
  const hostname = url.hostname.toLowerCase()
  if (
    hostname !== '127.0.0.1' &&
    hostname !== 'localhost' &&
    hostname !== '[::1]'
  ) {
    throw new Error('AX BI MCP URL must use a loopback address.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'AX BI MCP URL cannot contain credentials, a query, or a fragment.'
    )
  }
  if (url.pathname !== '/mcp' && url.pathname !== '/mcp/') {
    throw new Error('AX BI MCP URL path must be /mcp.')
  }
  return url.toString()
}

function timeoutMs(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_TIMEOUT_MS ||
    value > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `AX BI MCP timeout must be an integer from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS} milliseconds.`
    )
  }
  return value
}

function optionalSessionId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (
    typeof value !== 'string' ||
    containsControlCharacter(value) ||
    value.length > 1024
  ) {
    throw new Error('AX BI MCP session ID is invalid.')
  }
  return value
}

function requestBody(args: Args | undefined): string {
  const body = str(args?.body)
  if (!body) throw new Error('AX BI MCP request body is required.')
  try {
    JSON.parse(body)
  } catch {
    throw new Error('AX BI MCP request body must be valid JSON.')
  }
  return body
}

export function createAxBiHandlers(
  dependencies: AxBiCommandDependencies = {
    fetchMcp: net.fetch,
    getToken: () => getStoredSecret(AX_BI_MCP_TOKEN_SECRET),
  }
): Record<string, CommandHandler> {
  return {
    ax_bi_mcp_request: async (args) => {
      const url = validateAxBiMcpUrl(args?.url)
      const token = normalizeToken(dependencies.getToken())
      const sessionId = optionalSessionId(args?.sessionId)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      }
      if (sessionId) headers['Mcp-Session-Id'] = sessionId

      const response = await dependencies.fetchMcp(url, {
        method: 'POST',
        headers,
        body: requestBody(args),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs(args?.timeoutMs)),
      })

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        sessionId: response.headers.get('mcp-session-id'),
        body: await response.text(),
      } satisfies AxBiMcpResponse
    },
  }
}
