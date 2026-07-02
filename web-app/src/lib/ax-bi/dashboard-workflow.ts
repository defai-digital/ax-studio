import { fs } from '@ax-studio/core'
import type { ServiceHub } from '@/services'
import type { Attachment } from '@/types/attachment'
import type { MCPTool, MCPToolCallResult } from '@ax-studio/core'
import { parseAxBiToolResult } from './tool-navigation'

const AX_BI_SERVER = 'ax-bi'
const SUPPORTED_DATA_TYPES = new Set(['csv', 'tsv', 'txt', 'xls', 'xlsx', 'parquet'])
const PRESENTATION_TYPES = new Set(['ppt', 'pptx'])

const DASHBOARD_INTENT =
  /\b(ax-?bi|dashboard|chart|charts|visuali[sz]e|graph|graphs|report|bi)\b/i
const ATTACHED_FILE_INTENT =
  /\b(this|attached|uploaded|selected|current)\s+(file|csv|excel|spreadsheet|workbook|dataset|data)\b|\bfrom\s+(this|the)\s+(file|attachment|uploaded\s+file|selected\s+file)\b|\bfrom\s+the\s+attached\b/i

type DatasetColumn = {
  column_name?: string
  name?: string
  type?: string | null
  is_dttm?: boolean | null
}

type DatasetInfo = {
  id?: number | string | null
  table_name?: string | null
  url?: string | null
  columns?: DatasetColumn[]
}

type ChartInfo = {
  id?: number | string | null
  slice_id?: number | string | null
}

type ChartResult = {
  chart?: ChartInfo | null
  id?: number | string | null
  slice_id?: number | string | null
  chart_id?: number | string | null
  chart_url?: string | null
  explore_url?: string | null
  error?: unknown
}

type DashboardResult = {
  dashboard_url?: string | null
  url?: string | null
  error?: unknown
}

type ChartPlan = {
  name: string
  config: Record<string, unknown>
}

export type AxBiDashboardWorkflowResult =
  | { handled: false }
  | { handled: true; message: string; dashboardUrl?: string }

export type AxBiChartIntentWorkflowResult =
  | { handled: false }
  | { handled: true; message: string; chartUrl?: string }

export type AxBiChartMetric =
  | { type: 'count' }
  | { type: 'aggregate'; aggregate: 'AVG' | 'SUM' | 'MIN' | 'MAX'; column: string }

export type AxBiChartIntentDraft =
  | {
      datasetName: string
      groupBy: string
      chartKind: 'bar'
      metric: AxBiChartMetric
      chartName?: string
    }
  | {
      datasetName: string
      chartKind: 'scatter'
      xColumn: string
      yColumn: string
      groupBy?: string
      chartName?: string
    }

type ExistingDatasetChartIntent = AxBiChartIntentDraft & {
  chartName: string
}

type ResolvedExistingDatasetChartIntent =
  ExistingDatasetChartIntent

export type AxBiChartIntentExtractor = (
  prompt: string
) => Promise<AxBiChartIntentDraft | null>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonToolResult<T>(result: MCPToolCallResult): T {
  const structuredContent =
    result.structuredContent ?? result.structured_content
  if (isRecord(structuredContent)) return structuredContent as T

  const parsed = parseAxBiToolResult(result)
  if (parsed && isRecord(parsed)) return parsed as T

  const textParts: string[] = []
  for (const item of result.content ?? []) {
    if (typeof item.text !== 'string') continue
    textParts.push(item.text)
    try {
      const value = JSON.parse(item.text)
      if (isRecord(value)) return value as T
    } catch {
      // Some MCP tools return prose in text parts. Keep scanning for JSON.
    }
  }

  const isError = result.isError ?? result.is_error
  const textError = textParts
    .map((text) => text.trim())
    .find((text) => text.length > 0)
  throw new Error(
    result.error ||
      textError ||
      (isError ? 'AX-BI MCP returned an error response without details' : 'AX-BI MCP returned an empty response')
  )
}

function normalizeFileType(attachment: Attachment): string {
  const fileType = attachment.fileType || attachment.name.split('.').pop() || ''
  return fileType.toLowerCase()
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/g, '').trim()
}

function normalizeMetric(value: unknown): AxBiChartMetric | null {
  if (!isRecord(value)) return null
  if (value.type === 'count') return { type: 'count' }
  if (value.type !== 'aggregate') return null
  const aggregate =
    typeof value.aggregate === 'string' ? value.aggregate.toUpperCase() : ''
  if (!['AVG', 'SUM', 'MIN', 'MAX'].includes(aggregate)) return null
  if (typeof value.column !== 'string' || value.column.trim().length === 0) {
    return null
  }
  return {
    type: 'aggregate',
    aggregate: aggregate as 'AVG' | 'SUM' | 'MIN' | 'MAX',
    column: stripTrailingPunctuation(value.column),
  }
}

function buildDefaultChartName(intent: AxBiChartIntentDraft): string {
  if (intent.chartKind === 'scatter') {
    return `${humanize(intent.yColumn)} vs ${humanize(intent.xColumn)}`
  }
  return intent.metric.type === 'count'
    ? `${intent.datasetName} Count by ${intent.groupBy}`
    : `${humanize(intent.metric.column)} ${intent.metric.aggregate} by ${humanize(intent.groupBy)}`
}

function normalizeChartIntentDraft(
  value: unknown
): ExistingDatasetChartIntent | null {
  if (!isRecord(value)) return null
  if (value.unsupported === true) return null
  if (typeof value.datasetName !== 'string' || value.datasetName.trim().length === 0) {
    return null
  }
  const chartKind = value.chartKind === 'scatter' ? 'scatter' : 'bar'

  if (chartKind === 'scatter') {
    if (typeof value.xColumn !== 'string' || value.xColumn.trim().length === 0) {
      return null
    }
    if (typeof value.yColumn !== 'string' || value.yColumn.trim().length === 0) {
      return null
    }
    const draft: AxBiChartIntentDraft = {
      datasetName: stripTrailingPunctuation(value.datasetName),
      chartKind: 'scatter',
      xColumn: stripTrailingPunctuation(value.xColumn),
      yColumn: stripTrailingPunctuation(value.yColumn),
      groupBy:
        typeof value.groupBy === 'string' && value.groupBy.trim().length > 0
          ? stripTrailingPunctuation(value.groupBy)
          : undefined,
      chartName:
        typeof value.chartName === 'string' && value.chartName.trim().length > 0
          ? stripTrailingPunctuation(value.chartName)
          : undefined,
    }

    return {
      ...draft,
      chartName: draft.chartName ?? buildDefaultChartName(draft),
    }
  }

  if (typeof value.groupBy !== 'string' || value.groupBy.trim().length === 0) {
    return null
  }
  const metric = normalizeMetric(value.metric)
  if (!metric) return null

  const draft: AxBiChartIntentDraft = {
    datasetName: stripTrailingPunctuation(value.datasetName),
    groupBy: stripTrailingPunctuation(value.groupBy),
    chartKind: 'bar',
    metric,
    chartName:
      typeof value.chartName === 'string' && value.chartName.trim().length > 0
        ? stripTrailingPunctuation(value.chartName)
        : undefined,
  }

  return {
    ...draft,
    chartName: draft.chartName ?? buildDefaultChartName(draft),
  }
}

function parseExistingDatasetChartIntent(prompt: string): ExistingDatasetChartIntent | null {
  if (!/\bax-?bi\s+mcp\b/i.test(prompt)) return null
  if (!/\b(bar\s+chart|scatter\s+chart|chart|scatter)\b/i.test(prompt)) return null

  const datasetMatch =
    prompt.match(/\bdataset\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i) ??
    prompt.match(/\bfrom\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i)
  if (!datasetMatch?.[1]) return null

  if (/\bscatter\b/i.test(prompt)) {
    const xMatch =
      prompt.match(/\bwith\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+on\s+(?:the\s+)?x-?axis\b/i) ??
      prompt.match(/\b([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+(?:as|for)\s+(?:the\s+)?x-?axis\b/i)
    const yMatch =
      prompt.match(/\band\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+on\s+(?:the\s+)?y-?axis\b/i) ??
      prompt.match(/\b([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+(?:as|for)\s+(?:the\s+)?y-?axis\b/i)
    if (!xMatch?.[1] || !yMatch?.[1]) return null

    const groupByMatch =
      prompt.match(/\bgrouped\s+by\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i) ??
      prompt.match(/\bcolored\s+by\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i) ??
      prompt.match(/\bsplit\s+by\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i)
    const nameMatch = prompt.match(/\bname\s+it\s+(.+?)(?:[.!?]\s*$|$)/i)
    const draft: AxBiChartIntentDraft = {
      datasetName: stripTrailingPunctuation(datasetMatch[1]),
      chartKind: 'scatter',
      xColumn: stripTrailingPunctuation(xMatch[1]),
      yColumn: stripTrailingPunctuation(yMatch[1]),
      groupBy: groupByMatch?.[1]
        ? stripTrailingPunctuation(groupByMatch[1])
        : undefined,
      chartName:
        typeof nameMatch?.[1] === 'string'
          ? stripTrailingPunctuation(nameMatch[1])
          : undefined,
    }

    return {
      ...draft,
      chartName: draft.chartName ?? buildDefaultChartName(draft),
    }
  }

  const groupByMatch = prompt.match(/\bby\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i)
  if (!groupByMatch?.[1]) return null

  const countMetric =
    /\bcount\s*(?:\(\s*\*\s*\))?|\bcount\s+of\s+records\b|\brecords?\s+by\b/i.test(
      prompt
    )
  const aggregateMatch = prompt.match(
    /\b(?:showing\s+)?(average|avg|sum|total|min|minimum|max|maximum)\s+(?:of\s+)?([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i
  )
  if (!countMetric && !aggregateMatch) return null

  const aggregateMap: Record<string, 'AVG' | 'SUM' | 'MIN' | 'MAX'> = {
    average: 'AVG',
    avg: 'AVG',
    sum: 'SUM',
    total: 'SUM',
    min: 'MIN',
    minimum: 'MIN',
    max: 'MAX',
    maximum: 'MAX',
  }

  const nameMatch = prompt.match(/\bname\s+it\s+(.+?)(?:[.!?]\s*$|$)/i)
  const metric = countMetric
    ? ({ type: 'count' } as const)
    : ({
        type: 'aggregate',
        aggregate: aggregateMap[aggregateMatch![1].toLowerCase()],
        column: stripTrailingPunctuation(aggregateMatch![2]),
      } as const)
  const defaultChartName =
    metric.type === 'count'
      ? `${datasetMatch[1]} Count by ${groupByMatch[1]}`
      : `${humanize(metric.column)} ${metric.aggregate} by ${humanize(groupByMatch[1])}`
  const chartName = stripTrailingPunctuation(
    nameMatch?.[1] ?? defaultChartName
  )

  return {
    datasetName: stripTrailingPunctuation(datasetMatch[1]),
    groupBy: stripTrailingPunctuation(groupByMatch[1]),
    chartName,
    chartKind: 'bar',
    metric,
  }
}

export function isAxBiChartCandidate(prompt: string): boolean {
  return /\bax-?bi\s+mcp\b/i.test(prompt) && /\b(chart|charts|bar|scatter|graph|plot|visuali[sz]e)\b/i.test(prompt)
}

export function isAxBiDashboardRequest(
  prompt: string,
  attachments: Attachment[] | undefined
): boolean {
  if (!DASHBOARD_INTENT.test(prompt)) return false
  if (!ATTACHED_FILE_INTENT.test(prompt)) return false
  return Boolean(
    attachments?.some((attachment) => {
      if (attachment.type !== 'document') return false
      const fileType = normalizeFileType(attachment)
      return SUPPORTED_DATA_TYPES.has(fileType) || PRESENTATION_TYPES.has(fileType)
    })
  )
}

export function isAxBiExistingDatasetChartRequest(prompt: string): boolean {
  return isAxBiChartCandidate(prompt)
}

function pickDataAttachment(attachments: Attachment[]): Attachment | undefined {
  return attachments.find((attachment) => {
    if (attachment.type !== 'document') return false
    const fileType = normalizeFileType(attachment)
    return SUPPORTED_DATA_TYPES.has(fileType) || PRESENTATION_TYPES.has(fileType)
  })
}

function columnName(column: DatasetColumn): string | undefined {
  return column.column_name || column.name
}

function isNumericColumn(column: DatasetColumn): boolean {
  const type = (column.type || '').toLowerCase()
  return /\b(int|float|double|decimal|numeric|number|real|long|short|bigint)\b/.test(type)
}

function isDateColumn(column: DatasetColumn): boolean {
  if (column.is_dttm) return true
  const type = (column.type || '').toLowerCase()
  const name = (columnName(column) || '').toLowerCase()
  return /\b(date|time|timestamp|datetime)\b/.test(type) || /(^|_)(date|time|year|month)(_|$)/.test(name)
}

function isLikelyCategory(column: DatasetColumn): boolean {
  const name = (columnName(column) || '').toLowerCase()
  if (isDateColumn(column) || isNumericColumn(column)) return false
  return (
    /\b(country|region|territory|state|city|product|category|status|segment|line|type|name)\b/.test(name) ||
    Boolean(columnName(column))
  )
}

function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function buildChartPlans(dataset: DatasetInfo): ChartPlan[] {
  const columns = dataset.columns ?? []
  const namedColumns = columns.filter((column) => columnName(column))
  const numeric = namedColumns.find(isNumericColumn)
  const date = namedColumns.find(isDateColumn)
  const preferredCategory =
    namedColumns.find((column) =>
      /\b(country|region|territory|product|productline|category|status|segment)\b/i.test(
        columnName(column) || ''
      )
    ) ?? namedColumns.find(isLikelyCategory)

  const tableColumns = namedColumns.slice(0, 8).map((column) => ({
    name: columnName(column),
  }))

  const plans: ChartPlan[] = []
  if (tableColumns.length > 0) {
    plans.push({
      name: 'Table Preview',
      config: {
        chart_type: 'table',
        columns: tableColumns,
        groupby: tableColumns.map((c) => c.name),
        metrics: [],
        query_mode: 'raw',
        include_time: false,
      },
    })
  }

  if (numeric) {
    const numericName = columnName(numeric)!
    plans.push({
      name: `Total ${humanize(numericName)}`,
      config: {
        chart_type: 'big_number',
        metric: { name: numericName, aggregate: 'SUM' },
        subheader: `SUM(${numericName})`,
      },
    })

    if (preferredCategory) {
      const categoryName = columnName(preferredCategory)!
      plans.push({
        name: `${humanize(numericName)} by ${humanize(categoryName)}`,
        config: {
          chart_type: 'xy',
          x: { name: categoryName },
          y: [{ name: numericName, aggregate: 'SUM', label: `SUM(${numericName})` }],
          kind: 'bar',
          orientation: 'vertical',
          show_value: true,
          color_scheme: 'supersetColors',
        },
      })
    }

    if (date) {
      const dateName = columnName(date)!
      plans.push({
        name: `${humanize(numericName)} over Time`,
        config: {
          chart_type: 'xy',
          x: { name: dateName },
          y: [{ name: numericName, aggregate: 'SUM', label: `SUM(${numericName})` }],
          kind: 'line',
          time_grain: 'P1M',
          show_value: false,
          color_scheme: 'supersetColors',
        },
      })
    }
  }

  return plans.slice(0, 4)
}

function extractId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return undefined
}

function chartIdFromResult(result: ChartResult): number | undefined {
  return (
    extractId(result.chart?.id) ??
    extractId(result.chart?.slice_id) ??
    extractId(result.id) ??
    extractId(result.slice_id)
  )
}

function dashboardUrlFromResult(result: DashboardResult): string | undefined {
  return result.dashboard_url || result.url || undefined
}

function collectRecords(value: unknown, records: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, records)
    return records
  }
  if (!isRecord(value)) return records

  if ('id' in value && ('table_name' in value || 'name' in value)) {
    records.push(value)
  }
  for (const child of Object.values(value)) collectRecords(child, records)
  return records
}

function findDatasetRecord(result: unknown, datasetName: string): Record<string, unknown> | undefined {
  const expected = datasetName.toLowerCase()
  return collectRecords(result).find((record) => {
    const names = [record.table_name, record.name, record.dataset_name]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase())
    return names.some((name) => name === expected || name.includes(expected))
  })
}

function normalizeColumnLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findColumn(
  columns: DatasetColumn[],
  requestedName: string
): DatasetColumn | undefined {
  const requested = requestedName.toLowerCase()
  const compact = normalizeColumnLookup(requestedName)
  return columns.find((column) => {
    const name = columnName(column)
    if (!name) return false
    return name.toLowerCase() === requested || normalizeColumnLookup(name) === compact
  })
}

function datasetColumnsFromResult(result: unknown): DatasetColumn[] {
  if (!isRecord(result)) return []
  const directColumns = result.columns
  if (Array.isArray(directColumns)) return directColumns as DatasetColumn[]
  const dataset = result.dataset
  if (isRecord(dataset) && Array.isArray(dataset.columns)) {
    return dataset.columns as DatasetColumn[]
  }
  const resultValue = result.result
  if (isRecord(resultValue) && Array.isArray(resultValue.columns)) {
    return resultValue.columns as DatasetColumn[]
  }
  return []
}

function validateAndResolveIntentColumns(
  intent: ExistingDatasetChartIntent,
  columns: DatasetColumn[]
): ResolvedExistingDatasetChartIntent {
  if (intent.chartKind === 'scatter') {
    const xColumn = findColumn(columns, intent.xColumn)
    if (!xColumn || !columnName(xColumn)) {
      throw new Error(
        `Dataset "${intent.datasetName}" does not contain x-axis column "${intent.xColumn}".`
      )
    }
    if (!isNumericColumn(xColumn)) {
      throw new Error(
        `Column "${columnName(xColumn)}" is not numeric, so it cannot be used as a scatter x-axis.`
      )
    }

    const yColumn = findColumn(columns, intent.yColumn)
    if (!yColumn || !columnName(yColumn)) {
      throw new Error(
        `Dataset "${intent.datasetName}" does not contain y-axis column "${intent.yColumn}".`
      )
    }
    if (!isNumericColumn(yColumn)) {
      throw new Error(
        `Column "${columnName(yColumn)}" is not numeric, so it cannot be used as a scatter y-axis.`
      )
    }

    const groupByColumn = intent.groupBy
      ? findColumn(columns, intent.groupBy)
      : undefined
    if (intent.groupBy && (!groupByColumn || !columnName(groupByColumn))) {
      throw new Error(
        `Dataset "${intent.datasetName}" does not contain grouping column "${intent.groupBy}".`
      )
    }

    return {
      ...intent,
      xColumn: columnName(xColumn)!,
      yColumn: columnName(yColumn)!,
      groupBy: groupByColumn ? columnName(groupByColumn) : undefined,
    }
  }

  const groupByColumn = findColumn(columns, intent.groupBy)
  if (!groupByColumn || !columnName(groupByColumn)) {
    throw new Error(
      `Dataset "${intent.datasetName}" does not contain column "${intent.groupBy}".`
    )
  }

  if (intent.metric.type === 'count') {
    return {
      ...intent,
      groupBy: columnName(groupByColumn)!,
    }
  }

  const metricColumn = findColumn(columns, intent.metric.column)
  if (!metricColumn || !columnName(metricColumn)) {
    throw new Error(
      `Dataset "${intent.datasetName}" does not contain metric column "${intent.metric.column}".`
    )
  }
  if (!isNumericColumn(metricColumn)) {
    throw new Error(
      `Column "${columnName(metricColumn)}" is not numeric, so ${intent.metric.aggregate} cannot be used for this chart.`
    )
  }

  return {
    ...intent,
    groupBy: columnName(groupByColumn)!,
    metric: {
      ...intent.metric,
      column: columnName(metricColumn)!,
    },
  }
}

function buildExistingDatasetChartConfig(
  intent: ResolvedExistingDatasetChartIntent
): Record<string, unknown> {
  if (intent.chartKind === 'scatter') {
    const config: Record<string, unknown> = {
      chart_type: 'xy',
      x: { name: intent.xColumn },
      y: [{ name: intent.yColumn, label: humanize(intent.yColumn) }],
      kind: 'scatter',
      x_axis: { title: humanize(intent.xColumn) },
      y_axis: { title: humanize(intent.yColumn) },
      color_scheme: 'supersetColors',
    }
    if (intent.groupBy) {
      config.group_by = [{ name: intent.groupBy }]
    }
    return config
  }

  return {
    chart_type: 'xy',
    x: { name: intent.groupBy },
    y:
      intent.metric.type === 'count'
        ? [{ sql_expression: 'COUNT(*)', label: 'Count' }]
        : [
            {
              name: intent.metric.column,
              aggregate: intent.metric.aggregate,
              label: `${intent.metric.aggregate}(${intent.metric.column})`,
            },
          ],
    kind: intent.chartKind,
    orientation: 'vertical',
    x_axis: { title: humanize(intent.groupBy) },
    y_axis: {
      title:
        intent.metric.type === 'count'
          ? 'Count'
          : `${intent.metric.aggregate}(${humanize(intent.metric.column)})`,
    },
  }
}

function axBiToolNames(tools: MCPTool[]): Set<string> {
  return new Set(
    tools
      .filter((tool) => tool.server === AX_BI_SERVER)
      .map((tool) => tool.name)
  )
}

function canCallAxBiTool(toolNames: Set<string>, toolName: string): boolean {
  return toolNames.has(toolName) || toolNames.has('call_tool')
}

async function callAxBiTool({
  serviceHub,
  toolNames,
  toolName,
  arguments: toolArguments,
}: {
  serviceHub: ServiceHub
  toolNames: Set<string>
  toolName: string
  arguments: object
}): Promise<MCPToolCallResult> {
  if (toolNames.has(toolName)) {
    return serviceHub.mcp().callTool({
      serverName: AX_BI_SERVER,
      toolName,
      arguments: toolArguments,
    })
  }

  if (toolNames.has('call_tool')) {
    const proxied = await serviceHub.mcp().callTool({
      serverName: AX_BI_SERVER,
      toolName: 'call_tool',
      arguments: {
        name: toolName,
        arguments: toolArguments,
      },
    })
    if (
      !proxied.error &&
      proxied.content.length === 0 &&
      proxied.structuredContent == null &&
      proxied.structured_content == null
    ) {
      return serviceHub.mcp().callTool({
        serverName: AX_BI_SERVER,
        toolName,
        arguments: toolArguments,
      })
    }
    return proxied
  }

  throw new Error(
    `AX-BI MCP is connected, but neither "${toolName}" nor the "call_tool" proxy is available. Please restart the AX-BI MCP service and reconnect it in Ax Studio.`
  )
}

function chartUrlFromResult(result: ChartResult): string | undefined {
  const chart = result.chart ?? undefined
  if (result.chart_url) return result.chart_url
  if (result.explore_url) return result.explore_url
  const chartRecord: Record<string, unknown> | undefined =
    chart && isRecord(chart) ? (chart as Record<string, unknown>) : undefined
  const chartUrl = typeof chartRecord?.url === 'string' ? chartRecord.url : undefined
  if (chartUrl) return chartUrl

  const id = result.slice_id ?? result.chart_id ?? chart?.slice_id ?? result.id ?? chart?.id
  return id != null ? `http://127.0.0.1:8080/explore/?slice_id=${id}` : undefined
}

export async function runAxBiExistingDatasetChartWorkflow({
  prompt,
  serviceHub,
  intentExtractor,
}: {
  prompt: string
  serviceHub: ServiceHub
  intentExtractor?: AxBiChartIntentExtractor
}): Promise<AxBiChartIntentWorkflowResult> {
  let intent =
    isAxBiChartCandidate(prompt) && intentExtractor
      ? normalizeChartIntentDraft(await intentExtractor(prompt))
      : null
  intent ??= parseExistingDatasetChartIntent(prompt)
  if (!intent) return { handled: false }

  const tools = await serviceHub.mcp().getTools()
  const toolNames = axBiToolNames(tools)
  for (const required of ['list_datasets', 'get_dataset_info', 'generate_chart']) {
    if (!canCallAxBiTool(toolNames, required)) {
      throw new Error(
        `AX-BI MCP is connected, but the required tool "${required}" is not available directly or through the "call_tool" proxy. Please restart the AX-BI MCP service and reconnect it in Ax Studio.`
      )
    }
  }

  const datasetList = await callAxBiTool({
    serviceHub,
    toolNames,
    toolName: 'list_datasets',
    arguments: {
      request: {
        search: intent.datasetName,
        page: 1,
        page_size: 20,
        select_columns: ['id', 'table_name', 'schema', 'database_name', 'url'],
      },
    },
  })
  const parsedDatasetList = parseJsonToolResult<Record<string, unknown>>(datasetList)
  const dataset = findDatasetRecord(parsedDatasetList, intent.datasetName)
  const datasetId = dataset?.id
  if (datasetId == null) {
    throw new Error(`Could not find AX-BI dataset "${intent.datasetName}".`)
  }

  const datasetInfoResult = await callAxBiTool({
    serviceHub,
    toolNames,
    toolName: 'get_dataset_info',
    arguments: {
      request: {
        identifier: datasetId,
      },
    },
  })
  const parsedDatasetInfo = parseJsonToolResult<Record<string, unknown>>(datasetInfoResult)
  const columns = datasetColumnsFromResult(parsedDatasetInfo)
  if (columns.length === 0) {
    throw new Error(
      `Could not read columns for AX-BI dataset "${intent.datasetName}".`
    )
  }
  const resolvedIntent = validateAndResolveIntentColumns(intent, columns)

  const chartResult = await callAxBiTool({
    serviceHub,
    toolNames,
    toolName: 'generate_chart',
    arguments: {
      request: {
        dataset_id: datasetId,
        chart_name: resolvedIntent.chartName,
        save_chart: true,
        generate_preview: false,
        config: buildExistingDatasetChartConfig(resolvedIntent),
      },
    },
  })

  const parsedChartResult = parseJsonToolResult<ChartResult>(chartResult)
  if (parsedChartResult.error) {
    throw new Error(
      typeof parsedChartResult.error === 'string'
        ? parsedChartResult.error
        : 'AX-BI chart creation failed'
    )
  }

  // AX-BI's generate_chart may ignore the config parameter and create
  // a default chart. Apply the config explicitly via update_chart.
  const chartId = chartIdFromResult(parsedChartResult)
  if (chartId && toolNames.has('update_chart')) {
    try {
      await callAxBiTool({
        serviceHub,
        toolNames,
        toolName: 'update_chart',
        arguments: {
          request: {
            chart_id: chartId,
            config: buildExistingDatasetChartConfig(resolvedIntent),
          },
        },
      })
    } catch (error) {
      console.warn('[AX-BI] update_chart failed for chart', chartId, error)
    }
  }

  const chartUrl = chartUrlFromResult(parsedChartResult)
  return {
    handled: true,
    chartUrl,
    message: chartUrl
      ? `Created saved AX-BI chart "${resolvedIntent.chartName}".\n\nChart URL: ${chartUrl}`
      : `Created saved AX-BI chart "${resolvedIntent.chartName}", but AX-BI did not return a chart URL.`,
  }
}

export async function runAxBiDashboardWorkflow({
  prompt,
  attachments,
  serviceHub,
}: {
  prompt: string
  attachments: Attachment[]
  serviceHub: ServiceHub
}): Promise<AxBiDashboardWorkflowResult> {
  if (!isAxBiDashboardRequest(prompt, attachments)) return { handled: false }

  const attachment = pickDataAttachment(attachments)
  if (!attachment) return { handled: false }

  const fileType = normalizeFileType(attachment)
  if (PRESENTATION_TYPES.has(fileType)) {
    return {
      handled: true,
      message:
        'AX-BI dashboard generation needs structured data. PPT/PPTX support is limited to extracted tables, which is not wired yet in this MVP. Please attach CSV or Excel for now.',
    }
  }

  if (!attachment.path) {
    return {
      handled: true,
      message: `I could not upload ${attachment.name} to AX-BI because the attachment path is missing.`,
    }
  }

  const tools = await serviceHub.mcp().getTools()
  const toolNames = new Set(
    tools
      .filter((tool) => tool.server === AX_BI_SERVER)
      .map((tool) => tool.name)
  )
  for (const required of ['upload_file', 'generate_chart', 'generate_dashboard']) {
    if (!toolNames.has(required)) {
      return {
        handled: true,
        message: `AX-BI MCP is connected, but the required tool "${required}" is not available. Please restart the AX-BI MCP service and reconnect it in Ax Studio.`,
      }
    }
  }

  const fileContent = await fs.readFileBase64(attachment.path)
  const upload = await serviceHub.mcp().callTool({
    serverName: AX_BI_SERVER,
    toolName: 'upload_file',
    arguments: {
      request: {
        file_content: fileContent,
        filename: attachment.name,
      },
    },
  })
  const dataset = parseJsonToolResult<DatasetInfo & { error?: unknown }>(upload)
  if (dataset.error || !dataset.id) {
    throw new Error(
      typeof dataset.error === 'string'
        ? dataset.error
        : `AX-BI could not create a dataset from ${attachment.name}`
    )
  }

  const chartPlans = buildChartPlans(dataset)
  if (chartPlans.length === 0) {
    return {
      handled: true,
      message: `AX-BI created a dataset from ${attachment.name}, but I could not identify usable columns for charts. Dataset URL: ${dataset.url ?? 'not returned'}`,
    }
  }

  const chartIds: number[] = []
  for (const plan of chartPlans) {
    const chart = await serviceHub.mcp().callTool({
      serverName: AX_BI_SERVER,
      toolName: 'generate_chart',
      arguments: {
        request: {
          dataset_id: dataset.id,
          chart_name: `${humanize(attachment.name.replace(/\.[^.]+$/, ''))} - ${plan.name}`,
          config: plan.config,
          save_chart: true,
          generate_preview: true,
          preview_formats: ['url'],
        },
      },
    })
    const chartResult = parseJsonToolResult<ChartResult>(chart)
    if (chartResult.error) {
      console.warn('[AX-BI] Chart generation failed', plan.name, chartResult.error)
      continue
    }
    const chartId = chartIdFromResult(chartResult)
    if (!chartId) continue

    // AX-BI's generate_chart may ignore the config parameter and create
    // a default chart. Apply the config explicitly via update_chart.
    if (toolNames.has('update_chart')) {
      try {
        await serviceHub.mcp().callTool({
          serverName: AX_BI_SERVER,
          toolName: 'update_chart',
          arguments: {
            request: {
              chart_id: chartId,
              config: plan.config,
            },
          },
        })
      } catch (error) {
        console.warn('[AX-BI] update_chart failed for chart', chartId, error)
      }
    }

    chartIds.push(chartId)
  }

  if (chartIds.length === 0) {
    throw new Error('AX-BI created the dataset, but no charts could be saved.')
  }

  const dashboardTitle = `${humanize(attachment.name.replace(/\.[^.]+$/, ''))} Dashboard`
  const dashboard = await serviceHub.mcp().callTool({
    serverName: AX_BI_SERVER,
    toolName: 'generate_dashboard',
    arguments: {
      request: {
        chart_ids: chartIds,
        dashboard_title: dashboardTitle,
        description: `Generated from ${attachment.name} via Ax Studio.`,
        published: true,
      },
    },
  })
  const dashboardResult = parseJsonToolResult<DashboardResult>(dashboard)
  if (dashboardResult.error) {
    throw new Error(
      typeof dashboardResult.error === 'string'
        ? dashboardResult.error
        : 'AX-BI dashboard creation failed'
    )
  }

  const dashboardUrl = dashboardUrlFromResult(dashboardResult)
  return {
    handled: true,
    dashboardUrl,
    message: dashboardUrl
      ? `Created an AX-BI dashboard from ${attachment.name} with ${chartIds.length} saved chart${chartIds.length === 1 ? '' : 's'}.\n\nDashboard URL: ${dashboardUrl}`
      : `Created an AX-BI dashboard from ${attachment.name} with ${chartIds.length} saved chart${chartIds.length === 1 ? '' : 's'}, but AX-BI did not return a dashboard URL.`,
  }
}
