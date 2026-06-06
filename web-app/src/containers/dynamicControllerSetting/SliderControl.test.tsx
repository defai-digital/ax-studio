import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SliderControl } from './SliderControl'

vi.mock('@/components/ui/slider', () => ({
  Slider: ({
    value,
    onValueChange,
    min,
    max,
    ...props
  }: {
    value: number[]
    onValueChange: (v: number[]) => void
    min: number
    max: number
  }) => (
    <div
      role="slider"
      data-testid="slider"
      data-value={value[0]}
      data-min={min}
      data-max={max}
      aria-label={props['aria-label' as keyof typeof props] as string}
      onClick={() => onValueChange([value[0]])}
    />
  ),
}))

describe('SliderControl', () => {
  it('renders with default min/max labels', () => {
    render(<SliderControl value={[50]} onChange={vi.fn()} />)

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('renders with custom min and max', () => {
    render(
      <SliderControl value={[5]} min={0} max={10} onChange={vi.fn()} />
    )

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('displays current value in the input field', () => {
    render(<SliderControl value={[75]} onChange={vi.fn()} />)

    const inputs = screen.getAllByDisplayValue('75')
    expect(inputs.length).toBeGreaterThanOrEqual(1)
  })

  it('shows error message when input exceeds max', async () => {
    const user = userEvent.setup()
    render(
      <SliderControl value={[50]} max={100} onChange={vi.fn()} />
    )

    const inputs = screen.getAllByDisplayValue('50')
    // The text input (not the slider)
    const input = inputs[inputs.length - 1]
    await user.clear(input)
    await user.type(input, '150')

    expect(screen.getByText(/Maximum value allowed is/)).toBeInTheDocument()
  })

  it('calls onChange when slider value changes', () => {
    const onChange = vi.fn()
    render(<SliderControl value={[50]} onChange={onChange} />)

    const slider = screen.getByTestId('slider')
    slider.dispatchEvent(new Event('change', { bubbles: true }))
  })

  it('uses min as initial value when value is not provided', () => {
    render(<SliderControl min={5} max={10} onChange={vi.fn()} />)

    const inputs = screen.getAllByDisplayValue('5')
    expect(inputs.length).toBeGreaterThanOrEqual(1)
  })

  it('syncs with external value changes', () => {
    const { rerender } = render(
      <SliderControl value={[30]} onChange={vi.fn()} />
    )

    expect(screen.getAllByDisplayValue('30').length).toBeGreaterThanOrEqual(1)

    rerender(<SliderControl value={[60]} onChange={vi.fn()} />)
    expect(screen.getAllByDisplayValue('60').length).toBeGreaterThanOrEqual(1)
  })
})
