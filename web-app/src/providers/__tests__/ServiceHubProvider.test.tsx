import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceHubProvider } from '../ServiceHubProvider'

const mockInitializeServiceHub = vi.fn()
const mockInitializeServiceHubStore = vi.fn()

vi.mock('@/services', () => ({
  initializeServiceHub: (...args: unknown[]) => mockInitializeServiceHub(...args),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(),
  getServiceHub: vi.fn(),
  initializeServiceHubStore: (...args: unknown[]) => mockInitializeServiceHubStore(...args),
  isServiceHubInitialized: () => true,
}))

describe('ServiceHubProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing while initializing', () => {
    // Never resolve so it stays in loading state
    mockInitializeServiceHub.mockReturnValue(new Promise(() => {}))

    const { container } = render(
      <ServiceHubProvider>
        <div data-testid="child">Child Content</div>
      </ServiceHubProvider>
    )

    expect(container.innerHTML).toBe('')
  })

  it('renders children after successful initialization', async () => {
    const mockHub = { test: true }
    mockInitializeServiceHub.mockResolvedValue(mockHub)

    render(
      <ServiceHubProvider>
        <div data-testid="child">Child Content</div>
      </ServiceHubProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    expect(mockInitializeServiceHubStore).toHaveBeenCalledWith(mockHub)
  })

  it('renders error UI when initialization fails', async () => {
    mockInitializeServiceHub.mockRejectedValue(new Error('Connection failed'))

    render(
      <ServiceHubProvider>
        <div data-testid="child">Child Content</div>
      </ServiceHubProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('AX Studio failed to initialize')).toBeInTheDocument()
    })

    expect(screen.getByText('Connection failed')).toBeInTheDocument()
  })

  it('renders error UI with generic message for non-Error rejections', async () => {
    mockInitializeServiceHub.mockRejectedValue('some string error')

    render(
      <ServiceHubProvider>
        <div data-testid="child">Child Content</div>
      </ServiceHubProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('AX Studio failed to initialize')).toBeInTheDocument()
    })

    expect(screen.getByText('Unknown error')).toBeInTheDocument()
  })

  it('does not render children when initialization fails', async () => {
    mockInitializeServiceHub.mockRejectedValue(new Error('fail'))

    render(
      <ServiceHubProvider>
        <div data-testid="child">Child Content</div>
      </ServiceHubProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('AX Studio failed to initialize')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('shows restart instructions in error state', async () => {
    mockInitializeServiceHub.mockRejectedValue(new Error('timeout'))

    render(
      <ServiceHubProvider>
        <div>child</div>
      </ServiceHubProvider>
    )

    await waitFor(() => {
      expect(
        screen.getByText('Service startup failed. Please restart the app.')
      ).toBeInTheDocument()
    })
  })
})
