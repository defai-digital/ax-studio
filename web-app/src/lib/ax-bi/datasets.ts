import type { ServiceHub } from '@/services'
import type { MCPConfig } from '@/services/mcp/types'
import type { MCPServerConfig } from '@/hooks/tools/useMCPServers'
import type { MCPTool, MCPToolCallResult } from '@ax-studio/core'
import { getFirstMcpText, isRecord, parseJsonMcpResult } from './mcp-result'

const AX_BI_SERVER = 'ax-bi'

export const DEFAULT_AX_BI_MCP_URL = 'http://127.0.0.1:8088/mcp'

export type AxBiDataset = {
  id?: string | number
  name: string
  schema?: string
  databaseName?: string
  url?: string
}

function normalizeAxBiMcpUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_AX_BI_MCP_URL

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`
  const withoutTrailingSlash = withProtocol.replace(/\/+$/, '')
  return /\/mcp$/i.test(withoutTrailingSlash)
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/mcp`
}

export async function getConfiguredAxBiMcpUrl(
  serviceHub: ServiceHub
): Promise<string> {
  const config = await serviceHub.mcp().getMCPConfig().catch(() => null)
  const axBi = config?.mcpServers?.[AX_BI_SERVER]
  return normalizeAxBiMcpUrl(axBi?.url ?? DEFAULT_AX_BI_MCP_URL)
}

export async function connectAxBiMcpServer({
  serviceHub,
  url,
}: {
  serviceHub: ServiceHub
  url: string
}): Promise<string> {
  const normalizedUrl = normalizeAxBiMcpUrl(url)
  const config = await serviceHub
    .mcp()
    .getMCPConfig()
    .catch((): MCPConfig => ({}))
  const nextServer: MCPServerConfig = {
    command: '',
    args: [],
    env: {},
    type: 'http',
    url: normalizedUrl,
    active: true,
  }

  await serviceHub.mcp().updateMCPConfig(
    JSON.stringify({
      mcpServers: {
        ...(config.mcpServers ?? {}),
        [AX_BI_SERVER]: nextServer,
      },
      mcpSettings: config.mcpSettings,
    })
  )
  await serviceHub.mcp().activateMCPServer(AX_BI_SERVER, nextServer)
  return normalizedUrl
}

function axBiToolNames(tools: MCPTool[]): Set<string> {
  return new Set(
    tools
      .filter((tool) => tool.server === AX_BI_SERVER)
      .map((tool) => tool.name)
  )
}

async function callAxBiDatasetTool({
  serviceHub,
  toolName,
  arguments: toolArguments,
}: {
  serviceHub: ServiceHub
  toolName: string
  arguments: Record<string, unknown>
}): Promise<MCPToolCallResult> {
  const toolNames = axBiToolNames(await serviceHub.mcp().getTools())
  if (toolNames.has(toolName)) {
    return serviceHub.mcp().callTool({
      serverName: AX_BI_SERVER,
      toolName,
      arguments: toolArguments,
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
    })
  }

  throw new Error(
    'AX-BI MCP is connected, but the list_datasets tool is not available.'
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
  if (
    'table_name' in value ||
    'name' in value ||
    'dataset_name' in value
  ) {
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

function normalizeDatasetRecord(record: Record<string, unknown>): AxBiDataset | null {
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
  if (result.error) throw new Error(result.error)

  const parsed = parseJsonMcpResult<Record<string, unknown>>(result)
  if (!parsed) {
    const text = getFirstMcpText(result)
    throw new Error(text || 'AX-BI MCP returned no dataset list.')
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
  const result = await callAxBiDatasetTool({
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
