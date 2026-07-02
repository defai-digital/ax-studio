import { streamText, type LanguageModel } from 'ai'
import type { AxBiChartIntentDraft } from './dashboard-workflow'

type ExtractAxBiChartIntentOptions = {
  model: LanguageModel
  prompt: string
  timeoutMs?: number
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}

function parseJsonObject(text: string): unknown {
  const stripped = stripJsonFence(text)
  try {
    return JSON.parse(stripped)
  } catch {
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    try {
      return JSON.parse(stripped.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isSupportedAggregate(
  value: string
): value is 'AVG' | 'SUM' | 'MIN' | 'MAX' {
  return ['AVG', 'SUM', 'MIN', 'MAX'].includes(value)
}

function normalizeExtractedIntent(value: unknown): AxBiChartIntentDraft | null {
  if (!isRecord(value)) return null
  if (value.unsupported === true) return null
  if (typeof value.datasetName !== 'string') return null

  if (value.chartKind === 'scatter') {
    if (typeof value.xColumn !== 'string') return null
    if (typeof value.yColumn !== 'string') return null
    return {
      datasetName: value.datasetName,
      chartKind: 'scatter',
      xColumn: value.xColumn,
      yColumn: value.yColumn,
      groupBy:
        typeof value.groupBy === 'string' && value.groupBy.trim().length > 0
          ? value.groupBy
          : undefined,
      chartName:
        typeof value.chartName === 'string' && value.chartName.trim().length > 0
          ? value.chartName
          : undefined,
    }
  }

  if (typeof value.groupBy !== 'string') return null
  if (!isRecord(value.metric)) return null

  if (value.metric.type === 'count') {
    return {
      datasetName: value.datasetName,
      groupBy: value.groupBy,
      chartKind: 'bar',
      metric: { type: 'count' },
      chartName:
        typeof value.chartName === 'string' && value.chartName.trim().length > 0
          ? value.chartName
          : undefined,
    }
  }

  if (
    value.metric.type !== 'aggregate' ||
    typeof value.metric.aggregate !== 'string' ||
    typeof value.metric.column !== 'string'
  ) {
    return null
  }
  const aggregate = value.metric.aggregate.toUpperCase()
  if (!isSupportedAggregate(aggregate)) return null

  return {
    datasetName: value.datasetName,
    groupBy: value.groupBy,
    chartKind: 'bar',
    metric: {
      type: 'aggregate',
      aggregate,
      column: value.metric.column,
    },
    chartName:
      typeof value.chartName === 'string' && value.chartName.trim().length > 0
        ? value.chartName
        : undefined,
  }
}

export async function extractAxBiChartIntentWithModel({
  model,
  prompt,
  timeoutMs = 20_000,
}: ExtractAxBiChartIntentOptions): Promise<AxBiChartIntentDraft | null> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const stream = streamText({
      model,
      system: [
        'You extract AX-BI chart intent from user requests.',
        'Return JSON only. Do not call tools. Do not explain.',
        'Support saved bar charts and saved scatter charts from an existing AX-BI dataset.',
        'If the request is not an AX-BI chart request, return {"unsupported":true}.',
        'JSON shape:',
        '{"datasetName":"dataset_name","chartName":"optional title","chartKind":"bar","groupBy":"dimension_column","metric":{"type":"count"}}',
        'or',
        '{"datasetName":"dataset_name","chartName":"optional title","chartKind":"bar","groupBy":"dimension_column","metric":{"type":"aggregate","aggregate":"AVG|SUM|MIN|MAX","column":"numeric_column"}}',
        'or',
        '{"datasetName":"dataset_name","chartName":"optional title","chartKind":"scatter","xColumn":"numeric_x_column","yColumn":"numeric_y_column","groupBy":"optional_series_column"}',
        'Map natural words as follows: average/mean -> AVG, total/sales/revenue sum -> SUM, minimum -> MIN, maximum -> MAX.',
        'For scatter charts, extract the explicit x-axis and y-axis columns. If the user says grouped by, colored by, or split by, put that column in groupBy.',
        'Keep column names exactly as the user wrote them when possible.',
      ].join('\n'),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxOutputTokens: 512,
      abortSignal: controller.signal,
    })

    let text = ''
    let reasoning = ''
    for await (const part of stream.fullStream) {
      if (part.type === 'text-delta') {
        text += (part as { type: 'text-delta'; text: string }).text ?? ''
      }
      if (part.type === 'reasoning-delta') {
        reasoning += (part as { type: 'reasoning-delta'; text: string }).text ?? ''
      }
    }

    const parsed = parseJsonObject(text.trim() || reasoning.trim())
    return normalizeExtractedIntent(parsed)
  } catch (error) {
    console.warn('[ax-bi] model intent extraction failed', error)
    return null
  } finally {
    globalThis.clearTimeout(timeout)
  }
}
