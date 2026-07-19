import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxBiWorkspace } from '../AxBiWorkspace'
import { useAxBiSessions } from '@/stores/ax-bi-session-store'
import {
  connectAxBiMcpServer,
  hasConfiguredAxBiMcpToken,
} from '@/lib/ax-bi/datasets'

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
  DEFAULT_AX_BI_MCP_URL: 'http://127.0.0.1:31421/mcp',
  connectAxBiMcpServer: vi.fn().mockResolvedValue('http://127.0.0.1:31421/mcp'),
  hasConfiguredAxBiMcpToken: vi.fn().mockResolvedValue(false),
  getConfiguredAxBiMcpUrl: vi.fn().mockResolvedValue('http://127.0.0.1:31421/mcp'),
  listAxBiDatasets: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/ax-bi/authoring-workflow', () => ({
  runAxBiAuthoringWorkflow: vi.fn(),
}))

describe('AxBiWorkspace Open result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openUrl.mockClear()
    vi.mocked(connectAxBiMcpServer).mockResolvedValue(
      'http://127.0.0.1:31421/mcp'
    )
    vi.mocked(hasConfiguredAxBiMcpToken).mockResolvedValue(false)
    useAxBiSessions.getState().reset()
    const session = useAxBiSessions.getState().createSession({
      title: 'Smoke analysis',
      prompt: 'Create a saved donut chart',
    })
    useAxBiSessions.getState().recordRun(session.id, {
      status: 'ready',
      prompt: 'Create a saved donut chart',
      message:
        'Created saved AX BI chart "Smoke - Sex Split".\n\nChart URL: http://localhost:31423/explore/?slice_id=1',
      url: 'http://localhost:31423/explore/?slice_id=1',
    })
  })

  it('opens chart result URLs through the opener service instead of target=_blank', async () => {
    render(<AxBiWorkspace />)

    await waitFor(() =>
      expect(hasConfiguredAxBiMcpToken).toHaveBeenCalledTimes(1)
    )

    const link = screen.getByRole('link', { name: 'Open result' })
    expect(link).toHaveAttribute('href', 'http://localhost:31423/explore/?slice_id=1')

    fireEvent.click(link)

    expect(openUrl).toHaveBeenCalledTimes(1)
    expect(openUrl).toHaveBeenCalledWith(
      'http://localhost:31423/explore/?slice_id=1'
    )
  })

  it('requires and forwards the full AX BI token when connecting', async () => {
    render(<AxBiWorkspace />)

    const connectButton = screen.getByRole('button', { name: 'Connect' })
    await waitFor(() => expect(connectButton).toBeDisabled())

    const tokenInput = screen.getByLabelText('AX BI API key or JWT')
    expect(tokenInput).toHaveAttribute('type', 'password')
    fireEvent.change(tokenInput, {
      target: { value: 'sst_full-secret-token' },
    })
    expect(connectButton).toBeEnabled()
    fireEvent.click(connectButton)

    await waitFor(() =>
      expect(connectAxBiMcpServer).toHaveBeenCalledWith({
        serviceHub: expect.anything(),
        url: 'http://127.0.0.1:31421/mcp',
        token: 'sst_full-secret-token',
      })
    )
    await waitFor(() => expect(tokenInput).toHaveValue(''))
  })

  it('allows reconnecting with an existing encrypted token', async () => {
    vi.mocked(hasConfiguredAxBiMcpToken).mockResolvedValue(true)
    render(<AxBiWorkspace />)

    const connectButton = screen.getByRole('button', { name: 'Connect' })
    await waitFor(() => expect(connectButton).toBeEnabled())
    expect(screen.getByLabelText('AX BI API key or JWT')).toHaveAttribute(
      'placeholder',
      'Token encrypted locally — leave blank to reuse'
    )
  })
})
