import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/hooks/useArtifactPanel', () => ({
  useArtifactPanel: vi.fn((selector) =>
    selector({
      pinArtifact: vi.fn(),
    })
  ),
}))

vi.mock('@/components/ai-elements/ArtifactPreview', () => ({
  ArtifactPreview: ({ type, source }: { type: string; source: string }) => (
    <div data-testid="artifact-preview" data-type={type}>
      {source}
    </div>
  ),
}))

import { ArtifactBlock } from './ArtifactBlock'
import { useArtifactPanel } from '@/hooks/useArtifactPanel'

describe('ArtifactBlock', () => {
  const defaultProps = {
    type: 'html' as const,
    source: '<div>Hello</div>',
    children: <div data-testid="code-children">Code output</div>,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('renders with type label badge', () => {
    render(<ArtifactBlock {...defaultProps} />)
    expect(screen.getByText('HTML')).toBeInTheDocument()
  })

  it('renders all type labels correctly', () => {
    const types = [
      { type: 'html' as const, label: 'HTML' },
      { type: 'react' as const, label: 'React' },
      { type: 'svg' as const, label: 'SVG' },
      { type: 'chartjs' as const, label: 'Chart.js' },
      { type: 'vega' as const, label: 'Vega-Lite' },
    ]
    for (const { type, label } of types) {
      const { unmount } = render(
        <ArtifactBlock {...defaultProps} type={type} />
      )
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('renders Code and Preview tab buttons', () => {
    render(<ArtifactBlock {...defaultProps} />)
    expect(screen.getByText('Code')).toBeInTheDocument()
    expect(screen.getByText('Preview')).toBeInTheDocument()
  })

  it('starts on preview tab by default', () => {
    render(<ArtifactBlock {...defaultProps} />)
    expect(screen.getByTestId('artifact-preview')).toBeInTheDocument()
    expect(screen.queryByTestId('code-children')).toBeNull()
  })

  it('switches to code tab on click', () => {
    render(<ArtifactBlock {...defaultProps} />)
    fireEvent.click(screen.getByText('Code'))
    expect(screen.getByTestId('code-children')).toBeInTheDocument()
    expect(screen.queryByTestId('artifact-preview')).toBeNull()
  })

  it('switches back to preview tab on click', () => {
    render(<ArtifactBlock {...defaultProps} />)
    fireEvent.click(screen.getByText('Code'))
    fireEvent.click(screen.getByText('Preview'))
    expect(screen.getByTestId('artifact-preview')).toBeInTheDocument()
    expect(screen.queryByTestId('code-children')).toBeNull()
  })

  it('renders Copy button', () => {
    render(<ArtifactBlock {...defaultProps} />)
    expect(screen.getByText('Copy')).toBeInTheDocument()
  })

  it('copies source on Copy click', async () => {
    render(<ArtifactBlock {...defaultProps} />)
    await act(async () => {
      fireEvent.click(screen.getByText('Copy'))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      '<div>Hello</div>'
    )
  })

  it('shows "Copied" text after copy', async () => {
    render(<ArtifactBlock {...defaultProps} />)
    await act(async () => {
      fireEvent.click(screen.getByText('Copy'))
    })
    expect(screen.getByText('Copied')).toBeInTheDocument()
  })

  it('renders Panel button when threadId is provided', () => {
    render(<ArtifactBlock {...defaultProps} threadId="thread-1" />)
    expect(screen.getByText('Panel')).toBeInTheDocument()
  })

  it('does not render Panel button when threadId is absent', () => {
    render(<ArtifactBlock {...defaultProps} />)
    expect(screen.queryByText('Panel')).toBeNull()
  })

  it('calls pinArtifact when Panel button is clicked', () => {
    const mockPinArtifact = vi.fn()
    vi.mocked(useArtifactPanel).mockImplementation((selector) =>
      selector({
        pinArtifact: mockPinArtifact,
      } as never)
    )

    render(<ArtifactBlock {...defaultProps} threadId="thread-1" />)
    fireEvent.click(screen.getByText('Panel'))
    expect(mockPinArtifact).toHaveBeenCalledWith(
      'thread-1',
      'html',
      '<div>Hello</div>'
    )
  })

  it('passes correct props to ArtifactPreview', () => {
    render(<ArtifactBlock {...defaultProps} />)
    const preview = screen.getByTestId('artifact-preview')
    expect(preview.getAttribute('data-type')).toBe('html')
    expect(preview.textContent).toBe('<div>Hello</div>')
  })
})
