type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: Record<string, unknown>
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string; result: unknown }
  | {
      jsonrpc: '2.0'
      id: string
      error: { code: number; message: string; data?: unknown }
    }

export type AxBIAuthConfig =
  | { type: 'token'; accessToken: string }
  | {
      type: 'apiKey'
      apiKey: string
      headerName?: string
      headerPrefix?: string
    }

export type AxBIConfig = {
  baseUrl: string
  mcpUrl?: string
  auth?: AxBIAuthConfig
  timeout?: number
}

export type MCPToolResult = {
  content?: Array<{ type?: string; text?: string; data?: unknown }>
  isError?: boolean
  structuredContent?: unknown
  structured_content?: unknown
}

export type DashboardPlan = {
  title: string
  description?: string
  sections: Array<{
    title: string
    chart_intents: Array<{
      metric: string
      dimension?: string
      chart_type: string
    }>
  }>
  global_filters?: Record<string, unknown>
  clarifying_questions?: string[]
  assumptions?: string[]
  confidence_score?: number
}

class AxBIAuthProvider {
  constructor(private readonly auth?: AxBIAuthConfig) {}

  headers(): Record<string, string> {
    if (!this.auth) return {}
    if (this.auth.type === 'token') {
      return this.auth.accessToken
        ? { Authorization: `Bearer ${this.auth.accessToken}` }
        : {}
    }

    const headerName = this.auth.headerName ?? 'Authorization'
    const prefix = this.auth.headerPrefix ?? 'Bearer '
    return this.auth.apiKey
      ? { [headerName]: `${prefix}${this.auth.apiKey}` }
      : {}
  }
}

class MCPClient {
  private requestId = 0
  private sessionId: string | null = null
  private initialized = false

  constructor(
    private readonly mcpUrl: string,
    private readonly auth: AxBIAuthProvider,
    private readonly timeout = 60_000
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.sendRequest({
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: '@ax-studio/web-app',
          version: '1.0.0',
        },
      },
    })
    await this.sendNotification('notifications/initialized')
    this.initialized = true
  }

  async callTool<T = MCPToolResult>(
    name: string,
    args?: Record<string, unknown>
  ): Promise<T> {
    await this.initialize()
    return this.sendRequest<T>({
      method: 'tools/call',
      params: { name, arguments: args ?? {} },
    })
  }

  private async sendRequest<T>(
    request: Omit<JsonRpcRequest, 'jsonrpc' | 'id'>
  ): Promise<T> {
    const id = String(++this.requestId)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...this.auth.headers(),
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId

    const response = await fetch(`${this.mcpUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, ...request }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`AX-BI MCP request failed (${response.status}): ${text}`)
    }

    const sessionId = response.headers.get('mcp-session-id')
    if (sessionId) this.sessionId = sessionId

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('text/event-stream')) {
      return this.parseSseResponse<T>(await response.text(), id)
    }

    return this.extractResult<T>((await response.json()) as JsonRpcResponse, id)
  }

  private async sendNotification(method: string): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.auth.headers(),
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId

    await fetch(`${this.mcpUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined)
  }

  private parseSseResponse<T>(text: string, expectedId: string): T {
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      try {
        const parsed = JSON.parse(data) as JsonRpcResponse
        if ('id' in parsed && parsed.id === expectedId) {
          return this.extractResult<T>(parsed, expectedId)
        }
      } catch {
        // Ignore non-JSON SSE payloads.
      }
    }
    throw new Error('AX-BI MCP returned no JSON-RPC response')
  }

  private extractResult<T>(response: JsonRpcResponse, expectedId: string): T {
    if ('error' in response) {
      throw new Error(response.error.message)
    }
    if (response.id !== expectedId) {
      throw new Error(
        `AX-BI MCP returned response id ${response.id}; expected ${expectedId}`
      )
    }
    return response.result as T
  }
}

class AIResource {
  constructor(private readonly mcp: MCPClient) {}

  async planDashboard(params: {
    prompt: string
    dataset_candidates?: number[]
    constraints?: Record<string, unknown>
  }): Promise<DashboardPlan> {
    return this.callMcpTool<DashboardPlan>('plan_dashboard', {
      prompt: params.prompt,
      dataset_candidates: params.dataset_candidates ?? [],
      constraints: params.constraints ?? {},
    })
  }

  async callTool<T = MCPToolResult>(
    name: string,
    args?: Record<string, unknown>
  ): Promise<T> {
    return this.mcp.callTool<T>(name, args)
  }

  private async callMcpTool<T>(
    name: string,
    args: Record<string, unknown>
  ): Promise<T> {
    const result = await this.mcp.callTool<MCPToolResult>(name, args)
    if (result.isError) {
      const message = result.content?.find((item) => item.text)?.text
      throw new Error(message ?? `AX-BI MCP tool "${name}" failed`)
    }

    const structured = result.structuredContent ?? result.structured_content
    if (structured && typeof structured === 'object') return structured as T

    const text = result.content?.find((item) => item.text)?.text
    if (text) {
      try {
        return JSON.parse(text) as T
      } catch {
        return text as T
      }
    }

    throw new Error(`AX-BI MCP tool "${name}" returned no content`)
  }
}

export class AxBI {
  readonly ai: AIResource

  constructor(config: AxBIConfig) {
    const baseUrl = config.baseUrl.replace(/\/+$/, '')
    const mcpUrl = (config.mcpUrl ?? baseUrl)
      .replace(/\/+$/, '')
      .replace(/\/mcp$/, '')
    this.ai = new AIResource(
      new MCPClient(
        mcpUrl,
        new AxBIAuthProvider(config.auth),
        config.timeout ?? 60_000
      )
    )
  }
}
