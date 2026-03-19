import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiPrefixInput } from '../ApiPrefixInput'

const mockSetApiPrefix = vi.fn()

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    apiPrefix: '/v1',
    setApiPrefix: mockSetApiPrefix,
  }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input data-testid="prefix-input" {...props} />
  ),
}))

describe('ApiPrefixInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with the current api prefix value', () => {
    render(<ApiPrefixInput />)
    const input = screen.getByTestId('prefix-input')
    expect(input).toHaveAttribute('value', '/v1')
  })

  it('updates local state on change', () => {
    render(<ApiPrefixInput />)
    const input = screen.getByTestId('prefix-input')
    fireEvent.change(input, { target: { value: '/v2' } })
    expect(input).toHaveAttribute('value', '/v2')
  })

  it('prepends slash on blur if missing', () => {
    render(<ApiPrefixInput />)
    const input = screen.getByTestId('prefix-input')
    fireEvent.change(input, { target: { value: 'api' } })
    fireEvent.blur(input)
    expect(mockSetApiPrefix).toHaveBeenCalledWith('/api')
  })

  it('does not double-prepend slash on blur', () => {
    render(<ApiPrefixInput />)
    const input = screen.getByTestId('prefix-input')
    fireEvent.change(input, { target: { value: '/api' } })
    fireEvent.blur(input)
    expect(mockSetApiPrefix).toHaveBeenCalledWith('/api')
  })

  it('trims whitespace on blur', () => {
    render(<ApiPrefixInput />)
    const input = screen.getByTestId('prefix-input')
    fireEvent.change(input, { target: { value: '  v2  ' } })
    fireEvent.blur(input)
    expect(mockSetApiPrefix).toHaveBeenCalledWith('/v2')
  })

  it('applies disabled styling when isServerRunning', () => {
    render(<ApiPrefixInput isServerRunning />)
    const input = screen.getByTestId('prefix-input')
    expect(input.className).toContain('opacity-50')
    expect(input.className).toContain('pointer-events-none')
  })

  it('has placeholder /v1', () => {
    render(<ApiPrefixInput />)
    const input = screen.getByTestId('prefix-input')
    expect(input).toHaveAttribute('placeholder', '/v1')
  })
})
