import { fs } from '@ax-studio/core'
import type { ServiceHub } from '@/services'
import type { Attachment } from '@/types/attachment'
import { getConfiguredAxBiMcpUrl } from './datasets'
import { DEFAULT_AX_BI_WEB_URL } from './endpoints'
import {
  AxBI,
  type CreateChartFromIntentResult,
  type DashboardPlan,
  type PromptToDashboardResult,
  type UploadAndPlanResult,
} from './sdk'
import { normalizeAxBiResultUrl } from './tool-navigation'

const SUPPORTED_DATA_TYPES = new Set([
  'csv',
  'tsv',
  'xls',
  'xlsx',
  'parquet',
])
const PRESENTATION_TYPES = new Set(['ppt', 'pptx'])

const AX_BI_REFERENCE = /\bax(?:-|\s*)bi\b/i
const AUTHORING_ACTION = /\b(?:create|build|generate|make|plan|preview)\b/i
const BI_ARTIFACT = /\b(?:chart|charts|dashboard|dashboards|visuali[sz]ation|visuali[sz]ations|bi\s+report)\b/i
const DASHBOARD_ARTIFACT = /\b(?:dashboard|dashboards|bi\s+report)\b/i
const PLAN_ACTION = /\b(?:plan|dry[-\s]?run|preview)\b/i
const MUTATING_ACTION = /\b(?:create|build|generate|make|save|publish)\b/i

export type AxBiAuthoringStatus = NonNullable<
  PromptToDashboardResult['status']
>

export type AxBiAuthoringWorkflowResult =
  | { handled: false }
  | {
      handled: true
      delegated: true
      artifactType: 'chart' | 'dashboard' | 'plan'
      status: AxBiAuthoringStatus
      message: string
      artifactUrl?: string
      plan?: DashboardPlan | null
    }

type AxBiAuthoringClient = {
  ai: Pick<
    AxBI['ai'],
    | 'createChartFromIntent'
    | 'planDashboard'
    | 'promptToDashboard'
    | 'uploadAndPlan'
  >
}

export type RunAxBiAuthoringWorkflowOptions = {
  prompt: string
  serviceHub: ServiceHub
  attachments?: Attachment[]
  /** Dedicated AX BI surfaces may delegate without requiring “AX BI” in the prompt. */
  force?: boolean
  /** Test seam; production callers use the configured MCP endpoint. */
  client?: AxBiAuthoringClient
}

function normalizeFileType(attachment: Attachment): string {
  const declared = attachment.fileType?.trim().toLowerCase().replace(/^\./, '')
  if (declared) return declared
  return attachment.name.split('.').pop()?.toLowerCase() ?? ''
}

function pickDataAttachment(
  attachments: Attachment[]
): Attachment | undefined {
  return attachments.find((attachment) =>
    SUPPORTED_DATA_TYPES.has(normalizeFileType(attachment))
  )
}

function pickPresentationAttachment(
  attachments: Attachment[]
): Attachment | undefined {
  return attachments.find((attachment) =>
    PRESENTATION_TYPES.has(normalizeFileType(attachment))
  )
}

function isDelegationRequest({
  prompt,
  attachments,
  force,
}: Pick<
  RunAxBiAuthoringWorkflowOptions,
  'prompt' | 'attachments' | 'force'
>): boolean {
  if (force) return true
  if (!AUTHORING_ACTION.test(prompt) || !BI_ARTIFACT.test(prompt)) return false
  return AX_BI_REFERENCE.test(prompt) || pickDataAttachment(attachments ?? []) != null
}

async function createClient(serviceHub: ServiceHub): Promise<AxBI> {
  return new AxBI({
    baseUrl: DEFAULT_AX_BI_WEB_URL,
    mcpUrl: await getConfiguredAxBiMcpUrl(serviceHub),
    auth: { type: 'token', accessToken: '' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function datasetIdFromUpload(
  upload: UploadAndPlanResult
): number | string | undefined {
  for (const key of ['id', 'dataset_id']) {
    const value = upload.dataset?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function numericDatasetId(value: number | string): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return undefined
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!Array.isArray(value)) return undefined
  return value.find(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  )
}

function chartUrl(result: CreateChartFromIntentResult): string | undefined {
  const chart = isRecord(result.chart) ? result.chart : undefined
  const candidate =
    result.preview_url ??
    firstString(chart?.explore_url) ??
    firstString(chart?.chart_url) ??
    firstString(chart?.url)
  return candidate ? normalizeAxBiResultUrl(candidate) : undefined
}

function formatChartResult(
  result: CreateChartFromIntentResult,
  status: AxBiAuthoringStatus,
  url?: string
): string {
  const name = result.chart_name?.trim() || 'Untitled chart'
  const heading =
    status === 'failed'
      ? `AX BI could not create chart "${name}".`
      : status === 'dry_run'
        ? `AX BI prepared a chart preview for "${name}".`
        : `AX BI created chart "${name}".`
  const lines = [heading]

  if (url) lines.push('', `Chart URL: ${url}`)
  if (result.explanation) lines.push('', result.explanation)
  if (typeof result.confidence === 'number') {
    lines.push('', `Confidence: ${Math.round(result.confidence * 100)}%`)
  }
  if (result.warnings?.length) {
    lines.push('', 'Warnings:', ...result.warnings.map((item) => `- ${item}`))
  }
  if (result.alternatives?.length) {
    lines.push(
      '',
      'Alternatives:',
      ...result.alternatives.map((item) => `- ${item}`)
    )
  }
  return lines.join('\n')
}

function formatPlanChartIntent(chart: Record<string, unknown>): string {
  const chartType = firstString(chart.chart_type) ?? firstString(chart.kind)
  const metric = firstString(chart.metric) ?? firstString(chart.metrics)
  const dimension =
    firstString(chart.dimension) ?? firstString(chart.dimensions)
  const label = metric ?? firstString(chart.purpose) ?? 'Chart'
  return `${chartType ?? 'chart'}: ${label}${dimension ? ` by ${dimension}` : ''}`
}

function dashboardTitle(result: PromptToDashboardResult): string {
  if (result.plan?.title) return result.plan.title
  if (isRecord(result.dashboard)) {
    for (const key of ['dashboard_title', 'title', 'name']) {
      const value = result.dashboard[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return 'Untitled dashboard'
}

function dashboardStatus(
  result: PromptToDashboardResult
): AxBiAuthoringStatus {
  if (result.status) return result.status
  if (result.error) return 'failed'
  if (result.dashboard_url) return 'completed'
  return 'partial'
}

function formatDashboardResult(
  result: PromptToDashboardResult,
  status: AxBiAuthoringStatus,
  url?: string
): string {
  const title = dashboardTitle(result)
  const heading = {
    completed: `AX BI created dashboard "${title}".`,
    partial: `AX BI partially created dashboard "${title}".`,
    blocked: `AX BI needs more information before creating "${title}".`,
    failed: `AX BI could not create dashboard "${title}".`,
    dry_run: `AX BI completed a dry run for dashboard "${title}".`,
  }[status]
  const lines = [heading]

  if (url) lines.push('', `Dashboard URL: ${url}`)
  if (result.plan?.description) lines.push('', result.plan.description)
  for (const section of result.plan?.sections ?? []) {
    if (!lines.includes('Sections:')) lines.push('', 'Sections:')
    lines.push(`- ${section.title || 'Untitled section'}`)
    for (const chart of section.chart_intents.slice(0, 4)) {
      lines.push(`  - ${formatPlanChartIntent(chart)}`)
    }
  }
  if (result.charts_succeeded != null || result.charts_failed != null) {
    lines.push(
      '',
      `Charts: ${result.charts_succeeded ?? 0} succeeded, ${result.charts_failed ?? 0} failed`
    )
  }
  if (result.plan?.clarifying_questions?.length) {
    lines.push(
      '',
      'Clarifying questions:',
      ...result.plan.clarifying_questions.map((item) => `- ${item}`)
    )
  }
  if (result.warnings?.length) {
    lines.push('', 'Warnings:', ...result.warnings.map((item) => `- ${item}`))
  }
  if (result.error) lines.push('', `Error: ${result.error}`)
  return lines.join('\n')
}

function planResult(
  plan: DashboardPlan,
  warnings: string[] = []
): AxBiAuthoringWorkflowResult {
  const result: PromptToDashboardResult = {
    plan,
    warnings,
    status: 'dry_run',
  }
  return {
    handled: true,
    delegated: true,
    artifactType: 'plan',
    status: 'dry_run',
    plan,
    message: formatDashboardResult(result, 'dry_run'),
  }
}

async function uploadAttachment(
  client: AxBiAuthoringClient,
  attachment: Attachment,
  prompt: string
): Promise<UploadAndPlanResult> {
  if (!attachment.path) {
    throw new Error(
      `I could not upload ${attachment.name} to AX BI because the attachment path is missing.`
    )
  }
  return client.ai.uploadAndPlan({
    file_content: await fs.readFileBase64(attachment.path),
    filename: attachment.name,
    prompt,
  })
}

/**
 * Thin AX Studio adapter for AX BI analytics authoring.
 *
 * AX BI owns dataset discovery, intent parsing, chart selection, validation,
 * persistence, dashboard composition, and lineage. This adapter only detects
 * eligible requests, transports attachments, invokes the high-level contract,
 * and formats the returned result for chat/workspace UI.
 */
export async function runAxBiAuthoringWorkflow({
  prompt,
  serviceHub,
  attachments = [],
  force = false,
  client,
}: RunAxBiAuthoringWorkflowOptions): Promise<AxBiAuthoringWorkflowResult> {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt || !isDelegationRequest({ prompt, attachments, force })) {
    return { handled: false }
  }

  const presentation = pickPresentationAttachment(attachments)
  const attachment = pickDataAttachment(attachments)
  if (!attachment && presentation) {
    return {
      handled: true,
      delegated: true,
      artifactType: 'dashboard',
      status: 'blocked',
      message:
        'AX BI authoring requires structured data. Please attach CSV, TSV, Excel, or Parquet; PPT/PPTX extraction is not supported yet.',
    }
  }

  const wantsDashboard =
    DASHBOARD_ARTIFACT.test(normalizedPrompt) ||
    (force && !BI_ARTIFACT.test(normalizedPrompt))
  const planOnly =
    PLAN_ACTION.test(normalizedPrompt) && !MUTATING_ACTION.test(normalizedPrompt)
  try {
    const axbi = client ?? (await createClient(serviceHub))
    let upload: UploadAndPlanResult | undefined
    let datasetId: number | string | undefined

    if (attachment) {
      upload = await uploadAttachment(axbi, attachment, normalizedPrompt)
      datasetId = datasetIdFromUpload(upload)
      if (datasetId == null) {
        return {
          handled: true,
          delegated: true,
          artifactType: wantsDashboard ? 'dashboard' : 'chart',
          status: 'failed',
          message: [
            `AX BI could not create a dataset from ${attachment.name}.`,
            ...(upload.warnings ?? []).map((warning) => `- ${warning}`),
          ].join('\n'),
        }
      }
      if (wantsDashboard && planOnly && upload.plan) {
        return planResult(upload.plan, upload.warnings)
      }
    }

    if (!wantsDashboard) {
      const result = await axbi.ai.createChartFromIntent({
        prompt: normalizedPrompt,
        dataset_id: datasetId,
        save_chart: !planOnly,
      })
      const status: AxBiAuthoringStatus = result.success
        ? planOnly
          ? 'dry_run'
          : 'completed'
        : 'failed'
      const url = chartUrl(result)
      return {
        handled: true,
        delegated: true,
        artifactType: planOnly ? 'plan' : 'chart',
        status,
        artifactUrl: url,
        message: formatChartResult(result, status, url),
      }
    }

    if (planOnly) {
      const numericId =
        datasetId == null ? undefined : numericDatasetId(datasetId)
      const envelope = await axbi.ai.planDashboard({
        prompt: normalizedPrompt,
        dataset_candidates: numericId == null ? [] : [numericId],
      })
      return planResult(envelope.plan, [
        ...(upload?.warnings ?? []),
        ...envelope.warnings,
      ])
    }

    const numericId =
      datasetId == null ? undefined : numericDatasetId(datasetId)
    if (datasetId != null && numericId == null) {
      return {
        handled: true,
        delegated: true,
        artifactType: 'dashboard',
        status: 'failed',
        message: `AX BI uploaded the data but returned unsupported dataset ID "${datasetId}" for dashboard authoring.`,
      }
    }
    const result = await axbi.ai.promptToDashboard({
      prompt: normalizedPrompt,
      dataset_ids: numericId == null ? [] : [numericId],
    })
    const status = dashboardStatus(result)
    const url = result.dashboard_url
      ? normalizeAxBiResultUrl(result.dashboard_url)
      : undefined
    return {
      handled: true,
      delegated: true,
      artifactType: 'dashboard',
      status,
      artifactUrl: url,
      plan: result.plan ?? null,
      message: formatDashboardResult(result, status, url),
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      handled: true,
      delegated: true,
      artifactType: wantsDashboard ? 'dashboard' : planOnly ? 'plan' : 'chart',
      status: 'failed',
      message: `AX BI authoring failed: ${reason}`,
    }
  }
}
