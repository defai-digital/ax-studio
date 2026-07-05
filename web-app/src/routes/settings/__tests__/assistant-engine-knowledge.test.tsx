import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  addAssistant: vi.fn(),
  updateAssistant: vi.fn(),
  deleteAssistant: vi.fn(),
  updateSettings: vi.fn(),
  updateProvider: vi.fn(),
  getProviderByName: vi.fn(),
  provider: {
    name: 'llamacpp',
    settings: [
      {
        key: 'engine_type',
        title: 'Engine type',
        description: 'Choose the inference engine.',
        controller_type: 'input',
        controller_props: { value: '' },
      },
      {
        key: 'threads',
        title: 'Threads',
        description: 'Worker threads.',
        controller_type: 'input',
        controller_props: { type: 'number', value: 4 },
      },
    ],
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) => config,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      assistant: '/settings/assistant',
      engine_settings: '/settings/engine-settings',
      knowledge_base: '/settings/knowledge-base',
    },
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  HeaderPage: ({ children }: { children: React.ReactNode }) => (
    <header data-testid="header-page">{children}</header>
  ),
}))

vi.mock('@/components/common/SettingsMenu', () => ({
  SettingsMenu: () => <aside data-testid="settings-menu" />,
}))

vi.mock('@/components/settings/SettingsPageLayout', () => ({
  SettingsPageLayout: ({
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
    children,
  }: {
    title?: string
    children?: React.ReactNode
  }) => (
    <section data-testid="card">
      {title && <h2>{title}</h2>}
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
    <article data-testid="card-item">
      {title && <h3>{title}</h3>}
      {description}
      {actions}
    </article>
  ),
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => <p>{content}</p>,
}))

vi.mock('@/containers/DynamicControllerSetting', () => ({
  DynamicControllerSetting: ({
    controllerProps,
    onChange,
  }: {
    controllerProps: { value?: unknown }
    onChange: (value: unknown) => void
  }) => (
    <button type="button" onClick={() => onChange('ax-serving')}>
      {String(controllerProps.value)}
    </button>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    title,
  }: {
    children?: React.ReactNode
    onClick?: () => void
    title?: string
  }) => (
    <button type="button" title={title} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/common/AvatarEmoji', () => ({
  AvatarEmoji: ({ avatar }: { avatar: string }) => <span>{avatar}</span>,
}))

vi.mock('@/containers/dialogs/AddEditAssistant', () => ({
  AddEditAssistant: ({
    open,
    editingKey,
    onSave,
  }: {
    open: boolean
    editingKey: string | null
    onSave: (assistant: Assistant) => void
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onSave({
            id: editingKey ?? 'new-assistant',
            name: 'Saved assistant',
            description: 'Saved description',
            avatar: '🤖',
            prompt: 'Be useful',
            created_at: 1,
          } as Assistant)
        }
      >
        save assistant
      </button>
    ) : null,
}))

vi.mock('@/containers/dialogs', () => ({
  DeleteAssistantDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean
    onConfirm: () => void
  }) =>
    open ? (
      <button type="button" onClick={onConfirm}>
        confirm delete
      </button>
    ) : null,
}))

vi.mock('@/containers/AkidbConfigPanel', () => ({
  AkidbConfigPanel: () => <div>akidb panel</div>,
}))

vi.mock('@/hooks/chat/useAssistant', () => ({
  useAssistant: () => ({
    assistants: [
      {
        id: 'assistant-2',
        name: 'Second Assistant',
        description: 'Shown second after sorting',
        avatar: '🧪',
        created_at: 2,
      },
      {
        id: 'assistant-1',
        name: 'First Assistant',
        description: 'Shown first after sorting',
        avatar: '✅',
        created_at: 1,
      },
    ],
    addAssistant: mocks.addAssistant,
    updateAssistant: mocks.updateAssistant,
    deleteAssistant: mocks.deleteAssistant,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    providers: () => ({
      updateSettings: mocks.updateSettings,
    }),
  }),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: () => ({
    getProviderByName: mocks.getProviderByName,
    updateProvider: mocks.updateProvider,
  }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: Array<string | false | undefined>) =>
    classes.filter(Boolean).join(' '),
}))

vi.mock('lucide-react', () => ({
  Bot: () => <span data-testid="bot-icon" />,
  Cog: () => <span data-testid="cog-icon" />,
  Database: () => <span data-testid="database-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
  PlusCircle: () => <span data-testid="plus-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
}))

import { Route as AssistantRoute } from '../assistant'
import { Route as EngineSettingsRoute } from '../engine-settings'
import { Route as KnowledgeBaseRoute } from '../knowledge-base'

describe('assistant, engine, and knowledge settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getProviderByName.mockReturnValue(mocks.provider)
  })

  it('renders assistants sorted by creation time and supports add, edit, and delete actions', () => {
    const Component = AssistantRoute.component as React.ComponentType
    render(<Component />)

    const first = screen.getByText('First Assistant')
    const second = screen.getByText('Second Assistant')
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    fireEvent.click(screen.getByText('assistants:addAssistant'))
    fireEvent.click(screen.getByText('save assistant'))
    expect(mocks.addAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-assistant' })
    )

    fireEvent.click(screen.getAllByTitle('assistants:editAssistant')[0])
    fireEvent.click(screen.getByText('save assistant'))
    expect(mocks.updateAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'assistant-1' })
    )

    fireEvent.click(screen.getAllByTitle('assistants:deleteAssistant')[0])
    fireEvent.click(screen.getByText('confirm delete'))
    expect(mocks.deleteAssistant).toHaveBeenCalledWith('assistant-1')
  })

  it('renders engine settings sections and persists controller changes', () => {
    const Component = EngineSettingsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('common:engineSettings')).toBeInTheDocument()
    expect(screen.getByText('Engine type')).toBeInTheDocument()
    expect(screen.getByText('Threads')).toBeInTheDocument()

    fireEvent.click(screen.getByText('llamacpp'))

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      'llamacpp',
      expect.arrayContaining([
        expect.objectContaining({
          key: 'engine_type',
          controller_props: expect.objectContaining({ value: 'ax-serving' }),
        }),
      ])
    )
    expect(mocks.updateProvider).toHaveBeenCalledWith(
      'llamacpp',
      expect.objectContaining({ settings: expect.any(Array) })
    )
  })

  it('renders an unavailable state when engine settings are not loaded', () => {
    mocks.getProviderByName.mockReturnValue(null)

    const Component = EngineSettingsRoute.component as React.ComponentType
    render(<Component />)

    expect(
      screen.getByText('settings:engineSettings.notAvailable')
    ).toBeInTheDocument()
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('renders the knowledge base settings panel', () => {
    const Component = KnowledgeBaseRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('common:knowledgeBase')).toBeInTheDocument()
    expect(screen.getByText('akidb panel')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })
})
