import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DialogAddModel } from '../AddModel'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts?.provider ? `${key} [${opts.provider}]` : key,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    updateProvider: vi.fn(),
  }),
}))

vi.mock('@/hooks/useProviderModels', () => ({
  useProviderModels: () => ({
    models: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/utils', () => ({
  getProviderTitle: (p: string) => p,
}))

vi.mock('@/lib/models', () => ({
  getModelCapabilities: () => ({}),
}))

vi.mock('@tabler/icons-react', () => ({
  IconPlus: () => <span data-testid="icon-plus" />,
}))

vi.mock('@/containers/ModelCombobox', () => ({
  ModelCombobox: ({ value, onChange, placeholder }: Record<string, unknown>) => (
    <input
      data-testid="model-combobox"
      value={value as string}
      onChange={(e) => (onChange as (v: string) => void)(e.target.value)}
      placeholder={placeholder as string}
    />
  ),
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
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
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

describe('DialogAddModel', () => {
  const mockProvider: ModelProvider = {
    provider: 'openai',
    base_url: 'https://api.openai.com',
    api_key: 'sk-test',
    models: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders trigger button', () => {
    render(<DialogAddModel provider={mockProvider} />)
    expect(screen.getByTestId('icon-plus')).toBeInTheDocument()
  })

  it('renders dialog title', () => {
    render(<DialogAddModel provider={mockProvider} />)
    expect(screen.getByTestId('dialog-title').textContent).toBe(
      'providers:addModel.title'
    )
  })

  it('renders model combobox', () => {
    render(<DialogAddModel provider={mockProvider} />)
    expect(screen.getByTestId('model-combobox')).toBeInTheDocument()
  })

  it('disables add button when model id is empty', () => {
    render(<DialogAddModel provider={mockProvider} />)
    const addButton = screen.getByText('providers:addModel.addModel')
    expect(addButton).toBeDisabled()
  })

  it('renders custom trigger when provided', () => {
    render(
      <DialogAddModel
        provider={mockProvider}
        trigger={<button data-testid="custom-trigger">Add</button>}
      />
    )
    expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
  })

  it('renders explore models link when provider has explore_models_url', () => {
    const providerWithUrl = {
      ...mockProvider,
      explore_models_url: 'https://example.com/models',
    }
    render(<DialogAddModel provider={providerWithUrl} />)
    expect(screen.getByText(/providers:addModel.exploreModels/)).toBeInTheDocument()
  })
})
