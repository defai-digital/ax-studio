import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockStreamingTokenSpeed = 0
let mockStreamingTokenCount = 0

vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      tokenSpeed: mockStreamingTokenSpeed > 0
        ? { tokenSpeed: mockStreamingTokenSpeed, tokenCount: mockStreamingTokenCount }
        : null,
    }),
}))

vi.mock('@/utils/number', () => ({
  toNumber: (val: unknown) => {
    const num = Number(val)
    return isNaN(num) ? 0 : num
  },
}))

vi.mock('lucide-react', () => ({
  Gauge: () => <span data-testid="gauge-icon" />,
}))

// Import after mocks
import { TokenSpeedIndicator } from './TokenSpeedIndicator'

describe('TokenSpeedIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStreamingTokenSpeed = 0
    mockStreamingTokenCount = 0
  })

  it('renders nothing when displaySpeed is 0 and not streaming', () => {
    const { container } = render(<TokenSpeedIndicator metadata={{}} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders speed and token count from persisted metadata', () => {
    const metadata = {
      tokenSpeed: { tokenSpeed: 42, tokenCount: 100, durationMs: 5000 },
      usage: { outputTokens: 100 },
    }
    render(<TokenSpeedIndicator metadata={metadata} />)
    expect(screen.getByText('42 t/s')).toBeInTheDocument()
    expect(screen.getByText(/100 tokens/)).toBeInTheDocument()
  })

  it('renders streaming token speed when streaming is true', () => {
    mockStreamingTokenSpeed = 55
    mockStreamingTokenCount = 200
    render(<TokenSpeedIndicator streaming metadata={{}} />)
    expect(screen.getByText('55 t/s')).toBeInTheDocument()
    expect(screen.getByText(/200 tokens/)).toBeInTheDocument()
  })

  it('renders nothing when non-streaming assistant parameter stream=false', () => {
    const metadata = {
      assistant: { parameters: { stream: false } },
      tokenSpeed: { tokenSpeed: 42, tokenCount: 100 },
    }
    const { container } = render(<TokenSpeedIndicator metadata={metadata} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders gauge icon when speed is shown', () => {
    const metadata = {
      tokenSpeed: { tokenSpeed: 10, tokenCount: 50 },
      usage: { outputTokens: 50 },
    }
    render(<TokenSpeedIndicator metadata={metadata} />)
    expect(screen.getByTestId('gauge-icon')).toBeInTheDocument()
  })

  it('does not show token count when it is 0', () => {
    mockStreamingTokenSpeed = 30
    mockStreamingTokenCount = 0
    render(<TokenSpeedIndicator streaming metadata={{}} />)
    expect(screen.getByText('30 t/s')).toBeInTheDocument()
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument()
  })

  it('uses outputTokens from usage when not streaming', () => {
    const metadata = {
      tokenSpeed: { tokenSpeed: 20, tokenCount: 0 },
      usage: { outputTokens: 75 },
    }
    render(<TokenSpeedIndicator metadata={metadata} />)
    expect(screen.getByText('20 t/s')).toBeInTheDocument()
    expect(screen.getByText(/75 tokens/)).toBeInTheDocument()
  })
})
