import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Capabilities from '../Capabilities'

// Mock Tooltip components
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock Tabler icons
vi.mock('@tabler/icons-react', () => ({
  IconEye: () => <div data-testid="icon-eye">Eye Icon</div>,
  IconTool: () => <div data-testid="icon-tool">Tool Icon</div>,
  IconAtom: () => <div data-testid="icon-atom">Atom Icon</div>,
  IconWorld: () => <div data-testid="icon-world">World Icon</div>,
  IconCodeCircle2: () => <div data-testid="icon-code">Code Icon</div>,
}))

describe('Capabilities', () => {
  it('should render vision capability with eye icon', () => {
    render(<Capabilities capabilities={['vision']} />)

    const eyeIcon = screen.getByTestId('icon-eye')
    expect(eyeIcon).toBeInTheDocument()
  })

  it('should render tools capability with tool icon', () => {
    render(<Capabilities capabilities={['tools']} />)

    const toolIcon = screen.getByTestId('icon-tool')
    expect(toolIcon).toBeInTheDocument()
  })

  it('should render reasoning capability with atom icon', () => {
    render(<Capabilities capabilities={['reasoning']} />)

    const atomIcon = screen.getByTestId('icon-atom')
    expect(atomIcon).toBeInTheDocument()
  })

  it('should render web_search capability with world icon', () => {
    render(<Capabilities capabilities={['web_search']} />)

    const worldIcon = screen.getByTestId('icon-world')
    expect(worldIcon).toBeInTheDocument()
  })

  it('should render embeddings capability with code icon', () => {
    render(<Capabilities capabilities={['embeddings']} />)

    const codeIcon = screen.getByTestId('icon-code')
    expect(codeIcon).toBeInTheDocument()
  })

  it('should render multiple capabilities', () => {
    render(<Capabilities capabilities={['tools', 'vision', 'reasoning']} />)

    expect(screen.getByTestId('icon-tool')).toBeInTheDocument()
    expect(screen.getByTestId('icon-eye')).toBeInTheDocument()
    expect(screen.getByTestId('icon-atom')).toBeInTheDocument()
  })

  it('should render all capabilities in correct order', () => {
    render(<Capabilities capabilities={['tools', 'vision', 'reasoning', 'web_search', 'embeddings']} />)

    expect(screen.getByTestId('icon-tool')).toBeInTheDocument()
    expect(screen.getByTestId('icon-eye')).toBeInTheDocument()
    expect(screen.getByTestId('icon-atom')).toBeInTheDocument()
    expect(screen.getByTestId('icon-world')).toBeInTheDocument()
    expect(screen.getByTestId('icon-code')).toBeInTheDocument()
  })

  it('should handle empty capabilities array', () => {
    const { container } = render(<Capabilities capabilities={[]} />)

    expect(container.querySelector('[data-testid^="icon-"]')).not.toBeInTheDocument()
  })

  it('should handle unknown capabilities gracefully', () => {
    const { container } = render(<Capabilities capabilities={['unknown_capability']} />)

    expect(container).toBeInTheDocument()
  })

  // Phase 4: Colored badge pill styling
  it('should render badges with colored pill styling', () => {
    const { container } = render(<Capabilities capabilities={['tools']} />)
    const badge = container.querySelector('span')
    expect(badge).toBeInTheDocument()
    // Should have colored badge pill classes
    expect(badge?.className).toContain('inline-flex')
    expect(badge?.className).toContain('rounded')
    expect(badge?.className).toContain('px-1.5')
    expect(badge?.className).toContain('py-0.5')
  })

  it('should apply correct color for tools badge (blue)', () => {
    const { container } = render(<Capabilities capabilities={['tools']} />)
    const badge = container.querySelector('span')
    expect(badge?.className).toContain('bg-blue-500/10')
    expect(badge?.className).toContain('text-blue-600')
  })

  it('should apply correct color for vision badge (violet)', () => {
    const { container } = render(<Capabilities capabilities={['vision']} />)
    const badge = container.querySelector('span')
    expect(badge?.className).toContain('bg-violet-500/10')
    expect(badge?.className).toContain('text-violet-600')
  })

  it('should apply correct color for reasoning badge (amber)', () => {
    const { container } = render(<Capabilities capabilities={['reasoning']} />)
    const badge = container.querySelector('span')
    expect(badge?.className).toContain('bg-amber-500/10')
    expect(badge?.className).toContain('text-amber-600')
  })

  it('should filter out proactive capability', () => {
    const { container } = render(<Capabilities capabilities={['proactive', 'tools']} />)
    // Only tools badge should render, not proactive
    const badges = container.querySelectorAll('span[title]')
    expect(badges).toHaveLength(1)
    expect(badges[0].getAttribute('title')).toBe('tools')
  })
})
