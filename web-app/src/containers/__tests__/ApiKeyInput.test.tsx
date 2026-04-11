import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiKeyInput } from '../ApiKeyInput'

const mockSetApiKey = vi.fn()
let mockApiKey = ''

vi.mock('@/hooks/settings/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    apiKey: mockApiKey,
    setApiKey: mockSetApiKey,
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input data-testid="api-key-input" {...props} />
  ),
}))

describe('ApiKeyInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiKey = ''
  })

  it('renders a password input by default', () => {
    render(<ApiKeyInput />)
    const input = screen.getByTestId('api-key-input')
    expect(input).toHaveAttribute('type', 'password')
  })

  it('toggles password visibility when eye button is clicked', () => {
    render(<ApiKeyInput />)
    const input = screen.getByTestId('api-key-input')
    const toggleBtn = screen.getByRole('button')

    expect(input).toHaveAttribute('type', 'password')
    fireEvent.click(toggleBtn)
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.click(toggleBtn)
    expect(input).toHaveAttribute('type', 'password')
  })

  it('calls setApiKey on blur', () => {
    render(<ApiKeyInput />)
    const input = screen.getByTestId('api-key-input')
    fireEvent.change(input, { target: { value: 'sk-test-key' } })
    fireEvent.blur(input)
    expect(mockSetApiKey).toHaveBeenCalledWith('sk-test-key')
  })

  it('shows error when showError is true and value is empty', () => {
    const onValidationChange = vi.fn()
    render(
      <ApiKeyInput showError onValidationChange={onValidationChange} />
    )
    expect(screen.getByText('common:apiKeyRequired')).toBeInTheDocument()
    expect(onValidationChange).toHaveBeenCalledWith(false)
  })

  it('clears error when user types a non-empty value', () => {
    const onValidationChange = vi.fn()
    render(
      <ApiKeyInput showError onValidationChange={onValidationChange} />
    )
    expect(screen.getByText('common:apiKeyRequired')).toBeInTheDocument()

    const input = screen.getByTestId('api-key-input')
    fireEvent.change(input, { target: { value: 'key' } })
    expect(screen.queryByText('common:apiKeyRequired')).not.toBeInTheDocument()
    expect(onValidationChange).toHaveBeenCalledWith(true)
  })

  it('does not show error when showError is false', () => {
    render(<ApiKeyInput showError={false} />)
    expect(screen.queryByText('common:apiKeyRequired')).not.toBeInTheDocument()
  })

  it('applies disabled styling when isServerRunning', () => {
    render(<ApiKeyInput isServerRunning />)
    const input = screen.getByTestId('api-key-input')
    expect(input.className).toContain('opacity-50')
    expect(input.className).toContain('pointer-events-none')
  })

  it('initializes input value from hook state', () => {
    mockApiKey = 'existing-key'
    render(<ApiKeyInput />)
    const input = screen.getByTestId('api-key-input')
    expect(input).toHaveAttribute('value', 'existing-key')
  })

  it('validates on blur when showError is true', () => {
    const onValidationChange = vi.fn()
    render(
      <ApiKeyInput showError onValidationChange={onValidationChange} />
    )
    const input = screen.getByTestId('api-key-input')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onValidationChange).toHaveBeenCalledWith(false)
  })
})
