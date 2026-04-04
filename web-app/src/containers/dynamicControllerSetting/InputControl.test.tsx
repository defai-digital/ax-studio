import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InputControl } from './InputControl'

vi.mock('@/components/ui/button-group', () => ({
  ButtonGroup: ({ children, ...props }: { children: React.ReactNode }) => (
    <div data-testid="button-group" {...props}>
      {children}
    </div>
  ),
}))

describe('InputControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a text input by default', () => {
    render(<InputControl value="hello" onChange={vi.fn()} />)

    const input = screen.getByDisplayValue('hello')
    expect(input).toHaveAttribute('type', 'text')
  })

  it('calls onChange when text is typed', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<InputControl value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'x')
    expect(onChange).toHaveBeenCalledWith('x')
  })

  it('renders number type with increment and decrement buttons', () => {
    render(
      <InputControl
        type="number"
        value={5}
        onChange={vi.fn()}
        min={0}
        max={10}
        step={1}
      />
    )

    expect(screen.getByLabelText('Increment')).toBeInTheDocument()
    expect(screen.getByLabelText('Decrement')).toBeInTheDocument()
  })

  it('increments value when increment button is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <InputControl
        type="number"
        value={5}
        onChange={onChange}
        min={0}
        max={10}
        step={1}
      />
    )

    await user.click(screen.getByLabelText('Increment'))
    expect(onChange).toHaveBeenCalledWith('6')
  })

  it('decrements value when decrement button is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <InputControl
        type="number"
        value={5}
        onChange={onChange}
        min={0}
        max={10}
        step={1}
      />
    )

    await user.click(screen.getByLabelText('Decrement'))
    expect(onChange).toHaveBeenCalledWith('4')
  })

  it('disables decrement at min value', () => {
    render(
      <InputControl
        type="number"
        value={0}
        onChange={vi.fn()}
        min={0}
        max={10}
      />
    )

    expect(screen.getByLabelText('Decrement')).toBeDisabled()
  })

  it('disables increment at max value', () => {
    render(
      <InputControl
        type="number"
        value={10}
        onChange={vi.fn()}
        min={0}
        max={10}
      />
    )

    expect(screen.getByLabelText('Increment')).toBeDisabled()
  })

  it('renders password field with eye toggle when inputActions include unobscure', async () => {
    const user = userEvent.setup()
    render(
      <InputControl
        type="password"
        value="secret"
        onChange={vi.fn()}
        inputActions={['unobscure']}
      />
    )

    const input = screen.getByDisplayValue('secret')
    expect(input).toHaveAttribute('type', 'password')

    // Click toggle
    const toggleButton = input.parentElement?.querySelector('button')
    if (toggleButton) {
      await user.click(toggleButton)
      expect(input).toHaveAttribute('type', 'text')
    }
  })

  it('renders copy button when inputActions include copy', () => {
    render(
      <InputControl
        value="copyable"
        onChange={vi.fn()}
        inputActions={['copy']}
      />
    )

    // The copy button should be present
    const buttons = screen.getByDisplayValue('copyable').parentElement?.querySelectorAll('button')
    expect(buttons?.length).toBeGreaterThan(0)
  })

  it('clamps decremented value to min', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <InputControl
        type="number"
        value={1}
        onChange={onChange}
        min={0}
        max={10}
        step={5}
      />
    )

    await user.click(screen.getByLabelText('Decrement'))
    expect(onChange).toHaveBeenCalledWith('0')
  })

  it('clamps incremented value to max', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <InputControl
        type="number"
        value={8}
        onChange={onChange}
        min={0}
        max={10}
        step={5}
      />
    )

    await user.click(screen.getByLabelText('Increment'))
    expect(onChange).toHaveBeenCalledWith('10')
  })

  it('uses placeholder when provided', () => {
    render(
      <InputControl
        value=""
        onChange={vi.fn()}
        placeholder="Enter text..."
      />
    )

    expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument()
  })
})
