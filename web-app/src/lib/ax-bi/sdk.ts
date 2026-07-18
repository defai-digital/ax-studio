import { normalizeAxBiMcpUrl } from './endpoints'

type JsonRpcId = string | number

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: Record<string, unknown>
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | {
      jsonrpc: '2.0'
      id: JsonRpcId
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
  plan_id: string
  title: string
  description?: string
  datasets?: Array<Record<string, unknown>>
  sections: Array<{
    title: string
    chart_intents: Array<Record<string, unknown>>
  }>
  chart_intents?: Array<Record<string, unknown>>
  global_filters?: Array<Record<string, unknown>>
  layout_hints?: Record<string, unknown>
  clarifying_questions?: string[]
  assumptions?: string[]
  confidence?: number
}

export type DashboardPlanEnvelope = {
  plan: DashboardPlan
  warnings: string[]
}

export type WorkflowStepStatus = {
  name: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  detail?: string
  duration_ms?: number
}

export type PromptToDashboardResult = {
  dashboard?: Record<string, unknown> | null
  dashboard_url?: string | null
  plan?: DashboardPlan | null
  charts?: Array<{
    chart_id?: number | null
    chart_name?: string
    chart_type?: string
    purpose?: string
    confidence?: number
    preview_url?: string | null
    warnings?: string[]
  }>
  layout_summary?: string
  lineage?: Record<string, unknown> | null
  warnings?: string[]
  error?: string | null
  total_duration_ms?: number
  status?: 'completed' | 'partial' | 'blocked' | 'failed' | 'dry_run'
  steps?: WorkflowStepStatus[]
  charts_succeeded?: number
  charts_failed?: number
}

export type CreateChartFromIntentResult = {
  chart?: Record<string, unknown> | null
  chart_name?: string
  form_data?: Record<string, unknown> | null
  success?: boolean
  dataset_used?: Record<string, unknown> | null
  chart_type_selected?: string
  explanation?: string
  confidence?: number
  warnings?: string[]
  preview_url?: string | null
  alternatives?: string[]
}

export type UploadAndPlanResult = {
  dataset?: Record<string, unknown>
  plan?: DashboardPlan | null
  warnings?: string[]
  next_steps?: string
}

export type AuthoringCapabilities = {
  contract_version: '1.0'
  operations: Array<
    | 'plan_dashboard'
    | 'create_chart_from_intent'
    | 'prompt_to_dashboard'
    | 'upload_and_plan'
  >
  deployment_operations?: Array<
    | 'plan_dashboard'
    | 'create_chart_from_intent'
    | 'prompt_to_dashboard'
    | 'upload_and_plan'
  >
  artifact_types: Array<'chart' | 'dashboard'>
  preview_before_save: boolean
  upload_formats: Array<'csv' | 'tsv' | 'xls' | 'xlsx' | 'parquet'>
  limits: {
    max_charts_per_dashboard: number
    max_upload_bytes?: number | null
  }
  async_jobs: boolean
  llm_configured: boolean
  llm_provider_type?: string | null
  llm_model?: string | null
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

/** Streamable HTTP requires both MIME types on every POST, including notifications. */
const MCP_ACCEPT = 'application/json, text/event-stream'

function sameJsonRpcId(actual: unknown, expected: string): boolean {
  // MCP allows id as string | number; coerce so SSE/JSON responses match.
  return String(actual) === expected
}

class MCPClient {
  private requestId = 0
  private sessionId: string | null = null
  private initialized = false
  private initialization: Promise<void> | null = null

  constructor(
    private readonly mcpEndpoint: string,
    private readonly auth: AxBIAuthProvider,
    private readonly timeout = 60_000
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (!this.initialization) {
      this.initialization = this.startInitialization().finally(() => {
        this.initialization = null
      })
    }
    await this.initialization
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

  private async startInitialization(): Promise<void> {
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

  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: MCP_ACCEPT,
      ...this.auth.headers(),
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    return headers
  }

  private async sendRequest<T>(
    request: Omit<JsonRpcRequest, 'jsonrpc' | 'id'>
  ): Promise<T> {
    const id = String(++this.requestId)

    const response = await fetch(this.mcpEndpoint, {
      method: 'POST',
      headers: this.baseHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', id, ...request }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`AX BI MCP request failed (${response.status}): ${text}`)
    }

    const sessionId = response.headers.get('mcp-session-id')
    if (sessionId) this.sessionId = sessionId

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (contentType.includes('text/event-stream')) {
      return this.parseSseResponse<T>(await response.text(), id)
    }

    return this.extractResult<T>((await response.json()) as JsonRpcResponse, id)
  }

  private async sendNotification(method: string): Promise<void> {
    // FastMCP streamable-HTTP rejects POSTs without Accept (HTTP 406).
    const response = await fetch(this.mcpEndpoint, {
      method: 'POST',
      headers: this.baseHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', method }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `AX BI MCP notification failed (${response.status}): ${text}`
      )
    }
  }

  private parseSseResponse<T>(text: string, expectedId: string): T {
    const events = text.split(/\r?\n\r?\n/)
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const data = events[i]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n')
        .trim()
      if (!data) continue
      try {
        const parsed = JSON.parse(data) as JsonRpcResponse
        if ('id' in parsed && sameJsonRpcId(parsed.id, expectedId)) {
          return this.extractResult<T>(parsed, expectedId)
        }
      } catch {
        continue
      }
    }
    throw new Error('AX BI MCP returned no JSON-RPC response')
  }

  private extractResult<T>(response: JsonRpcResponse, expectedId: string): T {
    if ('error' in response) {
      throw new Error(response.error.message)
    }
    if (!sameJsonRpcId(response.id, expectedId)) {
      throw new Error(
        `AX BI MCP returned response id ${String(response.id)}; expected ${expectedId}`
      )
    }
    return response.result as T
  }
}

export class AIResource {
  constructor(private readonly mcp: MCPClient) {}

  async getAuthoringCapabilities(): Promise<AuthoringCapabilities> {
    const result = await this.mcp.callTool<unknown>(
      'get_authoring_capabilities'
    )
    return this.parseMcpToolResult<AuthoringCapabilities>(
      'get_authoring_capabilities',
      result
    )
  }

  async planDashboard(params: {
    prompt: string
    dataset_candidates?: number[]
    constraints?: Record<string, unknown>
  }): Promise<DashboardPlanEnvelope> {
    return this.callMcpTool<DashboardPlanEnvelope>('plan_dashboard', {
      prompt: params.prompt,
      dataset_candidates: params.dataset_candidates ?? [],
      constraints: params.constraints ?? {},
    })
  }

  async promptToDashboard(params: {
    prompt: string
    dataset_ids?: number[]
    plan?: DashboardPlan
    max_charts?: number
    draft?: boolean
    save_charts?: boolean
    dry_run?: boolean
    min_confidence?: number
    force?: boolean
  }): Promise<PromptToDashboardResult> {
    return this.callMcpTool<PromptToDashboardResult>('prompt_to_dashboard', {
          prompt: params.prompt,
          dataset_ids: params.dataset_ids ?? [],
          plan: params.plan,
      max_charts: params.max_charts ?? 6,
      draft: params.draft ?? true,
      save_charts: params.save_charts ?? true,
      dry_run: params.dry_run ?? false,
      min_confidence: params.min_confidence ?? 0.25,
      force: params.force ?? false,
    })
  }

  async createChartFromIntent(params: {
    prompt: string
    dataset_id?: number | string
    save_chart?: boolean
    max_preview_rows?: number
  }): Promise<CreateChartFromIntentResult> {
    return this.callMcpTool<CreateChartFromIntentResult>(
      'create_chart_from_intent',
      {
        prompt: params.prompt,
        ...(params.dataset_id == null
          ? {}
          : { dataset_id: params.dataset_id }),
        save_chart: params.save_chart ?? true,
        max_preview_rows: params.max_preview_rows ?? 100,
      }
    )
  }

  async uploadAndPlan(params: {
    file_content: string
    filename: string
    prompt: string
    table_name?: string
    sheet_name?: string
    max_charts?: number
  }): Promise<UploadAndPlanResult> {
    return this.callMcpTool<UploadAndPlanResult>('upload_and_plan', {
      file_content: params.file_content,
      filename: params.filename,
      prompt: params.prompt,
      ...(params.table_name ? { table_name: params.table_name } : {}),
      ...(params.sheet_name ? { sheet_name: params.sheet_name } : {}),
      max_charts: params.max_charts ?? 6,
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
    const result = await this.mcp.callTool<unknown>(name, { request: args })
    return this.parseMcpToolResult<T>(name, result)
  }

  private parseMcpToolResult<T>(name: string, result: unknown): T {
    if (!isRecord(result)) {
      throw new Error(`AX BI MCP tool "${name}" returned a malformed result`)
    }
    // MCP CallToolResult uses isError (camel) or is_error (snake); either is failure.
    if (result.isError === true || result.is_error === true) {
      const content = Array.isArray(result.content) ? result.content : []
      const message = content.find(
        (item) => isRecord(item) && typeof item.text === 'string'
      )?.text
      throw new Error(
        typeof message === 'string'
          ? message
          : `AX BI MCP tool "${name}" failed`
      )
    }

    const structured = result.structuredContent ?? result.structured_content
    if (structured !== undefined) {
      if (!isRecord(structured)) {
        throw new Error(
          `AX BI MCP tool "${name}" returned malformed structured content`
        )
      }
      return structured as T
    }

    if (result.content !== undefined && !Array.isArray(result.content)) {
      throw new Error(`AX BI MCP tool "${name}" returned malformed content`)
    }
    const text = result.content?.find(
      (item) => isRecord(item) && item.type === 'text'
    )?.text
    if (typeof text === 'string') {
      try {
        return JSON.parse(text) as T
      } catch {
        throw new Error(`AX BI MCP tool "${name}" returned malformed JSON`)
      }
    }

    throw new Error(`AX BI MCP tool "${name}" returned no content`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Derive an MCP endpoint from the AX BI web base URL.
 * Local web (8088 / default port) maps to MCP on 5008; remote hosts keep their
 * port and rely on reverse-proxy `/mcp` routing (normalized next).
 */
function deriveMcpUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const isLocal =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (isLocal && (url.port === '8088' || url.port === '')) {
    url.port = '5008'
  }
  return url.toString()
}

export class AxBI {
  readonly ai: AIResource

  constructor(config: AxBIConfig) {
    const mcpEndpoint = normalizeAxBiMcpUrl(
      config.mcpUrl ?? deriveMcpUrl(config.baseUrl)
    )
    this.ai = new AIResource(
      new MCPClient(
        mcpEndpoint,
        new AxBIAuthProvider(config.auth),
        config.timeout ?? 60_000
      )
    )
  }
}
