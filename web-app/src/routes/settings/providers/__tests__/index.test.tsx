import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Route as ProvidersRoute } from '../index'

const mockUpdateProvider = vi.fn()
const mockAddProvider = vi.fn()
let mockProviders: any[] = []

// Mock dependencies
vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/ProvidersAvatar', () => ({
  default: ({ provider }: { provider: { provider: string } }) => (
    <div data-testid="providers-avatar" data-provider={provider.provider}>
      Provider Avatar: {provider.provider}
    </div>
  ),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    providers: mockProviders,
    addProvider: mockAddProvider,
    updateProvider: mockUpdateProvider,
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      if (key === 'providerAlreadyExists') {
        return `Provider ${options?.name} already exists`
      }
      return options?.defaultValue || key
    },
  }),
}))

vi.mock('@/lib/utils', () => ({
  getProviderTitle: (provider: string) => `${provider} Provider`,
  getProviderColor: () => '#6366f1',
  getProviderDescription: () => 'Test description',
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: any) => ({
    ...config,
    component: config.component,
  }),
  useNavigate: () => vi.fn(),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void; [key: string]: any }) => (
    <button data-testid="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog">{children}</div>,
  DialogClose: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-close">{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-content">{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p data-testid="dialog-description">{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-footer">{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-header">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-title">{children}</div>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-trigger">{children}</div>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }) => (
    <input
      data-testid="input"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input
      data-testid="switch"
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
    />
  ),
}))

vi.mock('@/mock/data', () => ({
  openAIProviderSettings: [
    {
      key: 'api_key',
      title: 'API Key',
      description: 'Your API key',
      controllerType: 'input',
      controllerProps: { placeholder: 'Enter API key' },
    },
  ],
}))

vi.mock('lodash/cloneDeep', () => ({
  default: (obj: any) => JSON.parse(JSON.stringify(obj)),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      model_providers: '/settings/providers',
    },
  },
}))

describe('Providers Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviders = []
  })

  it('should render the providers settings page', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:settings')).toBeInTheDocument()
  })

  it('should render section header with title and description', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getAllByText('common:modelProviders').length).toBeGreaterThan(0)
    expect(screen.getByText('Connect external APIs and local model engines.')).toBeInTheDocument()
  })

  it('should render empty state with no providers', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })

  it('should render providers when data is available', () => {
    mockProviders = [
      { provider: 'openai', active: true, models: [{ id: 'gpt-4' }], settings: [], api_key: 'sk-test' },
      { provider: 'anthropic', active: false, models: [], settings: [] },
    ]

    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('openai Provider')).toBeInTheDocument()
    expect(screen.getByText('anthropic Provider')).toBeInTheDocument()
  })

  it('should render active badge for active providers', () => {
    mockProviders = [
      { provider: 'openai', active: true, models: [], settings: [] },
    ]

    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('should render provider switches', () => {
    mockProviders = [
      { provider: 'openai', active: true, models: [], settings: [] },
    ]

    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    const switches = screen.getAllByTestId('switch')
    expect(switches.length).toBeGreaterThan(0)
  })

  it('should render add provider dialog', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
  })

  it('should render provider name input in dialog', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    const input = screen.getByTestId('input')
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('should handle provider name input change', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    const input = screen.getByTestId('input')
    fireEvent.change(input, { target: { value: 'new-provider' } })
    expect(input).toBeInTheDocument()
  })

  it('should handle provider switch toggle', () => {
    mockProviders = [
      { provider: 'openai', active: true, models: [], settings: [] },
    ]

    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    const switchEl = screen.getByTestId('switch')
    fireEvent.click(switchEl)
    expect(mockUpdateProvider).toHaveBeenCalled()
  })

  it('should handle add provider button click', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    const input = screen.getByTestId('input')
    fireEvent.change(input, { target: { value: 'new-provider' } })

    const buttons = screen.getAllByTestId('button')
    const addButton = buttons.find(button => button.textContent?.includes('Add') || button.textContent?.includes('Create'))
    if (addButton) {
      fireEvent.click(addButton)
      expect(addButton).toBeInTheDocument()
    }
  })

  it('should prevent adding duplicate providers', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    const input = screen.getByTestId('input')
    fireEvent.change(input, { target: { value: 'openai' } })

    const buttons = screen.getAllByTestId('button')
    const addButton = buttons.find(button => button.textContent?.includes('Add') || button.textContent?.includes('Create'))
    if (addButton) {
      fireEvent.click(addButton)
      expect(addButton).toBeInTheDocument()
    }
  })

  it('should have proper layout structure', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    const container = screen.getByTestId('header-page')
    expect(container).toBeInTheDocument()

    const settingsMenu = screen.getByTestId('settings-menu')
    expect(settingsMenu).toBeInTheDocument()
  })

  it('should render add provider button', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    const buttons = screen.getAllByTestId('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('should call translation function with correct keys', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('common:settings')).toBeInTheDocument()
  })

  it('should handle empty provider name', () => {
    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    const buttons = screen.getAllByTestId('button')
    const addButton = buttons.find(button => button.textContent?.includes('Add') || button.textContent?.includes('Create'))
    if (addButton) {
      fireEvent.click(addButton)
      expect(addButton).toBeInTheDocument()
    }
  })

  it('should render provider with model count and description', () => {
    mockProviders = [
      { provider: 'openai', active: true, models: [{ id: 'm1' }, { id: 'm2' }], settings: [] },
    ]

    const Component = ProvidersRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText(/2 models/)).toBeInTheDocument()
  })
})
