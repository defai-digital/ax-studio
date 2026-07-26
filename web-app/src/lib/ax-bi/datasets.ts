import { readStoredAxBiMcpToken } from './token-storage'
import { getDirectAxBiClient, getElectronAxBiMcpUrl } from './direct-client'
import {
  getFirstMcpText,
  getMcpToolFailureMessage,
  isRecord,
  parseJsonMcpResult,
  type AxBiMcpResult,
} from './mcp-result'

export { DEFAULT_AX_BI_MCP_URL } from './endpoints'
export { normalizeAxBiToken } from './token-storage'

export type AxBiDataset = {
  id?: string | number
  name: string
  schema?: string
  databaseName?: string
  url?: string
}

export async function hasConfiguredAxBiMcpToken(): Promise<boolean> {
  const token = await readStoredAxBiMcpToken()
  return typeof token === 'string' && token.trim().length > 0
}

export function getConfiguredAxBiMcpUrl(): string {
  // Zero-config — the MCP URL is hidden and defaults to the local AX BI
  // stack (a dev/smoke localStorage override may point elsewhere).
  return getElectronAxBiMcpUrl()
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

function parseAxBiDatasetList(result: AxBiMcpResult): AxBiDataset[] {
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

function listDatasetsArguments(search?: string): Record<string, unknown> {
  return {
    request: {
      search: search?.trim() || undefined,
      page: 1,
      page_size: 50,
      select_columns: ['id', 'table_name', 'schema', 'database_name', 'url'],
    },
  }
}

export async function listAxBiDatasets({
  search,
}: {
  search?: string
} = {}): Promise<AxBiDataset[]> {
  // Direct SDK path over plain fetch — no MCP layer involved.
  const client = await getDirectAxBiClient()
  const result = await client.ai.callTool(
    'list_datasets',
    listDatasetsArguments(search)
  )
  return parseAxBiDatasetList(result)
}
