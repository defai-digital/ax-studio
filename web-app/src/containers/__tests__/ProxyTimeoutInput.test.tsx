import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProxyTimeoutInput } from '../ProxyTimeoutInput'

const mockSetProxyTimeout = vi.fn()
let mockProxyTimeout = 600

vi.mock('@/hooks/settings/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    proxyTimeout: mockProxyTimeout,
    setProxyTimeout: mockSetProxyTimeout,
  }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input data-testid="timeout-input" {...props} />
  ),
}))

describe('ProxyTimeoutInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProxyTimeout = 600
  })

  it('renders with the current timeout value', () => {
    render(<ProxyTimeoutInput />)
    const input = screen.getByTestId('timeout-input')
    expect(input).toHaveAttribute('value', '600')
  })

  it('accepts valid timeout on blur', () => {
    render(<ProxyTimeoutInput />)
    const input = screen.getByTestId('timeout-input')
    fireEvent.change(input, { target: { value: '300' } })
    fireEvent.blur(input)
    expect(mockSetProxyTimeout).toHaveBeenCalledWith(300)
  })

  it('resets to current value on blur for timeout > 86400', () => {
    render(<ProxyTimeoutInput />)
    const input = screen.getByTestId('timeout-input')
    fireEvent.change(input, { target: { value: '100000' } })
    fireEvent.blur(input)
    expect(mockSetProxyTimeout).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('value', '600')
  })

  it('resets to current value on blur for negative timeout', () => {
    render(<ProxyTimeoutInput />)
    const input = screen.getByTestId('timeout-input')
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.blur(input)
    expect(mockSetProxyTimeout).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('value', '600')
  })

  it('resets to current value on blur for non-numeric input', () => {
    render(<ProxyTimeoutInput />)
    const input = screen.getByTestId('timeout-input')
    fireEvent.change(input, { target: { value: 'xyz' } })
    fireEvent.blur(input)
    expect(mockSetProxyTimeout).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('value', '600')
  })

  it('accepts 0 as a valid timeout', () => {
    render(<ProxyTimeoutInput />)
    const input = screen.getByTestId('timeout-input')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    expect(mockSetProxyTimeout).toHaveBeenCalledWith(0)
  })

  it('accepts 86400 as valid max timeout', () => {
    render(<ProxyTimeoutInput />)
    const input = screen.getByTestId('timeout-input')
    fireEvent.change(input, { target: { value: '86400' } })
    fireEvent.blur(input)
    expect(mockSetProxyTimeout).toHaveBeenCalledWith(86400)
  })

  it('applies disabled styling when isServerRunning', () => {
    render(<ProxyTimeoutInput isServerRunning />)
    const input = screen.getByTestId('timeout-input')
    expect(input.className).toContain('opacity-50')
    expect(input.className).toContain('pointer-events-none')
  })
})
