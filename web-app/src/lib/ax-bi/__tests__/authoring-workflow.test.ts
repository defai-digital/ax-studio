import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceHub } from '@/services'
import { runAxBiAuthoringWorkflow } from '../authoring-workflow'

const readFileBase64 = vi.hoisted(() => vi.fn())

vi.mock('@ax-studio/core', () => ({
  fs: { readFileBase64 },
}))

function createClient() {
  return {
    ai: {
      createChartFromIntent: vi.fn(),
      planDashboard: vi.fn(),
      promptToDashboard: vi.fn(),
      uploadAndPlan: vi.fn(),
    },
  }
}

const serviceHub = {} as ServiceHub

const plan = {
  plan_id: 'plan-1',
  title: 'Revenue dashboard',
  description: 'Revenue health and trends',
  sections: [
    {
      title: 'Overview',
      chart_intents: [
        {
          chart_type: 'xy',
          purpose: 'Monthly revenue',
          metrics: ['SUM(revenue)'],
          dimensions: ['month'],
        },
      ],
    },
  ],
}

describe('runAxBiAuthoringWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readFileBase64.mockResolvedValue('base64-data')
  })

  it('does not intercept generic diagrams or non-AX-BI chart requests', async () => {
    const client = createClient()

    await expect(
      runAxBiAuthoringWorkflow({
        prompt: 'Create a system architecture diagram',
        serviceHub,
        client,
      })
    ).resolves.toEqual({ handled: false })
    await expect(
      runAxBiAuthoringWorkflow({
        prompt: 'Create a chart',
        serviceHub,
        client,
      })
    ).resolves.toEqual({ handled: false })

    expect(client.ai.createChartFromIntent).not.toHaveBeenCalled()
  })

  it('delegates chart authoring without building a local chart config', async () => {
    const client = createClient()
    client.ai.createChartFromIntent.mockResolvedValue({
      success: true,
      chart_name: 'Monthly Revenue',
      chart_type_selected: 'echarts_timeseries_line',
      explanation: 'A time series shows the trend.',
      confidence: 0.91,
      preview_url: 'http://127.0.0.1:8088/superset/explore/?slice_id=7',
    })

    const result = await runAxBiAuthoringWorkflow({
      prompt: 'Use AX BI to create a monthly revenue chart',
      serviceHub,
      client,
    })

    expect(client.ai.createChartFromIntent).toHaveBeenCalledWith({
      prompt: 'Use AX BI to create a monthly revenue chart',
      dataset_id: undefined,
      save_chart: true,
    })
    expect(result).toMatchObject({
      handled: true,
      delegated: true,
      artifactType: 'chart',
      status: 'completed',
      artifactUrl: 'http://127.0.0.1:8088/explore/?slice_id=7',
    })
  })

  it('uses AX BI plan_dashboard for a dashboard dry run', async () => {
    const client = createClient()
    client.ai.planDashboard.mockResolvedValue({ plan, warnings: [] })

    const result = await runAxBiAuthoringWorkflow({
      prompt: 'Plan an AX BI dashboard for revenue',
      serviceHub,
      client,
    })

    expect(client.ai.planDashboard).toHaveBeenCalledWith({
      prompt: 'Plan an AX BI dashboard for revenue',
      dataset_candidates: [],
    })
    expect(client.ai.promptToDashboard).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      handled: true,
      artifactType: 'plan',
      status: 'dry_run',
      plan,
    })
  })

  it('delegates dashboard creation and returns the trusted AX BI URL', async () => {
    const client = createClient()
    client.ai.promptToDashboard.mockResolvedValue({
      status: 'completed',
      plan,
      dashboard_url: 'http://127.0.0.1:8088/superset/dashboard/12/',
      charts_succeeded: 3,
      charts_failed: 0,
    })

    const result = await runAxBiAuthoringWorkflow({
      prompt: 'Use AX BI to create a revenue dashboard',
      serviceHub,
      client,
    })

    expect(client.ai.promptToDashboard).toHaveBeenCalledWith({
      prompt: 'Use AX BI to create a revenue dashboard',
      dataset_ids: [],
    })
    expect(result).toMatchObject({
      handled: true,
      delegated: true,
      artifactType: 'dashboard',
      status: 'completed',
      artifactUrl: 'http://127.0.0.1:8088/ax-bi/dashboard/12/',
    })
  })

  it('uploads structured data through AX BI and pins its dataset ID', async () => {
    const client = createClient()
    client.ai.uploadAndPlan.mockResolvedValue({
      dataset: { id: 42, table_name: 'sales' },
      plan,
      warnings: [],
    })
    client.ai.promptToDashboard.mockResolvedValue({
      status: 'completed',
      plan,
    })

    await runAxBiAuthoringWorkflow({
      prompt: 'Create a dashboard from this file',
      attachments: [
        {
          name: 'sales.csv',
          type: 'document',
          fileType: 'csv',
          path: '/tmp/sales.csv',
        },
      ],
      serviceHub,
      client,
    })

    expect(readFileBase64).toHaveBeenCalledWith('/tmp/sales.csv')
    expect(client.ai.uploadAndPlan).toHaveBeenCalledWith({
      file_content: 'base64-data',
      filename: 'sales.csv',
      prompt: 'Create a dashboard from this file',
    })
    expect(client.ai.promptToDashboard).toHaveBeenCalledWith({
      prompt: 'Create a dashboard from this file',
      dataset_ids: [42],
    })
  })

  it('reuses the authoritative upload plan for attachment plan-only requests', async () => {
    const client = createClient()
    client.ai.uploadAndPlan.mockResolvedValue({
      dataset: { id: 42 },
      plan,
      warnings: ['Review the inferred metric.'],
    })

    const result = await runAxBiAuthoringWorkflow({
      prompt: 'Plan a dashboard from this file',
      attachments: [
        {
          name: 'sales.xlsx',
          type: 'document',
          path: '/tmp/sales.xlsx',
        },
      ],
      serviceHub,
      client,
    })

    expect(client.ai.planDashboard).not.toHaveBeenCalled()
    expect(client.ai.promptToDashboard).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      handled: true,
      artifactType: 'plan',
      status: 'dry_run',
      plan,
    })
  })

  it('blocks presentation uploads without calling AX BI', async () => {
    const client = createClient()

    const result = await runAxBiAuthoringWorkflow({
      prompt: 'Create an AX BI dashboard from this presentation',
      attachments: [
        {
          name: 'review.pptx',
          type: 'document',
          path: '/tmp/review.pptx',
        },
      ],
      serviceHub,
      client,
    })

    expect(result).toMatchObject({
      handled: true,
      status: 'blocked',
    })
    expect(client.ai.uploadAndPlan).not.toHaveBeenCalled()
  })

  it('lets the dedicated workspace force delegation while preserving chart intent', async () => {
    const client = createClient()
    client.ai.createChartFromIntent.mockResolvedValue({
      success: true,
      chart_name: 'Sales',
    })

    await runAxBiAuthoringWorkflow({
      prompt: 'Create a sales chart',
      serviceHub,
      force: true,
      client,
    })

    expect(client.ai.createChartFromIntent).toHaveBeenCalledOnce()
    expect(client.ai.promptToDashboard).not.toHaveBeenCalled()
  })

  it('projects AX BI transport errors into a stable handled result', async () => {
    const client = createClient()
    client.ai.createChartFromIntent.mockRejectedValue(
      new Error('MCP service unavailable')
    )

    const result = await runAxBiAuthoringWorkflow({
      prompt: 'Use AX BI to create a sales chart',
      serviceHub,
      client,
    })

    expect(result).toEqual({
      handled: true,
      delegated: true,
      artifactType: 'chart',
      status: 'failed',
      message: 'AX BI authoring failed: MCP service unavailable',
    })
  })
})
