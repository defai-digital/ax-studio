import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  guardrails: {
    dataMode: 'hybrid',
    allowWebSearch: true,
    alwaysCiteSources: true,
    flagLowConfidence: false,
    requireApprovalBeforeEdits: true,
    setDataMode: vi.fn(),
    setAllowWebSearch: vi.fn(),
    setAlwaysCiteSources: vi.fn(),
    setFlagLowConfidence: vi.fn(),
    setRequireApprovalBeforeEdits: vi.fn(),
  },
  proxy: {
    proxyUrl: 'http://proxy.local:8080',
    proxyEnabled: true,
    proxyUsername: 'user',
    proxyPassword: 'secret',
    proxyIgnoreSSL: false,
    noProxy: 'localhost,127.0.0.1',
    setProxyEnabled: vi.fn(),
    setProxyUsername: vi.fn(),
    setProxyPassword: vi.fn(),
    setProxyIgnoreSSL: vi.fn(),
    setNoProxy: vi.fn(),
    setProxyUrl: vi.fn(),
  },
  attachments: {
    enabled: true,
    maxFileSizeMB: 20,
    retrievalLimit: 3,
    retrievalThreshold: 0.3,
    chunkSizeChars: 512,
    overlapChars: 64,
    searchMode: 'auto',
    parseMode: 'auto',
    autoInlineContextRatio: 0.75,
    setEnabled: vi.fn(),
    setMaxFileSizeMB: vi.fn(),
    setRetrievalLimit: vi.fn(),
    setRetrievalThreshold: vi.fn(),
    setChunkSizeChars: vi.fn(),
    setOverlapChars: vi.fn(),
    setSearchMode: vi.fn(),
    setParseMode: vi.fn(),
    setAutoInlineContextRatio: vi.fn(),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) => config,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      attachments: '/settings/attachments',
      guardrails: '/settings/guardrails',
      https_proxy: '/settings/https-proxy',
      privacy: '/settings/privacy',
    },
  },
}))

vi.mock('@/components/common/SettingsMenu', () => ({
  default: () => <aside data-testid="settings-menu" />,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <header data-testid="header-page">{children}</header>
  ),
}))

vi.mock('@/components/settings/SettingsPageLayout', () => ({
  default: ({
    title,
    subtitle,
  }: {
    title: string
    subtitle?: string
  }) => (
    <section data-testid="settings-page-layout">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </section>
  ),
}))

vi.mock('@/components/common/Card', () => ({
  Card: ({
    title,
    header,
    children,
  }: {
    title?: string
    header?: React.ReactNode
    children?: React.ReactNode
  }) => (
    <section data-testid="card">
      {title && <h2>{title}</h2>}
      {header}
      {children}
    </section>
  ),
  CardItem: ({
    title,
    description,
    actions,
  }: {
    title?: string
    description?: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <div data-testid="card-item">
      {title && <h3>{title}</h3>}
      {typeof description === 'string' ? <p>{description}</p> : description}
      {actions}
    </div>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      aria-label="toggle"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      type="checkbox"
    />
  ),
}))

vi.mock('@/components/ui/radio-group', () => ({
  RadioGroup: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    children: React.ReactNode
  }) => (
    <div data-testid="radio-group" data-value={value}>
      <button type="button" onClick={() => onValueChange('local-only')}>
        choose local
      </button>
      {children}
    </div>
  ),
  RadioGroupItem: ({ value }: { value: string }) => (
    <input readOnly checked={value === 'hybrid'} type="radio" value={value} />
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="badge">{children}</span>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    type = 'text',
  }: {
    value: string
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    type?: string
  }) => (
    <input
      placeholder={placeholder}
      type={type}
      value={value}
      onChange={onChange}
    />
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/settings/useGuardrails', () => ({
  useGuardrails: () => mocks.guardrails,
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: (selector?: (state: unknown) => unknown) => {
    const state = { selectedModel: { id: 'local-qwen', name: 'Local Qwen' } }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/hooks/settings/useProxyConfig', () => ({
  useProxyConfig: () => mocks.proxy,
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T) => selector,
}))

vi.mock('@/hooks/chat/useAttachments', () => ({
  useAttachments: (selector?: (state: typeof mocks.attachments) => unknown) =>
    selector ? selector(mocks.attachments) : mocks.attachments,
}))

vi.mock('lucide-react', () => ({
  Cloud: () => <span data-testid="cloud-icon" />,
  Cpu: () => <span data-testid="cpu-icon" />,
  Eye: () => <span data-testid="eye-icon" />,
  EyeOff: () => <span data-testid="eye-off-icon" />,
  FileText: () => <span data-testid="file-text-icon" />,
  Globe: () => <span data-testid="globe-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  ShieldCheck: () => <span data-testid="shield-check-icon" />,
}))

import { Route as AttachmentsRoute } from '../attachments'
import { Route as GuardrailsRoute } from '../guardrails'
import { Route as HttpsProxyRoute } from '../https-proxy'
import { Route as PrivacyRoute } from '../privacy'

describe('additional settings pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders privacy promises from translations', () => {
    const Component = PrivacyRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getAllByText('common:privacy')).toHaveLength(2)
    expect(screen.getByText('settings:privacy.privacyPolicy')).toBeInTheDocument()
    expect(screen.getByText('settings:privacy.promise1')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })

  it('renders guardrail controls and updates data mode', () => {
    const Component = GuardrailsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Workspace Guardrails')).toBeInTheDocument()
    expect(screen.getByText('Data Rules')).toBeInTheDocument()
    expect(screen.getByText('Current model')).toBeInTheDocument()
    expect(screen.getByText('Local Qwen')).toBeInTheDocument()

    fireEvent.click(screen.getByText('choose local'))
    expect(mocks.guardrails.setDataMode).toHaveBeenCalledWith('local-only')
  })

  it('renders proxy settings and forwards edits to the proxy store', () => {
    const Component = HttpsProxyRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('common:https_proxy')).toBeInTheDocument()
    expect(screen.getByDisplayValue('http://proxy.local:8080')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('http://proxy.local:8080'), {
      target: { value: 'http://new-proxy.local:8080' },
    })
    expect(mocks.proxy.setProxyUrl).toHaveBeenCalledWith(
      'http://new-proxy.local:8080'
    )
  })

  it('renders attachment settings and forwards select changes', () => {
    const Component = AttachmentsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('common:attachments')).toBeInTheDocument()
    expect(screen.getByText('settings:attachments.featureTitle')).toBeInTheDocument()
    expect(screen.getByDisplayValue('settings:attachments.parseModeAuto')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('settings:attachments.parseModeAuto'), {
      target: { value: 'inline' },
    })
    expect(mocks.attachments.setParseMode).toHaveBeenCalledWith('inline')
  })
})
