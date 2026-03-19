import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---

vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="hover-card">{children}</div>
  ),
  HoverCardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="hover-card-content">{children}</div>
  ),
  HoverCardTrigger: ({
    children,
    onMouseEnter,
  }: {
    children: React.ReactNode
    onMouseEnter?: () => void
  }) => (
    <div data-testid="hover-card-trigger" onMouseEnter={onMouseEnter}>
      {children}
    </div>
  ),
}))

vi.mock('@tabler/icons-react', () => ({
  IconInfoCircle: ({ size }: { size: number }) => (
    <span data-testid="info-icon" data-size={size} />
  ),
}))

import { ModelInfoHoverCard } from '../ModelInfoHoverCard'

describe('ModelInfoHoverCard', () => {
  const defaultModel = {
    model_name: 'test/model-7b',
    description: 'Test model',
    downloads: 100,
    developer: 'test',
    quants: [
      { model_id: 'test/model-7b-q4_k_m', path: '/path', file_size: '4GB' },
      { model_id: 'test/model-7b-q8_0', path: '/path2', file_size: '8GB' },
    ],
    tools: true,
    num_mmproj: 1,
  }

  const defaultProps = {
    model: defaultModel,
    defaultModelQuantizations: ['q4_k_m'],
    modelSupportStatus: {} as Record<string, string>,
    onCheckModelSupport: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders info icon by default when no children', () => {
    render(<ModelInfoHoverCard {...defaultProps} />)

    expect(screen.getByTestId('info-icon')).toBeInTheDocument()
  })

  it('renders custom children when provided', () => {
    render(
      <ModelInfoHoverCard {...defaultProps}>
        <button data-testid="custom-trigger">Info</button>
      </ModelInfoHoverCard>
    )

    expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
  })

  it('shows model name for default variant', () => {
    render(
      <ModelInfoHoverCard {...defaultProps} isDefaultVariant />
    )

    expect(screen.getByText('test/model-7b')).toBeInTheDocument()
    expect(screen.getByText('Model Information')).toBeInTheDocument()
  })

  it('shows variant model_id for non-default variant', () => {
    const variant = {
      model_id: 'test/model-7b-q8_0',
      path: '/path2',
      file_size: '8GB',
    }

    render(
      <ModelInfoHoverCard
        {...defaultProps}
        variant={variant}
        isDefaultVariant={false}
      />
    )

    expect(screen.getByText('test/model-7b-q8_0')).toBeInTheDocument()
    expect(screen.getByText('Model Variant Information')).toBeInTheDocument()
  })

  it('calls onCheckModelSupport on mouse enter', () => {
    render(<ModelInfoHoverCard {...defaultProps} />)

    fireEvent.mouseEnter(screen.getByTestId('hover-card-trigger'))
    expect(defaultProps.onCheckModelSupport).toHaveBeenCalledWith(
      defaultModel.quants[0]
    )
  })

  it('displays GREEN compatibility status', () => {
    render(
      <ModelInfoHoverCard
        {...defaultProps}
        modelSupportStatus={{ 'test/model-7b-q4_k_m': 'GREEN' }}
      />
    )

    expect(
      screen.getByText('Recommended for your device')
    ).toBeInTheDocument()
  })

  it('displays YELLOW compatibility status', () => {
    render(
      <ModelInfoHoverCard
        {...defaultProps}
        modelSupportStatus={{ 'test/model-7b-q4_k_m': 'YELLOW' }}
      />
    )

    expect(
      screen.getByText('May be slow on your device')
    ).toBeInTheDocument()
  })

  it('displays RED compatibility status', () => {
    render(
      <ModelInfoHoverCard
        {...defaultProps}
        modelSupportStatus={{ 'test/model-7b-q4_k_m': 'RED' }}
      />
    )

    expect(
      screen.getByText('May be incompatible with your device')
    ).toBeInTheDocument()
  })

  it('displays LOADING compatibility status', () => {
    render(
      <ModelInfoHoverCard
        {...defaultProps}
        modelSupportStatus={{ 'test/model-7b-q4_k_m': 'LOADING' }}
      />
    )

    expect(screen.getByText('Checking...')).toBeInTheDocument()
  })

  it('displays GREY compatibility status', () => {
    render(
      <ModelInfoHoverCard
        {...defaultProps}
        modelSupportStatus={{ 'test/model-7b-q4_k_m': 'GREY' }}
      />
    )

    expect(
      screen.getByText(
        'Unable to determine model compatibility with your current device'
      )
    ).toBeInTheDocument()
  })

  it('displays Unknown for unrecognized status', () => {
    render(<ModelInfoHoverCard {...defaultProps} />)

    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('shows quantization extracted from variant model_id', () => {
    const variant = {
      model_id: 'model-q4_k_m',
      path: '/p',
      file_size: '4G',
    }

    render(
      <ModelInfoHoverCard {...defaultProps} variant={variant} />
    )

    // Last segment after '-' uppercased
    expect(screen.getByText('Q4_K_M')).toBeInTheDocument()
  })

  it('renders Tools feature tag when model has tools', () => {
    render(<ModelInfoHoverCard {...defaultProps} />)

    expect(screen.getByText('Tools')).toBeInTheDocument()
  })

  it('renders Vision feature tag when model has mmproj', () => {
    render(<ModelInfoHoverCard {...defaultProps} />)

    expect(screen.getByText('Vision')).toBeInTheDocument()
  })

  it('renders Proactive feature tag when model has both tools and mmproj', () => {
    render(<ModelInfoHoverCard {...defaultProps} />)

    expect(screen.getByText('Proactive')).toBeInTheDocument()
  })

  it('does not render features section when model has no tools or mmproj', () => {
    const simpleModel = {
      ...defaultModel,
      tools: false,
      num_mmproj: 0,
    }

    render(
      <ModelInfoHoverCard {...defaultProps} model={simpleModel} />
    )

    expect(screen.queryByText('Features')).not.toBeInTheDocument()
    expect(screen.queryByText('Tools')).not.toBeInTheDocument()
  })

  it('uses isDefaultVariant size for info icon', () => {
    render(
      <ModelInfoHoverCard {...defaultProps} isDefaultVariant />
    )

    expect(screen.getByTestId('info-icon')).toHaveAttribute(
      'data-size',
      '20'
    )
  })
})
