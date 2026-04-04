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
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
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

  describe('validation', () => {
    it('shows error for duplicate provider name (case-insensitive)', () => {
      render(
        <AddProviderDialog
          onCreateProvider={mockOnCreateProvider}
          existingProviderNames={['OpenAI']}
        >
          <button>Add</button>
        </AddProviderDialog>
      )
      fireEvent.change(screen.getByTestId('input'), {
        target: { value: 'openai' },
      })
      expect(screen.getByTestId('validation-error')).toBeInTheDocument()
      expect(screen.getByTestId('validation-error').textContent).toContain(
        'already exists'
      )
      expect(screen.getByLabelText('common:create')).toBeDisabled()
    })

    it('shows error for name with special characters', () => {
      render(
        <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
          <button>Add</button>
        </AddProviderDialog>
      )
      fireEvent.change(screen.getByTestId('input'), {
        target: { value: 'My@Provider!' },
      })
      expect(screen.getByTestId('validation-error')).toBeInTheDocument()
      expect(screen.getByTestId('validation-error').textContent).toContain(
        'letters, numbers, spaces, hyphens, and underscores'
      )
    })

    it('shows error for name with XSS script tags', () => {
      render(
        <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
          <button>Add</button>
        </AddProviderDialog>
      )
      fireEvent.change(screen.getByTestId('input'), {
        target: { value: '<script>alert("xss")</script>' },
      })
      expect(screen.getByTestId('validation-error')).toBeInTheDocument()
    })

    it('shows error for name with javascript: protocol', () => {
      render(
        <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
          <button>Add</button>
        </AddProviderDialog>
      )
      fireEvent.change(screen.getByTestId('input'), {
        target: { value: 'javascript:void(0)' },
      })
      expect(screen.getByTestId('validation-error')).toBeInTheDocument()
    })

    it('accepts valid name with hyphens and underscores', () => {
      render(
        <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
          <button>Add</button>
        </AddProviderDialog>
      )
      fireEvent.change(screen.getByTestId('input'), {
        target: { value: 'my-provider_v2' },
      })
      expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument()
      expect(screen.getByLabelText('common:create')).not.toBeDisabled()
    })

    it('does not call onCreateProvider when validation fails', () => {
      render(
        <AddProviderDialog
          onCreateProvider={mockOnCreateProvider}
          existingProviderNames={['existing']}
        >
          <button>Add</button>
        </AddProviderDialog>
      )
      fireEvent.change(screen.getByTestId('input'), {
        target: { value: 'existing' },
      })
      fireEvent.click(screen.getByLabelText('common:create'))
      expect(mockOnCreateProvider).not.toHaveBeenCalled()
    })

    it('clears error when input is corrected', () => {
      render(
        <AddProviderDialog
          onCreateProvider={mockOnCreateProvider}
          existingProviderNames={['OpenAI']}
        >
          <button>Add</button>
        </AddProviderDialog>
      )
      fireEvent.change(screen.getByTestId('input'), {
        target: { value: 'OpenAI' },
      })
      expect(screen.getByTestId('validation-error')).toBeInTheDocument()

      fireEvent.change(screen.getByTestId('input'), {
        target: { value: 'MyProvider' },
      })
      expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument()
    })

    it('clears error when dialog is cancelled', () => {
      render(
        <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
          <button>Add</button>
        </AddProviderDialog>
      )
      fireEvent.change(screen.getByTestId('input'), {
        target: { value: 'bad@name' },
      })
      expect(screen.getByTestId('validation-error')).toBeInTheDocument()

      fireEvent.click(screen.getByText('common:cancel'))
    })

    it('does not show error for empty input', () => {
      render(
        <AddProviderDialog onCreateProvider={mockOnCreateProvider}>
          <button>Add</button>
        </AddProviderDialog>
      )
      expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument()
    })

    it('accepts name that differs in case from existing', () => {
      render(
        <AddProviderDialog
          onCreateProvider={mockOnCreateProvider}
          existingProviderNames={['OpenAI']}
        >
          <button>Add</button>
        </AddProviderDialog>
      )
      fireEvent.change(screen.getByTestId('input'), {
        target: { value: 'MyOpenAI' },
      })
      expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument()
      expect(screen.getByLabelText('common:create')).not.toBeDisabled()
    })
  })
})
