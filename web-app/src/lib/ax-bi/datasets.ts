import type { ServiceHub } from '@/services'
import type { MCPConfig } from '@/services/mcp/types'
import type { MCPServerConfig } from '@/hooks/tools/useMCPServers'
import type { MCPTool, MCPToolCallResult } from '@ax-studio/core'
import {
  readStoredAxBiMcpToken,
  storeAxBiMcpToken,
} from './token-storage'
import {
  getFirstMcpText,
  getMcpToolFailureMessage,
  isRecord,
  parseJsonMcpResult,
} from './mcp-result'
import {
  AX_BI_SERVER,
  DEFAULT_AX_BI_MCP_URL,
  normalizeAxBiMcpUrl,
} from './endpoints'

export { DEFAULT_AX_BI_MCP_URL } from './endpoints'

export type AxBiDataset = {
  id?: string | number
  name: string
  schema?: string
  databaseName?: string
  url?: string
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function normalizeAxBiToken(token: string): string {
  const normalized = token.trim()
  if (!normalized) {
    throw new Error('AX BI API key or JWT is required.')
  }
  if (containsControlCharacter(normalized)) {
    throw new Error('AX BI API key or JWT contains invalid characters.')
  }
  return normalized
}

export async function hasConfiguredAxBiMcpToken(): Promise<boolean> {
  const token = readStoredAxBiMcpToken()
  return typeof token === 'string' && token.trim().length > 0
}

function removeAuthorizationHeader(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined
  const filtered = Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => name.toLowerCase() !== 'authorization'
    )
  )
  return Object.keys(filtered).length > 0 ? filtered : undefined
}

export async function getConfiguredAxBiMcpUrl(
  serviceHub: ServiceHub
): Promise<string> {
  const config = await serviceHub
    .mcp()
    .getMCPConfig()
    .catch(() => null)
  const axBi = config?.mcpServers?.[AX_BI_SERVER]
  return normalizeAxBiMcpUrl(axBi?.url ?? DEFAULT_AX_BI_MCP_URL)
}

export async function connectAxBiMcpServer({
  serviceHub,
  url,
  token,
}: {
  serviceHub: ServiceHub
  url: string
  token?: string
}): Promise<string> {
  let authToken: string | null
  if (token !== undefined && token.trim().length > 0) {
    authToken = normalizeAxBiToken(token)
    storeAxBiMcpToken(authToken)
  } else {
    authToken = readStoredAxBiMcpToken()
  }
  if (!authToken) {
    throw new Error('AX BI API key or JWT is required.')
  }
  authToken = normalizeAxBiToken(authToken)

  const normalizedUrl = normalizeAxBiMcpUrl(url)
  const config = await serviceHub
    .mcp()
    .getMCPConfig()
    .catch((): MCPConfig => ({}))
  const existingServer = config.mcpServers?.[AX_BI_SERVER]
  const persistedServer: MCPServerConfig = {
    ...existingServer,
    command: '',
    args: [],
    env: existingServer?.env ?? {},
    type: 'http',
    url: normalizedUrl,
    headers: removeAuthorizationHeader(existingServer?.headers),
    active: true,
  }
  const runtimeServer: MCPServerConfig = {
    ...persistedServer,
    headers: {
      ...(persistedServer.headers ?? {}),
      Authorization: `Bearer ${authToken}`,
    },
  }

  await serviceHub.mcp().updateMCPConfig(
    JSON.stringify({
      mcpServers: {
        ...(config.mcpServers ?? {}),
        [AX_BI_SERVER]: persistedServer,
      },
      mcpSettings: config.mcpSettings,
    })
  )
  await serviceHub.mcp().activateMCPServer(AX_BI_SERVER, runtimeServer)
  return normalizedUrl
}

function axBiToolNames(tools: MCPTool[]): Set<string> {
  return new Set(
    tools
      .filter((tool) => tool.server === AX_BI_SERVER)
      .map((tool) => tool.name)
  )
}

export async function callAxBiMcpTool({
  serviceHub,
  toolName,
  arguments: toolArguments,
  retryOnTransportFailure = true,
}: {
  serviceHub: ServiceHub
  toolName: string
  arguments: Record<string, unknown>
  retryOnTransportFailure?: boolean
}): Promise<MCPToolCallResult> {
  const toolNames = axBiToolNames(await serviceHub.mcp().getTools())
  const retryOptions = retryOnTransportFailure
    ? {}
    : { retryOnTransportFailure: false }
  if (toolNames.has(toolName)) {
    return serviceHub.mcp().callTool({
      serverName: AX_BI_SERVER,
      toolName,
      arguments: toolArguments,
      ...retryOptions,
    })
  }

  if (toolNames.has('call_tool')) {
    return serviceHub.mcp().callTool({
      serverName: AX_BI_SERVER,
      toolName: 'call_tool',
      arguments: {
        name: toolName,
        arguments: toolArguments,
      },
      ...retryOptions,
    })
  }

  throw new Error(
    `AX BI MCP is connected, but the ${toolName} tool is not available.`
  )
}

function collectDatasetRecords(
  value: unknown,
  records: Record<string, unknown>[] = []
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) collectDatasetRecords(item, records)
    return records
  }

  if (!isRecord(value)) return records
  if ('table_name' in value || 'name' in value || 'dataset_name' in value) {
    records.push(value)
  }

  for (const child of Object.values(value)) {
    collectDatasetRecords(child, records)
  }
  return records
}

function datasetName(record: Record<string, unknown>): string | undefined {
  for (const key of ['table_name', 'name', 'dataset_name']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function normalizeDatasetRecord(
  record: Record<string, unknown>
): AxBiDataset | null {
  const name = datasetName(record)
  if (!name) return null

  return {
    id:
      typeof record.id === 'string' || typeof record.id === 'number'
        ? record.id
        : undefined,
    name,
    schema: typeof record.schema === 'string' ? record.schema : undefined,
    databaseName:
      typeof record.database_name === 'string'
        ? record.database_name
        : undefined,
    url: typeof record.url === 'string' ? record.url : undefined,
  }
}

function parseAxBiDatasetList(result: MCPToolCallResult): AxBiDataset[] {
  const failure = getMcpToolFailureMessage(result)
  if (failure) throw new Error(failure)

  const parsed = parseJsonMcpResult<Record<string, unknown>>(result)
  if (!parsed) {
    const text = getFirstMcpText(result)
    throw new Error(text || 'AX BI MCP returned no dataset list.')
  }

  const seen = new Set<string>()
  return collectDatasetRecords(parsed)
    .map(normalizeDatasetRecord)
    .filter((dataset): dataset is AxBiDataset => Boolean(dataset))
    .filter((dataset) => {
      const key =
        dataset.id != null
          ? String(dataset.id)
          : [dataset.databaseName, dataset.schema, dataset.name].join(':')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export async function listAxBiDatasets({
  serviceHub,
  search,
}: {
  serviceHub: ServiceHub
  search?: string
}): Promise<AxBiDataset[]> {
  const result = await callAxBiMcpTool({
    serviceHub,
    toolName: 'list_datasets',
    arguments: {
      request: {
        search: search?.trim() || undefined,
        page: 1,
        page_size: 50,
        select_columns: ['id', 'table_name', 'schema', 'database_name', 'url'],
      },
    },
  })
  return parseAxBiDatasetList(result)
}
