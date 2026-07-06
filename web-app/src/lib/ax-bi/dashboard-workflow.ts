import { fs } from '@ax-studio/core'
import type { ServiceHub } from '@/services'
import type { Attachment } from '@/types/attachment'
import type { MCPTool, MCPToolCallResult } from '@ax-studio/core'
import { getFirstMcpText, isRecord, parseJsonMcpResult } from './mcp-result'
import { AxBI, type DashboardPlan } from './sdk'

const AX_BI_SERVER = 'ax-bi'
const SUPPORTED_DATA_TYPES = new Set([
  'csv',
  'tsv',
  'txt',
  'xls',
  'xlsx',
  'parquet',
])
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

export type AxBiSdkPromptWorkflowResult =
  | { handled: false }
  | { handled: true; message: string; plan: DashboardPlan }

type AxBiSdkClient = Pick<AxBI, 'ai'>

export type AxBiChartMetric =
  | { type: 'count' }
  | {
      type: 'aggregate'
      aggregate: 'AVG' | 'SUM' | 'MIN' | 'MAX'
      column: string
    }

type AxBiChartOptions = {
  colorScheme?: string
  rowLimit?: number
  showValues?: boolean
}

type AxBiChartFilter = {
  column: string
  op: '=' | '!='
  value: string | number | boolean
}

type AxBiGroupedChartKind =
  | 'area'
  | 'bar'
  | 'donut'
  | 'horizontal_bar'
  | 'line'
  | 'pie'

export type AxBiChartIntentDraft =
  | {
      datasetName: string
      groupBy: string
      chartKind: AxBiGroupedChartKind
      metric: AxBiChartMetric
      chartName?: string
      options?: AxBiChartOptions
      filters?: AxBiChartFilter[]
    }
  | {
      datasetName: string
      chartKind: 'scatter'
      xColumn: string
      yColumn: string
      groupBy?: string
      chartName?: string
      options?: AxBiChartOptions
      filters?: AxBiChartFilter[]
    }
  | {
      datasetName: string
      chartKind: 'table'
      columns: string[]
      chartName?: string
      options?: AxBiChartOptions
      filters?: AxBiChartFilter[]
    }
  | {
      datasetName: string
      chartKind: 'big_number'
      metric: AxBiChartMetric
      chartName?: string
      options?: AxBiChartOptions
      filters?: AxBiChartFilter[]
    }

type ExistingDatasetChartIntent = AxBiChartIntentDraft & {
  chartName: string
}

type ExistingDatasetDashboardIntent = {
  datasetName: string
  dashboardTitle: string
}

type ResolvedExistingDatasetChartIntent = ExistingDatasetChartIntent

export type AxBiChartIntentExtractor = (
  prompt: string
) => Promise<AxBiChartIntentDraft | null>

function parseJsonToolResult<T>(result: MCPToolCallResult): T {
  const parsedJson = parseJsonMcpResult<Record<string, unknown>>(result)
  if (parsedJson) return parsedJson as T

  const isError = result.isError ?? result.is_error
  const textError = getFirstMcpText(result)
  throw new Error(
    result.error ||
      textError ||
      (isError
        ? 'AX-BI MCP returned an error response without details'
        : 'AX-BI MCP returned an empty response')
  )
}

function normalizeFileType(attachment: Attachment): string {
  const fileType = attachment.fileType || attachment.name.split('.').pop() || ''
  return fileType.toLowerCase()
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/g, '').trim()
}

function normalizeChartKind(
  value: unknown
): AxBiGroupedChartKind | 'big_number' | 'scatter' | 'table' {
  if (typeof value !== 'string') return 'bar'
  const normalized = value.toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'scatter') return 'scatter'
  if (normalized === 'table') return 'table'
  if (normalized === 'big_number' || normalized === 'kpi') return 'big_number'
  if (normalized === 'area') return 'area'
  if (normalized === 'line') return 'line'
  if (normalized === 'donut') return 'donut'
  if (normalized === 'pie') return 'pie'
  if (normalized === 'column') return 'bar'
  if (normalized === 'horizontal_bar') return 'horizontal_bar'
  return 'bar'
}

function inferChartKindFromPrompt(prompt: string): AxBiGroupedChartKind {
  if (/\barea\s+chart\b/i.test(prompt)) return 'area'
  if (/\bhorizontal\s+bar\s+chart\b/i.test(prompt)) return 'horizontal_bar'
  if (/\bline\s+chart\b/i.test(prompt)) return 'line'
  if (/\bdonut\s+chart\b/i.test(prompt)) return 'donut'
  if (/\bpie\s+chart\b/i.test(prompt)) return 'pie'
  return 'bar'
}

function extractRequestedChartName(prompt: string): string | undefined {
  const nameMatch = prompt.match(
    /\b(?:name\s+it|call\s+it|title\s+it|named|called|titled)\s+(.+?)(?:[.!?]\s*$|$)/i
  )
  return typeof nameMatch?.[1] === 'string'
    ? stripTrailingPunctuation(nameMatch[1])
    : undefined
}

function normalizeChartOptions(value: unknown): AxBiChartOptions | undefined {
  if (!isRecord(value)) return undefined
  const options: AxBiChartOptions = {}

  if (typeof value.colorScheme === 'string' && value.colorScheme.trim()) {
    options.colorScheme = stripTrailingPunctuation(value.colorScheme)
  }

  if (typeof value.rowLimit === 'number' && Number.isFinite(value.rowLimit)) {
    options.rowLimit = Math.max(1, Math.min(50000, Math.round(value.rowLimit)))
  }

  if (typeof value.showValues === 'boolean') {
    options.showValues = value.showValues
  }

  return Object.keys(options).length > 0 ? options : undefined
}

function extractPromptChartOptions(prompt: string): AxBiChartOptions | undefined {
  const options: AxBiChartOptions = {}

  const rowLimitMatch =
    prompt.match(/\b(?:top|first|limit|row\s+limit)\s+(\d{1,5})\b/i) ??
    prompt.match(/\b(\d{1,5})\s+(?:rows|records|bars|slices|items)\b/i)
  if (rowLimitMatch?.[1]) {
    const rowLimit = Number(rowLimitMatch[1])
    if (Number.isFinite(rowLimit)) {
      options.rowLimit = Math.max(1, Math.min(50000, Math.round(rowLimit)))
    }
  }

  if (
    /\b(?:show|display|include)\s+(?:data\s+)?(?:value\s+)?labels?\b/i.test(
      prompt
    ) ||
    /\bshow\s+values?\b/i.test(prompt)
  ) {
    options.showValues = true
  }

  const colorSchemes: Array<[RegExp, string]> = [
    [/\blyft\s+(?:colors?|colours?|palette|scheme)\b/i, 'lyftColors'],
    [/\bgoogle\s+(?:colors?|colours?|palette|scheme)\b/i, 'googleCategory10c'],
    [/\bd3\s+(?:colors?|colours?|palette|scheme)\b/i, 'd3Category10'],
    [/\b(?:superset|default|ax-?bi)\s+(?:colors?|colours?|palette|scheme)\b/i, 'supersetColors'],
  ]
  const matchedScheme = colorSchemes.find(([pattern]) => pattern.test(prompt))
  if (matchedScheme) {
    options.colorScheme = matchedScheme[1]
  }

  return Object.keys(options).length > 0 ? options : undefined
}

function normalizeChartFilters(value: unknown): AxBiChartFilter[] | undefined {
  if (!Array.isArray(value)) return undefined

  const filters = value.flatMap((item): AxBiChartFilter[] => {
    if (!isRecord(item) || typeof item.column !== 'string') return []
    const rawOp =
      item.op === '!=' || item.operator === '!=' || item.op === '<>'
        ? '!='
        : '='
    const rawValue = item.value ?? item.val
    if (
      typeof rawValue !== 'string' &&
      typeof rawValue !== 'number' &&
      typeof rawValue !== 'boolean'
    ) {
      return []
    }

    return [
      {
        column: stripTrailingPunctuation(item.column),
        op: rawOp,
        value:
          typeof rawValue === 'string'
            ? stripTrailingPunctuation(rawValue)
            : rawValue,
      },
    ]
  })

  return filters.length > 0 ? filters : undefined
}

function normalizeFilterValue(value: string): string | number {
  const normalized = stripTrailingPunctuation(
    value.trim().replace(/^['"]|['"]$/g, '')
  )
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized)
  return normalized
}

function extractPromptFilters(prompt: string): AxBiChartFilter[] | undefined {
  const filters: AxBiChartFilter[] = []
  const filterPattern =
    /\b(?:where|filter(?:ed)?(?:\s+to)?|only)\s+([A-Za-z0-9_][A-Za-z0-9_. -]*?)\s*(=|!=|is\s+not|is|equals?)\s+(['"]?)(.+?)(?:\3)(?:\s+(?:with|using)\b|\s+(?:name\s+it|call\s+it|title\s+it|named|called|titled)\b|\s+return\b|[.!?]\s*$|$)/gi

  for (const match of prompt.matchAll(filterPattern)) {
    const column = match[1]?.trim()
    const operator = match[2]?.toLowerCase().replace(/\s+/g, ' ')
    const value = match[4]?.trim()
    if (!column || !value) continue
    filters.push({
      column: stripTrailingPunctuation(column),
      op: operator === '!=' || operator === 'is not' ? '!=' : '=',
      value: normalizeFilterValue(value),
    })
  }

  return filters.length > 0 ? filters : undefined
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
  if (intent.chartKind === 'table') {
    return `${intent.datasetName} Detail Table`
  }
  if (intent.chartKind === 'big_number') {
    return intent.metric.type === 'count'
      ? `${intent.datasetName} Count`
      : `${humanize(intent.metric.column)} ${intent.metric.aggregate}`
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
  if (
    typeof value.datasetName !== 'string' ||
    value.datasetName.trim().length === 0
  ) {
    return null
  }
  const chartKind = normalizeChartKind(value.chartKind)

  if (chartKind === 'table') {
    if (!Array.isArray(value.columns)) return null
    const columns = value.columns
      .filter((column): column is string => typeof column === 'string')
      .map(stripTrailingPunctuation)
      .filter(Boolean)
    if (columns.length === 0) return null

    const draft: AxBiChartIntentDraft = {
      datasetName: stripTrailingPunctuation(value.datasetName),
      chartKind: 'table',
      columns,
      options: normalizeChartOptions(value.options),
      filters: normalizeChartFilters(value.filters),
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

  if (chartKind === 'big_number') {
    const metric = normalizeMetric(value.metric)
    if (!metric) return null

    const draft: AxBiChartIntentDraft = {
      datasetName: stripTrailingPunctuation(value.datasetName),
      chartKind: 'big_number',
      metric,
      options: normalizeChartOptions(value.options),
      filters: normalizeChartFilters(value.filters),
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

  if (chartKind === 'scatter') {
    if (
      typeof value.xColumn !== 'string' ||
      value.xColumn.trim().length === 0
    ) {
      return null
    }
    if (
      typeof value.yColumn !== 'string' ||
      value.yColumn.trim().length === 0
    ) {
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
      options: normalizeChartOptions(value.options),
      filters: normalizeChartFilters(value.filters),
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
    chartKind,
    metric,
    options: normalizeChartOptions(value.options),
    filters: normalizeChartFilters(value.filters),
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

function parseExistingDatasetChartIntent(
  prompt: string
): ExistingDatasetChartIntent | null {
  const explicitAxBiMcp = /\bax-?bi\s+mcp\b/i.test(prompt)
  const explicitSavedDatasetRequest =
    /\b(?:create|make|build|generate|save)\s+(?:a\s+|an\s+)?(?:saved\s+)?(?:area\s+chart|bar\s+chart|column\s+chart|horizontal\s+bar\s+chart|line\s+chart|pie\s+chart|donut\s+chart|scatter\s+chart|big\s+number|kpi|chart|table)\s+from\s+[A-Za-z0-9_][A-Za-z0-9_.-]*/i.test(
      prompt
    )
  if (!explicitAxBiMcp && !explicitSavedDatasetRequest) return null
  if (
    !/\b(area\s+chart|bar\s+chart|column\s+chart|horizontal\s+bar\s+chart|line\s+chart|pie\s+chart|donut\s+chart|scatter\s+chart|big\s+number|kpi|chart|scatter|table)\b/i.test(
      prompt
    )
  )
    return null

  const datasetMatch =
    prompt.match(/\bdataset\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i) ??
    prompt.match(/\bfrom\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i)
  if (!datasetMatch?.[1]) return null

  if (
    /\b(?:(?:saved\s+)?table\s+from|table\s+showing|create\s+(?:a\s+|an\s+)?(?:saved\s+)?table)\b/i.test(
      prompt
    )
  ) {
    const columnsMatch = prompt.match(
      /\b(?:showing|with\s+columns?|listing)\s+(.+?)(?:\s+(?:where|filter(?:ed)?|only|with|using)\b|\s+(?:name\s+it|call\s+it|title\s+it|named|called|titled)\b|\s+return\b|[.!?]\s*$|$)/i
    )
    if (!columnsMatch?.[1]) return null
    const columns = columnsMatch[1]
      .replace(/\s+and\s+/gi, ',')
      .split(',')
      .map(stripTrailingPunctuation)
      .map((column) => column.trim())
      .filter(Boolean)
    if (columns.length === 0) return null

    const draft: AxBiChartIntentDraft = {
      datasetName: stripTrailingPunctuation(datasetMatch[1]),
      chartKind: 'table',
      columns,
      options: extractPromptChartOptions(prompt),
      filters: extractPromptFilters(prompt),
      chartName: extractRequestedChartName(prompt),
    }

    return {
      ...draft,
      chartName: draft.chartName ?? buildDefaultChartName(draft),
    }
  }

  if (/\bscatter\b/i.test(prompt)) {
    const xMatch =
      prompt.match(
        /\bwith\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+on\s+(?:the\s+)?x-?axis\b/i
      ) ??
      prompt.match(
        /\b([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+(?:as|for)\s+(?:the\s+)?x-?axis\b/i
      )
    const yMatch =
      prompt.match(
        /\band\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+on\s+(?:the\s+)?y-?axis\b/i
      ) ??
      prompt.match(
        /\b([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+(?:as|for)\s+(?:the\s+)?y-?axis\b/i
      )
    if (!xMatch?.[1] || !yMatch?.[1]) return null

    const groupByMatch =
      prompt.match(/\bgrouped\s+by\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i) ??
      prompt.match(/\bcolored\s+by\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i) ??
      prompt.match(/\bsplit\s+by\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i)
    const draft: AxBiChartIntentDraft = {
      datasetName: stripTrailingPunctuation(datasetMatch[1]),
      chartKind: 'scatter',
      xColumn: stripTrailingPunctuation(xMatch[1]),
      yColumn: stripTrailingPunctuation(yMatch[1]),
      groupBy: groupByMatch?.[1]
        ? stripTrailingPunctuation(groupByMatch[1])
        : undefined,
      options: extractPromptChartOptions(prompt),
      filters: extractPromptFilters(prompt),
      chartName: extractRequestedChartName(prompt),
    }

    return {
      ...draft,
      chartName: draft.chartName ?? buildDefaultChartName(draft),
    }
  }

  const countMetric =
    /\bcount\s*(?:\(\s*\*\s*\))?|\bcount\s+of\s+records\b|\bnumber\s+of\s+records\b|\brecords?\s+by\b|\brecord\s+count\b/i.test(
      prompt
    )
  const aggregateFunctionMatch = prompt.match(
    /\b(average|avg|mean|sum|total|min|minimum|max|maximum)\s*\(\s*([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*\)/i
  )
  const aggregateMatch =
    aggregateFunctionMatch ??
    prompt.match(
      /\b(?:showing\s+)?(average|avg|mean|sum|total|min|minimum|max|maximum)\s+(?:of\s+)?([A-Za-z0-9_][A-Za-z0-9_. -]*?)(?:\s+by\b|\s+and\s+|\s*,|\s*\.|\s+(?:where|filter(?:ed)?|only|name\s+it|call\s+it|title\s+it|named|called|titled)\b|\s+return\b|$)/i
    )
  if (!countMetric && !aggregateMatch) return null

  const aggregateMap: Record<string, 'AVG' | 'SUM' | 'MIN' | 'MAX'> = {
    average: 'AVG',
    avg: 'AVG',
    mean: 'AVG',
    sum: 'SUM',
    total: 'SUM',
    min: 'MIN',
    minimum: 'MIN',
    max: 'MAX',
    maximum: 'MAX',
  }

  const metric = countMetric
    ? ({ type: 'count' } as const)
    : ({
        type: 'aggregate',
        aggregate: aggregateMap[aggregateMatch![1].toLowerCase()],
        column: stripTrailingPunctuation(aggregateMatch![2]),
      } as const)

  if (/\b(?:big\s+number|kpi)\b/i.test(prompt)) {
    const defaultChartName =
      metric.type === 'count'
        ? `${datasetMatch[1]} Count`
        : `${humanize(metric.column)} ${metric.aggregate}`
    return {
      datasetName: stripTrailingPunctuation(datasetMatch[1]),
      chartName: extractRequestedChartName(prompt) ?? defaultChartName,
      chartKind: 'big_number',
      metric,
      options: extractPromptChartOptions(prompt),
      filters: extractPromptFilters(prompt),
    }
  }

  const chartKind = inferChartKindFromPrompt(prompt)
  const groupByMatch = prompt.match(
    /\bby\s+([A-Za-z0-9_][A-Za-z0-9_. -]*?)(?:\s+and\s+|\s*,|\s*\.|\s+(?:where|filter(?:ed)?|only|with|using)\b|\s+(?:name\s+it|call\s+it|title\s+it|named|called|titled)\b|\s+return\b|$)/i
  )
  if (!groupByMatch?.[1]) return null
  const defaultChartName =
    metric.type === 'count'
      ? `${datasetMatch[1]} Count by ${groupByMatch[1]}`
      : `${humanize(metric.column)} ${metric.aggregate} by ${humanize(groupByMatch[1])}`
  const chartName = extractRequestedChartName(prompt) ?? defaultChartName

  return {
    datasetName: stripTrailingPunctuation(datasetMatch[1]),
    groupBy: stripTrailingPunctuation(groupByMatch[1]),
    chartName,
    chartKind,
    metric,
    options: extractPromptChartOptions(prompt),
    filters: extractPromptFilters(prompt),
  }
}

function parseExistingDatasetDashboardIntent(
  prompt: string
): ExistingDatasetDashboardIntent | null {
  if (!/\b(?:dashboard|report)\b/i.test(prompt)) return null
  const datasetMatch =
    prompt.match(/\bwith\s+dataset\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i) ??
    prompt.match(/\bfrom\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\b/i)
  if (!datasetMatch?.[1]) return null

  const datasetName = stripTrailingPunctuation(datasetMatch[1])
  return {
    datasetName,
    dashboardTitle:
      extractRequestedChartName(prompt) ?? `${humanize(datasetName)} Dashboard`,
  }
}

function isAxBiChartCandidate(prompt: string): boolean {
  return (
    /\bax-?bi\s+mcp\b/i.test(prompt) &&
    /\b(chart|charts|bar|scatter|graph|plot|visuali[sz]e|table)\b/i.test(
      prompt
    )
  )
}

function isAxBiDashboardRequest(
  prompt: string,
  attachments: Attachment[] | undefined
): boolean {
  if (!DASHBOARD_INTENT.test(prompt)) return false
  if (!ATTACHED_FILE_INTENT.test(prompt)) return false
  return Boolean(
    attachments?.some((attachment) => {
      if (attachment.type !== 'document') return false
      const fileType = normalizeFileType(attachment)
      return (
        SUPPORTED_DATA_TYPES.has(fileType) || PRESENTATION_TYPES.has(fileType)
      )
    })
  )
}

function isAxBiSdkPromptRequest(prompt: string): boolean {
  return (
    /\b(?:ax-?bi|axbi)\b/i.test(prompt) &&
    /\b(?:prompt|plan|dashboard|chart|charts|analytics|report|visuali[sz]e|business intelligence)\b/i.test(
      prompt
    )
  )
}

function pickDataAttachment(attachments: Attachment[]): Attachment | undefined {
  return attachments.find((attachment) => {
    if (attachment.type !== 'document') return false
    const fileType = normalizeFileType(attachment)
    return (
      SUPPORTED_DATA_TYPES.has(fileType) || PRESENTATION_TYPES.has(fileType)
    )
  })
}

function columnName(column: DatasetColumn): string | undefined {
  return column.column_name || column.name
}

function isNumericColumn(column: DatasetColumn): boolean {
  const type = (column.type || '').toLowerCase()
  return /\b(int|float|double|decimal|numeric|number|real|long|short|bigint)\b/.test(
    type
  )
}

function isDateColumn(column: DatasetColumn): boolean {
  if (column.is_dttm) return true
  const type = (column.type || '').toLowerCase()
  const name = (columnName(column) || '').toLowerCase()
  return (
    /\b(date|time|timestamp|datetime)\b/.test(type) ||
    /(^|_)(date|time|year|month)(_|$)/.test(name)
  )
}

function isLikelyCategory(column: DatasetColumn): boolean {
  const name = (columnName(column) || '').toLowerCase()
  if (isDateColumn(column) || isNumericColumn(column)) return false
  return (
    /\b(country|region|territory|state|city|product|category|status|segment|line|type|name)\b/.test(
      name
    ) || Boolean(columnName(column))
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
        all_columns: tableColumns,
        groupby: [],
        query_mode: 'raw',
        row_limit: 1000,
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
          y: [
            {
              name: numericName,
              aggregate: 'SUM',
              label: `SUM(${numericName})`,
            },
          ],
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
          y: [
            {
              name: numericName,
              aggregate: 'SUM',
              label: `SUM(${numericName})`,
            },
          ],
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
    extractId(result.chart_id) ??
    extractId(result.id) ??
    extractId(result.slice_id)
  )
}

function dashboardUrlFromResult(result: DashboardResult): string | undefined {
  return result.dashboard_url || result.url || undefined
}

function getServerUrlFromMcpConfig(config: unknown): string | undefined {
  if (!isRecord(config)) return undefined
  const mcpServers = config.mcpServers
  if (!isRecord(mcpServers)) return undefined
  const axBi = mcpServers[AX_BI_SERVER]
  if (!isRecord(axBi) || typeof axBi.url !== 'string') return undefined
  return axBi.url
}

async function createAxBiSdkClient(serviceHub: ServiceHub): Promise<AxBI> {
  const configuredMcpUrl = getServerUrlFromMcpConfig(
    await serviceHub
      .mcp()
      .getMCPConfig()
      .catch(() => null)
  )
  const baseUrl = configuredMcpUrl
    ? configuredMcpUrl.replace(/\/mcp\/?$/i, '').replace(/\/+$/, '')
    : 'http://127.0.0.1:8088'

  return new AxBI({
    baseUrl,
    mcpUrl: baseUrl,
    auth: { type: 'token', accessToken: '' },
  })
}

function formatDashboardPlan(plan: DashboardPlan): string {
  const lines = [
    `AX-BI generated a dashboard plan: ${plan.title || 'Untitled dashboard'}`,
  ]
  if (plan.description) lines.push('', plan.description)

  const sections = Array.isArray(plan.sections) ? plan.sections : []
  if (sections.length > 0) {
    lines.push('', 'Sections:')
    for (const section of sections) {
      lines.push(`- ${section.title || 'Untitled section'}`)
      const chartIntents = Array.isArray(section.chart_intents)
        ? section.chart_intents
        : []
      for (const chart of chartIntents.slice(0, 4)) {
        const dimension = chart.dimension ? ` by ${chart.dimension}` : ''
        lines.push(`  - ${chart.chart_type}: ${chart.metric}${dimension}`)
      }
    }
  }

  if (plan.assumptions?.length) {
    lines.push(
      '',
      'Assumptions:',
      ...plan.assumptions.map((item) => `- ${item}`)
    )
  }

  if (plan.clarifying_questions?.length) {
    lines.push(
      '',
      'Clarifying questions:',
      ...plan.clarifying_questions.map((item) => `- ${item}`)
    )
  }

  if (typeof plan.confidence_score === 'number') {
    const confidence =
      plan.confidence_score <= 1
        ? plan.confidence_score * 100
        : plan.confidence_score
    lines.push('', `Confidence: ${Math.round(confidence)}%`)
  }

  return lines.join('\n')
}

export async function runAxBiSdkPromptWorkflow({
  prompt,
  serviceHub,
  client,
}: {
  prompt: string
  serviceHub: ServiceHub
  client?: AxBiSdkClient
}): Promise<AxBiSdkPromptWorkflowResult> {
  if (!isAxBiSdkPromptRequest(prompt)) return { handled: false }

  const axbi = client ?? (await createAxBiSdkClient(serviceHub))
  const plan = await axbi.ai.planDashboard({ prompt })

  return {
    handled: true,
    plan,
    message: formatDashboardPlan(plan),
  }
}

function collectRecords(
  value: unknown,
  records: Record<string, unknown>[] = []
): Record<string, unknown>[] {
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

function findDatasetRecord(
  result: unknown,
  datasetName: string
): Record<string, unknown> | undefined {
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

function lookupVariants(value: string): string[] {
  const compact = normalizeColumnLookup(value)
  const variants = new Set([compact])

  if (/^(?:table|party)\s+size$/i.test(value.trim())) {
    variants.add('size')
  }
  if (/^meal\s+time$/i.test(value.trim())) {
    variants.add('time')
  }

  return [...variants].filter(Boolean)
}

function findColumn(
  columns: DatasetColumn[],
  requestedName: string
): DatasetColumn | undefined {
  const requested = requestedName.toLowerCase()
  const variants = lookupVariants(requestedName)
  const exactMatch = columns.find((column) => {
    const name = columnName(column)
    if (!name) return false
    const normalizedName = normalizeColumnLookup(name)
    return name.toLowerCase() === requested || variants.includes(normalizedName)
  })
  if (exactMatch) return exactMatch

  return columns.find((column) => {
    const name = columnName(column)
    if (!name) return false
    const normalizedName = normalizeColumnLookup(name)
    return variants.some(
      (variant) =>
        variant.length >= 4 &&
        (normalizedName.endsWith(variant) || normalizedName.includes(variant))
    )
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
  if (intent.chartKind === 'big_number') {
    const resolvedFilters = resolveIntentFilters(intent.filters, columns)
    if (intent.metric.type === 'count') {
      return { ...intent, filters: resolvedFilters }
    }

    const metricColumn = findColumn(columns, intent.metric.column)
    if (!metricColumn || !columnName(metricColumn)) {
      throw new Error(
        `Dataset "${intent.datasetName}" does not contain metric column "${intent.metric.column}".`
      )
    }
    if (!isNumericColumn(metricColumn)) {
      throw new Error(
        `Column "${columnName(metricColumn)}" is not numeric, so ${intent.metric.aggregate} cannot be used for this KPI.`
      )
    }

    return {
      ...intent,
      filters: resolvedFilters,
      metric: {
        ...intent.metric,
        column: columnName(metricColumn)!,
      },
    }
  }

  if (intent.chartKind === 'table') {
    const resolvedFilters = resolveIntentFilters(intent.filters, columns)
    const resolvedColumns = intent.columns.map((requestedColumn) => {
      const matchedColumn = findColumn(columns, requestedColumn)
      if (!matchedColumn || !columnName(matchedColumn)) {
        throw new Error(
          `Dataset "${intent.datasetName}" does not contain table column "${requestedColumn}".`
        )
      }
      return columnName(matchedColumn)!
    })

    return {
      ...intent,
      columns: resolvedColumns,
      filters: resolvedFilters,
    }
  }

  if (intent.chartKind === 'scatter') {
    const resolvedFilters = resolveIntentFilters(intent.filters, columns)
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
      filters: resolvedFilters,
    }
  }

  const resolvedFilters = resolveIntentFilters(intent.filters, columns)
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
      filters: resolvedFilters,
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
    filters: resolvedFilters,
    metric: {
      ...intent.metric,
      column: columnName(metricColumn)!,
    },
  }
}

function resolveIntentFilters(
  filters: AxBiChartFilter[] | undefined,
  columns: DatasetColumn[]
): AxBiChartFilter[] | undefined {
  if (!filters?.length) return undefined

  return filters.map((filter) => {
    const filterColumn = findColumn(columns, filter.column)
    if (!filterColumn || !columnName(filterColumn)) {
      throw new Error(`Dataset does not contain filter column "${filter.column}".`)
    }

    return {
      ...filter,
      column: columnName(filterColumn)!,
    }
  })
}

function applyCommonChartOptions(
  config: Record<string, unknown>,
  options: AxBiChartOptions | undefined,
  supported: {
    colorScheme?: boolean
    rowLimit?: number
    showValues?: boolean
  }
): void {
  if (!options) return

  if (supported.colorScheme && options.colorScheme) {
    config.color_scheme = options.colorScheme
  }

  if (supported.rowLimit && options.rowLimit) {
    config.row_limit = Math.min(options.rowLimit, supported.rowLimit)
  }

  if (supported.showValues && options.showValues) {
    config.show_value = true
  }
}

function applyChartFilters(
  config: Record<string, unknown>,
  filters: AxBiChartFilter[] | undefined
): void {
  if (!filters?.length) return
  config.filters = filters.map((filter) => ({
    column: filter.column,
    op: filter.op,
    value: filter.value,
  }))
}

function buildExistingDatasetChartConfig(
  intent: ResolvedExistingDatasetChartIntent
): Record<string, unknown> {
  const metricConfig =
    'metric' in intent
      ? intent.metric.type === 'count'
        ? { sql_expression: 'COUNT(*)', label: 'Count' }
        : {
            name: intent.metric.column,
            aggregate: intent.metric.aggregate,
            label: `${intent.metric.aggregate}(${intent.metric.column})`,
          }
      : null

  if (intent.chartKind === 'big_number') {
    const config = {
      chart_type: 'big_number',
      metric: metricConfig,
      subheader:
        intent.metric.type === 'count'
          ? 'COUNT(*)'
          : `${intent.metric.aggregate}(${intent.metric.column})`,
    }
    applyChartFilters(config, intent.filters)
    applyCommonChartOptions(config, intent.options, { colorScheme: true })
    return config
  }

  if (intent.chartKind === 'table') {
    const tableColumns = intent.columns.map((name) => ({ name }))
    const config = {
      chart_type: 'table',
      query_mode: 'raw',
      columns: tableColumns,
      all_columns: tableColumns,
      groupby: [],
      row_limit: 1000,
    }
    applyChartFilters(config, intent.filters)
    applyCommonChartOptions(config, intent.options, {
      colorScheme: true,
      rowLimit: 50000,
    })
    return config
  }

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
    applyChartFilters(config, intent.filters)
    applyCommonChartOptions(config, intent.options, {
      colorScheme: true,
      rowLimit: 50000,
    })
    return config
  }

  const yMetric = metricConfig!

  if (intent.chartKind === 'pie' || intent.chartKind === 'donut') {
    const config = {
      chart_type: 'pie',
      dimension: { name: intent.groupBy },
      metric: yMetric,
      donut: intent.chartKind === 'donut',
      show_labels: true,
      label_type: 'key_value_percent',
      show_legend: true,
      color_scheme: 'supersetColors',
    }
    applyChartFilters(config, intent.filters)
    applyCommonChartOptions(config, intent.options, {
      colorScheme: true,
      rowLimit: 10000,
    })
    return config
  }

  const config = {
    chart_type: 'xy',
    x: { name: intent.groupBy },
    y: [yMetric],
    kind: intent.chartKind === 'horizontal_bar' ? 'bar' : intent.chartKind,
    orientation:
      intent.chartKind === 'horizontal_bar' ? 'horizontal' : 'vertical',
    x_axis: { title: humanize(intent.groupBy) },
    y_axis: {
      title:
        intent.metric.type === 'count'
          ? 'Count'
        : `${intent.metric.aggregate}(${humanize(intent.metric.column)})`,
    },
  }
  applyChartFilters(config, intent.filters)
  applyCommonChartOptions(config, intent.options, {
    colorScheme: true,
    rowLimit: 50000,
    showValues: true,
  })
  return config
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
  const chartUrl =
    typeof chartRecord?.url === 'string' ? chartRecord.url : undefined
  if (chartUrl) return chartUrl

  const id =
    result.slice_id ??
    result.chart_id ??
    chart?.slice_id ??
    result.id ??
    chart?.id
  return id != null
    ? `http://127.0.0.1:8080/explore/?slice_id=${id}`
    : undefined
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
  const dashboardIntent = parseExistingDatasetDashboardIntent(prompt)
  let intent =
    isAxBiChartCandidate(prompt) && intentExtractor
      ? normalizeChartIntentDraft(await intentExtractor(prompt))
      : null
  intent ??= parseExistingDatasetChartIntent(prompt)
  if (!intent && !dashboardIntent) return { handled: false }

  const tools = await serviceHub.mcp().getTools()
  const toolNames = axBiToolNames(tools)
  const requiredTools = [
    'list_datasets',
    'get_dataset_info',
    'generate_chart',
    ...(dashboardIntent ? ['generate_dashboard'] : []),
  ]
  for (const required of requiredTools) {
    if (!canCallAxBiTool(toolNames, required)) {
      throw new Error(
        `AX-BI MCP is connected, but the required tool "${required}" is not available directly or through the "call_tool" proxy. Please restart the AX-BI MCP service and reconnect it in Ax Studio.`
      )
    }
  }

  const datasetName = dashboardIntent?.datasetName ?? intent!.datasetName
  const datasetList = await callAxBiTool({
    serviceHub,
    toolNames,
    toolName: 'list_datasets',
    arguments: {
      request: {
        search: datasetName,
        page: 1,
        page_size: 20,
        select_columns: ['id', 'table_name', 'schema', 'database_name', 'url'],
      },
    },
  })
  const parsedDatasetList =
    parseJsonToolResult<Record<string, unknown>>(datasetList)
  const dataset = findDatasetRecord(parsedDatasetList, datasetName)
  const rawDatasetId = dataset?.id
  const datasetId =
    typeof rawDatasetId === 'number' || typeof rawDatasetId === 'string'
      ? rawDatasetId
      : undefined
  if (datasetId == null) {
    throw new Error(`Could not find AX-BI dataset "${datasetName}".`)
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
  const parsedDatasetInfo =
    parseJsonToolResult<Record<string, unknown>>(datasetInfoResult)
  const columns = datasetColumnsFromResult(parsedDatasetInfo)
  if (columns.length === 0) {
    throw new Error(
      `Could not read columns for AX-BI dataset "${datasetName}".`
    )
  }

  if (dashboardIntent) {
    const chartPlans = buildChartPlans({
      id: datasetId,
      table_name:
        typeof dataset?.table_name === 'string'
          ? dataset.table_name
          : dashboardIntent.datasetName,
      columns,
    })
    if (chartPlans.length === 0) {
      return {
        handled: true,
        message: `AX-BI found dataset "${dashboardIntent.datasetName}", but I could not identify usable columns for dashboard charts.`,
      }
    }

    const chartIds: number[] = []
    for (const plan of chartPlans) {
      const chart = await callAxBiTool({
        serviceHub,
        toolNames,
        toolName: 'generate_chart',
        arguments: {
          request: {
            dataset_id: datasetId,
            chart_name: `${dashboardIntent.dashboardTitle} - ${plan.name}`,
            config: plan.config,
            save_chart: true,
            generate_preview: false,
          },
        },
      })
      const chartResult = parseJsonToolResult<ChartResult>(chart)
      if (chartResult.error) {
        console.warn(
          '[AX-BI] Dashboard chart generation failed',
          plan.name,
          chartResult.error
        )
        continue
      }
      const chartId = chartIdFromResult(chartResult)
      if (!chartId) continue

      if (toolNames.has('update_chart')) {
        try {
          await callAxBiTool({
            serviceHub,
            toolNames,
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
      throw new Error('AX-BI found the dataset, but no dashboard charts could be saved.')
    }

    const dashboard = await callAxBiTool({
      serviceHub,
      toolNames,
      toolName: 'generate_dashboard',
      arguments: {
        request: {
          chart_ids: chartIds,
          dashboard_title: dashboardIntent.dashboardTitle,
          description: `Generated from ${dashboardIntent.datasetName} via Ax Studio.`,
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
      chartUrl: dashboardUrl,
      message: dashboardUrl
        ? `Created AX-BI dashboard "${dashboardIntent.dashboardTitle}" with ${chartIds.length} saved chart${chartIds.length === 1 ? '' : 's'}.\n\nDashboard URL: ${dashboardUrl}`
        : `Created AX-BI dashboard "${dashboardIntent.dashboardTitle}" with ${chartIds.length} saved chart${chartIds.length === 1 ? '' : 's'}, but AX-BI did not return a dashboard URL.`,
    }
  }

  const resolvedIntent = validateAndResolveIntentColumns(intent!, columns)

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
  for (const required of [
    'upload_file',
    'generate_chart',
    'generate_dashboard',
  ]) {
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
      console.warn(
        '[AX-BI] Chart generation failed',
        plan.name,
        chartResult.error
      )
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
