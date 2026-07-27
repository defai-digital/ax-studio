import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  location: { pathname: '/' },
  hideInitialLoader: vi.fn(),
  redirectError: new Error('redirect'),
  redirect: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  createRootRoute: (config: {
    component: React.ComponentType
    errorComponent?: React.ComponentType<{ error: Error }>
  }) => config,
  Outlet: () => <main data-testid="outlet" />,
  redirect: mocks.redirect,
  useLocation: () => mocks.location,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    legacyAxBi: '/ax-bi',
    settings: { axBi: '/settings/ax-bi', general: '/settings/general' },
  },
}))

vi.mock('motion/react', () => ({
  useReducedMotion: () => false,
  motion: {
    div: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="motion-page">{children}</div>
    ),
  },
}))

vi.mock('@/containers/ElectronUpdateBanner', () => ({
  ElectronUpdateBanner: () => <div data-testid="electron-update-banner" />,
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

vi.mock('@/providers/HuggingFaceConnectionProvider', () => ({
  HuggingFaceConnectionProvider: () => (
    <div data-testid="hugging-face-provider" />
  ),
}))

vi.mock('@/containers/HuggingFaceConnectionDialog', () => ({
  HuggingFaceConnectionDialog: () => (
    <div data-testid="hugging-face-dialog" />
  ),
}))

vi.mock('@/providers/ServiceHubProvider', () => ({
  ServiceHubProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="service-hub-provider">{children}</div>
  ),
}))

vi.mock('@/containers/dialogs/OutOfContextDialog', () => ({
  OutOfContextPromiseModal: () => <div data-testid="context-dialog" />,
}))

vi.mock('@/components/common/GlobalError', () => ({
  GlobalError: ({ error }: { error: Error }) => <div>{error.message}</div>,
}))

vi.mock('@/components/common/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-provider">{children}</div>
  ),
  SidebarInset: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-inset">{children}</div>
  ),
}))

vi.mock('@/components/left-sidebar', () => ({
  LeftSidebar: () => <nav data-testid="left-sidebar" />,
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
  reducedMotionTransition: {},
  reducedMotionVariants: {},
}))

vi.mock('@/lib/bootstrap/app-startup', () => ({
  hideInitialLoader: mocks.hideInitialLoader,
}))

import { Route as RootRoute } from '../__root'
import { Route as AxBiRoute } from '../ax-bi'

describe('root layout and ax-bi route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.location.pathname = '/'
    mocks.redirect.mockReturnValue(mocks.redirectError)
  })

  it('renders the root app layout with providers, sidebar, and outlet', () => {
    const Component = RootRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('service-hub-provider')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-provider')).toBeInTheDocument()
    expect(screen.getByTestId('left-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('shortcuts-provider')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('always renders the Electron update banner', () => {
    const Component = RootRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('electron-update-banner')).toBeInTheDocument()
  })

  it('renders root route errors through the global error boundary', () => {
    const ErrorComponent = RootRoute.errorComponent as React.ComponentType<{
      error: Error
    }>
    render(<ErrorComponent error={new Error('route failed')} />)

    expect(screen.getByText('route failed')).toBeInTheDocument()
  })

  it('redirects legacy AX BI bookmarks to its Settings page', () => {
    expect(() => AxBiRoute.beforeLoad?.({} as never)).toThrow(
      mocks.redirectError
    )
    expect(mocks.redirect).toHaveBeenCalledWith({ to: '/settings/ax-bi' })
  })
})
