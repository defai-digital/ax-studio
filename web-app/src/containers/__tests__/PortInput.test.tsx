import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PortInput } from '../PortInput'

const mockSetServerPort = vi.fn()
let mockServerPort = 1337

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    serverPort: mockServerPort,
    setServerPort: mockSetServerPort,
  }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input data-testid="port-input" {...props} />
  ),
}))

describe('PortInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockServerPort = 1337
  })

  it('renders with the current port value', () => {
    render(<PortInput />)
    const input = screen.getByTestId('port-input')
    expect(input).toHaveAttribute('value', '1337')
  })

  it('accepts a valid port on blur', () => {
    render(<PortInput />)
    const input = screen.getByTestId('port-input')
    fireEvent.change(input, { target: { value: '8080' } })
    fireEvent.blur(input)
    expect(mockSetServerPort).toHaveBeenCalledWith(8080)
  })

  it('resets to current value on blur for invalid port (too high)', () => {
    render(<PortInput />)
    const input = screen.getByTestId('port-input')
    fireEvent.change(input, { target: { value: '99999' } })
    fireEvent.blur(input)
    expect(mockSetServerPort).not.toHaveBeenCalled()
    // input should be reset to current port
    expect(input).toHaveAttribute('value', '1337')
  })

  it('resets to current value on blur for non-numeric input', () => {
    render(<PortInput />)
    const input = screen.getByTestId('port-input')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)
    expect(mockSetServerPort).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('value', '1337')
  })

  it('accepts port 0', () => {
    render(<PortInput />)
    const input = screen.getByTestId('port-input')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    expect(mockSetServerPort).toHaveBeenCalledWith(0)
  })

  it('accepts port 65535', () => {
    render(<PortInput />)
    const input = screen.getByTestId('port-input')
    fireEvent.change(input, { target: { value: '65535' } })
    fireEvent.blur(input)
    expect(mockSetServerPort).toHaveBeenCalledWith(65535)
  })

  it('rejects negative ports', () => {
    render(<PortInput />)
    const input = screen.getByTestId('port-input')
    fireEvent.change(input, { target: { value: '-1' } })
    fireEvent.blur(input)
    expect(mockSetServerPort).not.toHaveBeenCalled()
  })

  it('applies disabled styling when isServerRunning', () => {
    render(<PortInput isServerRunning />)
    const input = screen.getByTestId('port-input')
    expect(input.className).toContain('opacity-50')
    expect(input.className).toContain('pointer-events-none')
  })
})
