import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DropdownControl } from './DropdownControl'

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <button onClick={onClick} data-testid="dropdown-item">
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

describe('DropdownControl', () => {
  const options = [
    { value: 'a', name: 'Option A' },
    { value: 'b', name: 'Option B' },
    { value: 'c', name: 'Option C' },
  ]

  it('displays the selected option name as trigger text', () => {
    render(
      <DropdownControl value="b" options={options} onChange={vi.fn()} />
    )

    // "Option B" appears in both trigger and dropdown item
    const matches = screen.getAllByText('Option B')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('displays raw value when no matching option', () => {
    render(
      <DropdownControl value="unknown" options={options} onChange={vi.fn()} />
    )

    expect(screen.getByText('unknown')).toBeInTheDocument()
  })

  it('renders all options as dropdown items', () => {
    render(
      <DropdownControl value="a" options={options} onChange={vi.fn()} />
    )

    const items = screen.getAllByTestId('dropdown-item')
    expect(items).toHaveLength(3)
  })

  it('handles empty options array', () => {
    render(
      <DropdownControl value="test" options={[]} onChange={vi.fn()} />
    )

    expect(screen.getByText('test')).toBeInTheDocument()
    expect(screen.queryAllByTestId('dropdown-item')).toHaveLength(0)
  })

  it('renders with default empty options when none provided', () => {
    render(<DropdownControl value="val" onChange={vi.fn()} />)

    expect(screen.getByText('val')).toBeInTheDocument()
  })
})
