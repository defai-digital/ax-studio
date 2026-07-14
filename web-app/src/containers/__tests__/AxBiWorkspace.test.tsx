import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxBiWorkspace } from '../AxBiWorkspace'
import { useAxBiSessions } from '@/stores/ax-bi-session-store'

const openUrl = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    opener: () => ({ openUrl }),
    mcp: () => ({
      getServers: vi.fn().mockResolvedValue({}),
      updateServers: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}))

vi.mock('@/lib/ax-bi/datasets', () => ({
  DEFAULT_AX_BI_MCP_URL: 'http://127.0.0.1:5008/mcp',
  connectAxBiMcpServer: vi.fn(),
  getConfiguredAxBiMcpUrl: vi.fn().mockResolvedValue('http://127.0.0.1:5008/mcp'),
  listAxBiDatasets: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/ax-bi/dashboard-workflow', () => ({
  runAxBiExistingDatasetChartWorkflow: vi.fn(),
  runAxBiSdkPromptWorkflow: vi.fn(),
}))

describe('AxBiWorkspace Open result', () => {
  beforeEach(() => {
    openUrl.mockClear()
    useAxBiSessions.getState().reset()
    const session = useAxBiSessions.getState().createSession({
      title: 'Smoke analysis',
      prompt: 'Create a saved donut chart',
    })
    useAxBiSessions.getState().recordRun(session.id, {
      status: 'ready',
      prompt: 'Create a saved donut chart',
      message:
        'Created saved AX BI chart "Smoke - Sex Split".\n\nChart URL: http://localhost:8088/explore/?slice_id=1',
      url: 'http://localhost:8088/explore/?slice_id=1',
    })
  })

  it('opens chart result URLs through the opener service instead of target=_blank', () => {
    render(<AxBiWorkspace />)

    const link = screen.getByRole('link', { name: 'Open result' })
    expect(link).toHaveAttribute('href', 'http://localhost:8088/explore/?slice_id=1')

    fireEvent.click(link)

    expect(openUrl).toHaveBeenCalledTimes(1)
    expect(openUrl).toHaveBeenCalledWith(
      'http://localhost:8088/explore/?slice_id=1'
    )
  })
})
