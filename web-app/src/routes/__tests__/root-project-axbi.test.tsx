import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  location: { pathname: '/' },
  getFolderById: vi.fn(),
  updateFolder: vi.fn(),
  deleteAllThreadsByProject: vi.fn(),
  hideInitialLoader: vi.fn(),
  threads: {} as Record<string, unknown>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) => config,
  createRootRoute: (config: {
    component: React.ComponentType
    errorComponent?: React.ComponentType<{ error: Error }>
  }) => config,
  Outlet: () => <main data-testid="outlet" />,
  useLocation: () => mocks.location,
  useParams: () => ({ projectId: 'missing-project' }),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    appLogs: '/logs',
    axBi: '/ax-bi',
    localApiServerlogs: '/local-api-server/logs',
    systemMonitor: '/system-monitor',
  },
}))

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="motion-page">{children}</div>
    ),
  },
}))

vi.mock('@/containers/AxBiWorkspace', () => ({
  AxBiWorkspace: () => <section>ax-bi workspace</section>,
}))

vi.mock('@/containers/dialogs/AppUpdater', () => ({
  DialogAppUpdater: () => <div data-testid="app-updater" />,
}))

vi.mock('@/providers/ThemeProvider', () => ({
  ThemeProvider: () => <div data-testid="theme-provider" />,
}))

vi.mock('@/providers/InterfaceProvider', () => ({
  InterfaceProvider: () => <div data-testid="interface-provider" />,
}))

vi.mock('@/providers/KeyboardShortcuts', () => ({
  KeyboardShortcutsProvider: () => <div data-testid="shortcuts-provider" />,
}))

vi.mock('@/providers/DataProvider', () => ({
  DataProvider: () => <div data-testid="data-provider" />,
}))

vi.mock('@/providers/ExtensionProvider', () => ({
  ExtensionProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="extension-provider">{children}</div>
  ),
}))

vi.mock('@/providers/ToasterProvider', () => ({
  ToasterProvider: () => <div data-testid="toaster-provider" />,
}))

vi.mock('@/i18n/TranslationContext', () => ({
  TranslationProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="translation-provider">{children}</div>
  ),
}))

vi.mock('@/providers/GlobalEventHandler', () => ({
  GlobalEventHandler: () => <div data-testid="global-event-handler" />,
}))

vi.mock('@/providers/ServiceHubProvider', () => ({
  ServiceHubProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="service-hub-provider">{children}</div>
  ),
}))

vi.mock('@/containers/dialogs/mcp/ToolApproval', () => ({
  ToolApproval: () => <div data-testid="tool-approval" />,
}))

vi.mock('@/containers/dialogs/AttachmentIngestionDialog', () => ({
  AttachmentIngestionDialog: () => <div data-testid="attachment-dialog" />,
}))

vi.mock('@/containers/dialogs/OutOfContextDialog', () => ({
  OutOfContextPromiseModal: () => <div data-testid="context-dialog" />,
}))

vi.mock('@/components/common/GlobalError', () => ({
  GlobalError: ({ error }: { error: Error }) => <div>{error.message}</div>,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-provider">{children}</div>
  ),
  SidebarInset: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-inset">{children}</div>
  ),
  SidebarMenu: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="sidebar-menu">{children}</div>
  ),
}))

vi.mock('@/components/left-sidebar', () => ({
  LeftSidebar: () => <nav data-testid="left-sidebar" />,
}))

vi.mock('@/components/WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}))

vi.mock('@/hooks/ui/useLeftPanel', () => ({
  useLeftPanel: () => ({
    open: true,
    setLeftPanel: vi.fn(),
    width: 280,
    setLeftPanelWidth: vi.fn(),
  }),
}))

vi.mock('@/lib/utils/animations', () => ({
  pageTransition: {},
  pageVariants: {},
}))

vi.mock('@/lib/bootstrap/app-startup', () => ({
  hideInitialLoader: mocks.hideInitialLoader,
}))

vi.mock('@/lib/window-drag', () => ({
  startWindowDragFromMouseEvent: vi.fn(),
}))

vi.mock('@/hooks/threads/useThreadManagement', () => ({
  useThreadManagement: () => ({
    getFolderById: mocks.getFolderById,
    updateFolder: mocks.updateFolder,
  }),
}))

vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: (selector: (state: unknown) => unknown) =>
    selector({
      threads: mocks.threads,
      deleteAllThreadsByProject: mocks.deleteAllThreadsByProject,
    }),
}))

vi.mock('@/hooks/chat/useAssistant', () => ({
  useAssistant: () => ({
    assistants: [
      {
        id: 'assistant-1',
        name: 'Project Assistant',
        avatar: '🤖',
      },
    ],
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

vi.mock('@/containers/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}))

vi.mock('@/containers/HeaderPage', () => ({
  HeaderPage: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}))

vi.mock('@/containers/ThreadList', () => ({
  ThreadList: () => <div data-testid="thread-list" />,
}))

vi.mock('@/containers/ProjectFiles', () => ({
  ProjectFiles: () => <div data-testid="project-files" />,
}))

vi.mock('@/components/common/AvatarEmoji', () => ({
  AvatarEmoji: ({ avatar }: { avatar: string }) => <span>{avatar}</span>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode
    onClick?: () => void
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/containers/dialogs/AddProjectDialog', () => ({
  AddProjectDialog: ({
    onSave,
  }: {
    onSave: (
      name: string,
      assistantId?: string,
      logo?: string,
      projectPrompt?: string | null
    ) => void
  }) => (
    <button
      type="button"
      onClick={() => onSave('Updated project', 'assistant-1', 'logo.png', 'Use BI context')}
    >
      save project
    </button>
  ),
}))

vi.mock('@/containers/dialogs/DeleteProjectDialog', () => ({
  DeleteProjectDialog: () => <div data-testid="delete-project-dialog" />,
}))

vi.mock('@/containers/dialogs/thread/DeleteAllThreadsInProjectDialog', () => ({
  DeleteAllThreadsInProjectDialog: ({
    onDeleteAll,
    onDropdownClose,
  }: {
    onDeleteAll: () => void
    onDropdownClose: () => void
  }) => (
    <button
      type="button"
      onClick={() => {
        onDeleteAll()
        onDropdownClose()
      }}
    >
      delete all threads
    </button>
  ),
}))

vi.mock('lucide-react', () => ({
  FolderOpen: () => <span data-testid="folder-icon" />,
  FolderPenIcon: () => <span data-testid="folder-pen-icon" />,
  MessageCircle: () => <span data-testid="message-icon" />,
  MoreHorizontal: () => <span data-testid="more-icon" />,
  PencilIcon: () => <span data-testid="pencil-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
}))

import { Route as RootRoute } from '../__root'
import { Route as AxBiRoute } from '../ax-bi'
import { Route as ProjectRoute } from '../project/$projectId'

describe('root, project, and ax-bi routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.location.pathname = '/'
    mocks.getFolderById.mockReturnValue(undefined)
    mocks.threads = {}
  })

  it('renders the root app layout for normal app routes', () => {
    const Component = RootRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('service-hub-provider')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-provider')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('renders the root logs layout for log routes', () => {
    mocks.location.pathname = '/logs'

    const Component = RootRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('service-hub-provider')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-provider')).not.toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('renders root route errors through the global error boundary', () => {
    const ErrorComponent = RootRoute.errorComponent as React.ComponentType<{
      error: Error
    }>
    render(<ErrorComponent error={new Error('route failed')} />)

    expect(screen.getByText('route failed')).toBeInTheDocument()
  })

  it('renders the ax-bi workspace route', () => {
    const Component = AxBiRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('ax-bi workspace')).toBeInTheDocument()
  })

  it('renders a not-found state for missing projects', () => {
    const Component = ProjectRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('projects.projectNotFound')).toBeInTheDocument()
    expect(screen.getByText('projects.projectNotFoundDesc')).toBeInTheDocument()
  })

  it('renders a project with conversations and forwards project actions', () => {
    mocks.getFolderById.mockReturnValue({
      id: 'missing-project',
      name: 'Revenue Project',
      assistantId: 'assistant-1',
      projectPrompt: 'Use the finance dataset',
    })
    mocks.threads = {
      older: {
        id: 'older',
        title: 'Older thread',
        updated: 1,
        metadata: { project: { id: 'missing-project' } },
      },
      newer: {
        id: 'newer',
        title: 'Newer thread',
        updated: 2,
        metadata: { project: { id: 'missing-project' } },
      },
      other: {
        id: 'other',
        title: 'Other project thread',
        updated: 3,
        metadata: { project: { id: 'other-project' } },
      },
    }

    const Component = ProjectRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getAllByText('Revenue Project')[0]).toBeInTheDocument()
    expect(screen.getByText('2 conversations')).toBeInTheDocument()
    expect(screen.getByText('Project Assistant')).toBeInTheDocument()

    screen.getByText('delete all threads').click()
    expect(mocks.deleteAllThreadsByProject).toHaveBeenCalledWith('missing-project')

    screen.getByText('save project').click()
    expect(mocks.updateFolder).toHaveBeenCalledWith(
      'missing-project',
      'Updated project',
      'assistant-1',
      'logo.png',
      'Use BI context'
    )
  })
})
