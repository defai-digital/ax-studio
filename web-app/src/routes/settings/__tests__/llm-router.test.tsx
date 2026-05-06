import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

type RouterSettingsState = {
  enabled: boolean
  routerModelId: string | null
  routerProviderId: string | null
  timeout: number
  setEnabled: ReturnType<typeof vi.fn>
  setRouterModel: ReturnType<typeof vi.fn>
  setTimeoutMs: ReturnType<typeof vi.fn>
}

type ModelProviderState = {
  providers: Array<{
    active: boolean
    api_key?: string
    provider: string
    models: Array<{
      id: string
      name?: string
      displayName?: string
      embedding?: boolean
    }>
  }>
}

const mocks = vi.hoisted(() => {
  const routerState = {} as RouterSettingsState
  const modelProviderState = {} as ModelProviderState

  Object.assign(routerState, {
    enabled: false,
    routerModelId: null,
    routerProviderId: null,
    timeout: 15000,
    setEnabled: vi.fn((enabled: boolean) => {
      routerState.enabled = enabled
    }),
    setRouterModel: vi.fn((modelId: string, providerId: string) => {
      routerState.routerModelId = modelId
      routerState.routerProviderId = providerId
    }),
    setTimeoutMs: vi.fn((timeout: number) => {
      routerState.timeout = timeout
    }),
  })

  Object.assign(modelProviderState, {
    providers: [],
  })

  return {
    modelProviderState,
    routerState,
  }
})

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      llm_router: '/settings/llm-router',
    },
  },
}))

vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="check-icon" />,
  ChevronsUpDown: () => <span data-testid="chevrons-up-down-icon" />,
  Info: () => <span data-testid="info-icon" />,
  Route: () => <span data-testid="route-icon" />,
}))

vi.mock('@/components/common/SettingsMenu', () => ({
  default: () => <nav data-testid="settings-menu" />,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <header data-testid="header-page">{children}</header>
  ),
}))

vi.mock('@/components/settings/SettingsPageLayout', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

vi.mock('@/components/common/Card', () => ({
  Card: ({
    header,
    title,
    children,
  }: {
    header?: React.ReactNode
    title?: React.ReactNode
    children?: React.ReactNode
  }) => (
    <section data-testid="card">
      {header}
      {title && <h2>{title}</h2>}
      {children}
    </section>
  ),
  CardItem: ({
    title,
    description,
    actions,
  }: {
    title?: React.ReactNode
    description?: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <div data-testid="card-item">
      {title && <div>{title}</div>}
      {description && <div>{description}</div>}
      {actions}
    </div>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked: boolean
    disabled?: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandGroup: ({
    children,
    heading,
  }: {
    children: React.ReactNode
    heading?: React.ReactNode
  }) => (
    <div>
      {heading && <h3>{heading}</h3>}
      {children}
    </div>
  ),
  CommandInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  CommandItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => <button onClick={onSelect}>{children}</button>,
  CommandList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/hooks/settings/useRouterSettings', () => ({
  useRouterSettings: (selector: (state: RouterSettingsState) => unknown) =>
    selector(mocks.routerState),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: (selector: (state: ModelProviderState) => unknown) =>
    selector(mocks.modelProviderState),
}))

import { Route } from '../llm-router'

function renderLLMRouterRoute() {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

function resetState() {
  Object.assign(mocks.routerState, {
    enabled: false,
    routerModelId: null,
    routerProviderId: null,
    timeout: 15000,
  })
  Object.assign(mocks.modelProviderState, {
    providers: [
      {
        active: true,
        api_key: 'openai-key',
        provider: 'openai',
        models: [
          {
            id: 'gpt-4o-mini',
            displayName: 'GPT-4o Mini',
          },
          {
            id: 'text-embedding-3-small',
            displayName: 'OpenAI Embedding',
            embedding: true,
          },
        ],
      },
      {
        active: true,
        provider: 'llamacpp',
        models: [
          {
            id: 'llama-3.2-3b-local.gguf',
            displayName: 'Llama 3.2 3B Local',
          },
        ],
      },
      {
        active: true,
        api_key: 'anthropic-key',
        provider: 'anthropic',
        models: [
          {
            id: 'claude-haiku',
            name: 'Claude Haiku',
          },
        ],
      },
      {
        active: false,
        api_key: 'inactive-key',
        provider: 'inactive',
        models: [
          {
            id: 'inactive-model',
            displayName: 'Inactive Model',
          },
        ],
      },
    ],
  })
}

describe('LLM Router settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('renders the disabled router state with model and timeout controls disabled', () => {
    renderLLMRouterRoute()

    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getAllByText('LLM Router')).toHaveLength(2)
    expect(screen.getByText('Automatic model selection')).toBeInTheDocument()

    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Select a model/i })).toBeDisabled()
    expect(screen.getByDisplayValue('15000')).toBeDisabled()
  })

  it('enables automatic model selection from the settings switch', () => {
    const { rerender } = renderLLMRouterRoute()

    fireEvent.click(screen.getByRole('checkbox'))

    expect(mocks.routerState.setEnabled).toHaveBeenCalledWith(true)

    const Component = Route.component as React.ComponentType
    rerender(<Component />)
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByRole('button', { name: /Select a model/i })).toBeEnabled()
    expect(screen.getByDisplayValue('15000')).toBeEnabled()
  })

  it('lists only active non-embedding models for router selection', () => {
    mocks.routerState.enabled = true

    renderLLMRouterRoute()

    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.getByText('llamacpp')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
    expect(screen.getByText('GPT-4o Mini')).toBeInTheDocument()
    expect(screen.getByText('Llama 3.2 3B Local')).toBeInTheDocument()
    expect(screen.getByText('Claude Haiku')).toBeInTheDocument()
    expect(screen.queryByText('OpenAI Embedding')).not.toBeInTheDocument()
    expect(screen.queryByText('Inactive Model')).not.toBeInTheDocument()
  })

  it('selects a local router model without requiring an API key', () => {
    mocks.routerState.enabled = true

    renderLLMRouterRoute()
    fireEvent.click(
      screen.getByRole('button', { name: /Llama 3\.2 3B Local/i })
    )

    expect(mocks.routerState.setRouterModel).toHaveBeenCalledWith(
      'llama-3.2-3b-local.gguf',
      'llamacpp'
    )
  })

  it('selects a router model and provider from the model picker', () => {
    mocks.routerState.enabled = true

    renderLLMRouterRoute()
    fireEvent.click(screen.getByRole('button', { name: /GPT-4o Mini/i }))

    expect(mocks.routerState.setRouterModel).toHaveBeenCalledWith(
      'gpt-4o-mini',
      'openai'
    )
  })

  it('shows the selected router model when it is available', () => {
    mocks.routerState.enabled = true
    mocks.routerState.routerModelId = 'gpt-4o-mini'
    mocks.routerState.routerProviderId = 'openai'

    renderLLMRouterRoute()

    expect(
      screen.getAllByText('GPT-4o Mini (openai)').length
    ).toBeGreaterThanOrEqual(1)
    expect(
      screen.queryByText(/configured router model is no longer available/i)
    ).not.toBeInTheDocument()
  })

  it('warns when the configured router model is no longer available', () => {
    mocks.routerState.enabled = true
    mocks.routerState.routerModelId = 'missing-model'
    mocks.routerState.routerProviderId = 'openai'

    renderLLMRouterRoute()

    expect(
      screen.getByText(/configured router model is no longer available/i)
    ).toBeInTheDocument()
    expect(screen.getAllByText('missing-model (openai)').length).toBeGreaterThanOrEqual(1)
  })

  it('updates classification timeout from numeric input and ignores invalid input', () => {
    mocks.routerState.enabled = true

    renderLLMRouterRoute()
    const timeoutInput = screen.getByDisplayValue('15000')

    fireEvent.change(timeoutInput, { target: { value: '12000' } })
    fireEvent.change(timeoutInput, { target: { value: 'not-a-number' } })

    expect(mocks.routerState.setTimeoutMs).toHaveBeenCalledTimes(1)
    expect(mocks.routerState.setTimeoutMs).toHaveBeenCalledWith(12000)
  })
})
