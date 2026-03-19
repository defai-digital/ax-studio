import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddProviderDialog } from '../AddProviderDialog'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      disabled={disabled as boolean}
      {...props}
    >
      {children as React.ReactNode}
    </button>
  ),
}))

describe('AddProviderDialog', () => {
  const mockOnCreateProvider = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders trigger children', () => {
    render(
      <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
        <button data-testid="trigger">Add Provider</button>
      </AddProviderDialog>
    )
    expect(screen.getByTestId('trigger')).toBeInTheDocument()
  })

  it('renders dialog title', () => {
    render(
      <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
        <button>Add</button>
      </AddProviderDialog>
    )
    expect(screen.getByTestId('dialog-title').textContent).toBe(
      'provider:addOpenAIProvider'
    )
  })

  it('renders input field', () => {
    render(
      <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
        <button>Add</button>
      </AddProviderDialog>
    )
    expect(screen.getByTestId('input')).toBeInTheDocument()
  })

  it('disables create button when name is empty', () => {
    render(
      <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
        <button>Add</button>
      </AddProviderDialog>
    )
    expect(screen.getByLabelText('common:create')).toBeDisabled()
  })

  it('enables create button when name is provided', () => {
    render(
      <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
        <button>Add</button>
      </AddProviderDialog>
    )
    fireEvent.change(screen.getByTestId('input'), {
      target: { value: 'My Provider' },
    })
    expect(screen.getByLabelText('common:create')).not.toBeDisabled()
  })

  it('calls onCreateProvider with trimmed name', () => {
    render(
      <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
        <button>Add</button>
      </AddProviderDialog>
    )
    fireEvent.change(screen.getByTestId('input'), {
      target: { value: '  My Provider  ' },
    })
    fireEvent.click(screen.getByLabelText('common:create'))
    expect(mockOnCreateProvider).toHaveBeenCalledWith('My Provider')
  })

  it('handles Enter key to submit', () => {
    render(
      <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
        <button>Add</button>
      </AddProviderDialog>
    )
    const input = screen.getByTestId('input')
    fireEvent.change(input, { target: { value: 'Enter Provider' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockOnCreateProvider).toHaveBeenCalledWith('Enter Provider')
  })
})
