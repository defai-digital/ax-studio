import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Route as ProviderDetailRoute } from '../$providerName'

const mockUpdateProvider = vi.fn()
const mockGetProviderByName = vi.fn()
const mockUpdateSettings = vi.fn()
const mockFetchModelsFromProvider = vi.fn()

vi.mock('@/components/common/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu" />,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/components/common/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card">{children}</div>
  ),
  CardItem: ({
    title,
    actions,
    description,
  }: {
    title?: React.ReactNode
    actions?: React.ReactNode
    description?: React.ReactNode
  }) => (
    <div data-testid="card-item">
      <div data-testid="card-item-title">{title}</div>
      <div data-testid="card-item-description">{description}</div>
      <div data-testid="card-item-actions">{actions}</div>
    </div>
  ),
}))

vi.mock('@/components/common/Capabilities', () => ({
  default: () => <div />,
}))

vi.mock('@/containers/dynamicControllerSetting', () => ({
  DynamicControllerSetting: ({
    onChange,
    controllerProps,
  }: {
    onChange: (value: string) => void
    controllerProps: { value?: string; type?: string; placeholder?: string }
  }) => (
    <input
      data-testid="dynamic-input"
      value={(controllerProps.value as string) || ''}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: () => <div />,
}))

vi.mock('@/containers/dialogs/EditModel', () => ({
  DialogEditModel: () => <div />,
}))

vi.mock('@/containers/ModelSetting', () => ({
  ModelSetting: () => <div />,
}))

vi.mock('@/containers/dialogs/DeleteModel', () => ({
  DialogDeleteModel: () => <div />,
}))

vi.mock('@/containers/FavoriteModelAction', () => ({
  FavoriteModelAction: () => <div />,
}))

vi.mock('@/containers/dialogs/DeleteProvider', () => ({
  default: () => <div data-testid="delete-provider" />,
}))

vi.mock('@/containers/dialogs/AddModel', () => ({
  DialogAddModel: () => <div />,
}))

vi.mock('@/components/common/ProvidersAvatar', () => ({
  default: () => <div data-testid="providers-avatar" />,
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: () => ({
    getProviderByName: mockGetProviderByName,
    updateProvider: mockUpdateProvider,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    providers: () => ({
      updateSettings: mockUpdateSettings,
      fetchModelsFromProvider: mockFetchModelsFromProvider,
    }),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; provider?: string; defaultValue?: string }) => {
      if (options?.defaultValue) return options.defaultValue
      return key
    },
  }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  getProviderTitle: (name: string) => name,
  getProviderColor: () => '#6366f1',
  getModelDisplayName: (model: { id: string; name?: string }) =>
    model.name || model.id,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => config,
  useParams: () => ({ providerName: 'test-provider' }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('@/constants/providers', () => ({
  predefinedProviders: [],
}))

vi.mock('@/constants/routes', () => ({
  route: { hub: { index: '/hub' }, settings: { providers: '/settings/providers/$providerName' } },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    [key: string]: any
  }) => (
    <button
      data-testid="button"
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  ),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@tabler/icons-react', () => ({
  IconLoader: () => <span data-testid="icon-loader" />,
}))

vi.mock('lucide-react', () => ({
  RefreshCw: () => <span />,
  Search: () => <span />,
  Plug: () => <span data-testid="plug-icon" />,
  CheckCircle2: () => <span data-testid="check-icon" />,
  XCircle: () => <span data-testid="x-icon" />,
}))

const mockProvider = {
  provider: 'test-provider',
  active: true,
  models: [],
  api_key: '',
  base_url: 'https://api.example.com/v1',
  settings: [
    {
      key: 'api-key',
      title: 'API Key',
      description: 'Your API key',
      controller_type: 'input',
      controller_props: {
        value: '',
        type: 'password',
        placeholder: 'Enter API key',
        input_actions: ['unobscure', 'copy'],
      },
    },
    {
      key: 'base-url',
      title: 'Base URL',
      description: 'API endpoint URL',
      controller_type: 'input',
      controller_props: {
        value: 'https://api.example.com/v1',
        type: 'text',
        placeholder: 'https://api.example.com/v1',
      },
    },
  ],
}

describe('ProviderDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProviderByName.mockReturnValue({ ...mockProvider, settings: mockProvider.settings.map(s => ({ ...s, controller_props: { ...s.controller_props } })) })
    mockFetchModelsFromProvider.mockResolvedValue(['model-1', 'model-2'])
  })

  it('renders configuration section with settings', () => {
    const ProviderDetail = ProviderDetailRoute.component

    render(<ProviderDetail />)
    expect(screen.getAllByTestId('dynamic-input')).toHaveLength(2)
  })

  it('validates API key - rejects values with leading whitespace', () => {
    const ProviderDetail = ProviderDetailRoute.component

    render(<ProviderDetail />)
    const inputs = screen.getAllByTestId('dynamic-input')
    const apiKeyInput = inputs[0]

    fireEvent.change(apiKeyInput, { target: { value: '  bad-key' } })

    expect(mockUpdateProvider).not.toHaveBeenCalled()
  })

  it('validates API key - rejects values with HTML tags', () => {
    const ProviderDetail = ProviderDetailRoute.component

    render(<ProviderDetail />)
    const inputs = screen.getAllByTestId('dynamic-input')
    const apiKeyInput = inputs[0]

    fireEvent.change(apiKeyInput, { target: { value: '<script>alert(1)</script>' } })

    expect(mockUpdateProvider).not.toHaveBeenCalled()
  })

  it('accepts valid API key', () => {
    const ProviderDetail = ProviderDetailRoute.component

    render(<ProviderDetail />)
    const inputs = screen.getAllByTestId('dynamic-input')
    const apiKeyInput = inputs[0]

    fireEvent.change(apiKeyInput, { target: { value: 'sk-valid-key-12345' } })

    expect(mockUpdateProvider).toHaveBeenCalled()
  })

  it('validates base URL - rejects invalid URL', () => {
    const ProviderDetail = ProviderDetailRoute.component

    render(<ProviderDetail />)
    const inputs = screen.getAllByTestId('dynamic-input')
    const baseUrlInput = inputs[1]

    fireEvent.change(baseUrlInput, { target: { value: 'not-a-url' } })

    expect(mockUpdateProvider).not.toHaveBeenCalled()
  })

  it('accepts valid base URL', () => {
    const ProviderDetail = ProviderDetailRoute.component

    render(<ProviderDetail />)
    const inputs = screen.getAllByTestId('dynamic-input')
    const baseUrlInput = inputs[1]

    fireEvent.change(baseUrlInput, { target: { value: 'https://api.newprovider.com/v1' } })

    expect(mockUpdateProvider).toHaveBeenCalled()
  })

  it('renders Test Connection button', () => {
    const ProviderDetail = ProviderDetailRoute.component

    render(<ProviderDetail />)

    const buttons = screen.getAllByTestId('button')
    const testButton = buttons.find(
      (btn) => btn.textContent?.includes('testConnection') || btn.textContent?.includes('Test Connection')
    )
    expect(testButton).toBeDefined()
  })

  it('shows connection success after test', async () => {
    const ProviderDetail = ProviderDetailRoute.component
    mockFetchModelsFromProvider.mockResolvedValue(['model-1', 'model-2'])

    render(<ProviderDetail />)

    const buttons = screen.getAllByTestId('button')
    const testButton = buttons.find(
      (btn) => btn.textContent?.includes('testConnection') || btn.textContent?.includes('Test')
    )
    if (testButton) {
      fireEvent.click(testButton)
    }

    await waitFor(() => {
      expect(screen.getByTestId('check-icon')).toBeInTheDocument()
    })
  })

  it('shows connection error after failed test', async () => {
    const ProviderDetail = ProviderDetailRoute.component
    mockFetchModelsFromProvider.mockRejectedValue(new Error('Connection refused'))

    render(<ProviderDetail />)

    const buttons = screen.getAllByTestId('button')
    const testButton = buttons.find(
      (btn) => btn.textContent?.includes('testConnection') || btn.textContent?.includes('Test')
    )
    if (testButton) {
      fireEvent.click(testButton)
    }

    await waitFor(() => {
      expect(screen.getByTestId('x-icon')).toBeInTheDocument()
    })
  })

  it('does not show connection error initially', () => {
    const ProviderDetail = ProviderDetailRoute.component

    render(<ProviderDetail />)

    expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument()
    expect(screen.queryByTestId('x-icon')).not.toBeInTheDocument()
  })

  it('accepts clearing API key after setting a valid one', () => {
    const ProviderDetail = ProviderDetailRoute.component

    render(<ProviderDetail />)
    const inputs = screen.getAllByTestId('dynamic-input')
    const apiKeyInput = inputs[0]

    fireEvent.change(apiKeyInput, { target: { value: 'sk-valid-key' } })
    expect(mockUpdateProvider).toHaveBeenCalledTimes(1)

    fireEvent.change(apiKeyInput, { target: { value: '' } })
    expect(mockUpdateProvider).toHaveBeenCalledTimes(2)
  })
})
