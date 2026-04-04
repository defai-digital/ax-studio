import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TrustedHostsInput } from '../TrustedHostsInput'

const mockSetTrustedHosts = vi.fn()
let mockTrustedHosts: string[] = []

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    trustedHosts: mockTrustedHosts,
    setTrustedHosts: mockSetTrustedHosts,
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
    <input data-testid="hosts-input" {...props} />
  ),
}))

describe('TrustedHostsInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTrustedHosts = []
  })

  it('renders with empty value when no trusted hosts', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    expect(input).toHaveAttribute('value', '')
  })

  it('renders with comma-separated hosts', () => {
    mockTrustedHosts = ['localhost', '192.168.1.1']
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    expect(input).toHaveAttribute('value', 'localhost, 192.168.1.1')
  })

  it('parses and deduplicates hosts on blur', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, {
      target: { value: 'host1, host2, host1, host3' },
    })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith([
      'host1',
      'host2',
      'host3',
    ])
  })

  it('filters out empty strings from hosts', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, {
      target: { value: 'host1, , , host2' },
    })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith(['host1', 'host2'])
  })

  it('trims whitespace from individual hosts', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, {
      target: { value: '  host1  ,  host2  ' },
    })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith(['host1', 'host2'])
  })

  it('sets empty array when input is cleared', () => {
    mockTrustedHosts = ['host1']
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith([])
  })

  it('applies disabled styling when isServerRunning', () => {
    render(<TrustedHostsInput isServerRunning />)
    const input = screen.getByTestId('hosts-input')
    expect(input.className).toContain('opacity-50')
    expect(input.className).toContain('pointer-events-none')
  })

  it('has the correct placeholder', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    expect(input).toHaveAttribute('placeholder', 'common:enterTrustedHosts')
  })

  it('accepts valid hostnames', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, {
      target: { value: 'example.com, api.example.com' },
    })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith([
      'example.com',
      'api.example.com',
    ])
  })

  it('accepts valid IPv4 addresses', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, {
      target: { value: '192.168.1.1, 127.0.0.1, 0.0.0.0' },
    })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith([
      '192.168.1.1',
      '127.0.0.1',
      '0.0.0.0',
    ])
  })

  it('accepts localhost', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, {
      target: { value: 'localhost' },
    })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith(['localhost'])
  })

  it('accepts hostnames with port numbers', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, {
      target: { value: 'localhost:3000, example.com:8080, 192.168.1.1:443' },
    })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith([
      'localhost:3000',
      'example.com:8080',
      '192.168.1.1:443',
    ])
  })

  it('filters out invalid host entries', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, {
      target: { value: 'example.com, !!!invalid, 192.168.1.1' },
    })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith([
      'example.com',
      '192.168.1.1',
    ])
  })

  it('filters out hostnames with invalid characters', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, {
      target: { value: 'example.com, http://bad.com, <script>' },
    })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith(['example.com'])
  })

  it('filters out entries with schemes', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByTestId('hosts-input')
    fireEvent.change(input, {
      target: { value: 'https://example.com, example.com' },
    })
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalledWith(['example.com'])
  })
})
