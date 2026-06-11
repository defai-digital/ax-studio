import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KeyboardShortcutsProvider } from '../KeyboardShortcuts'

const mockSetLeftPanel = vi.fn()
const mockSetSearchOpen = vi.fn()
const mockSetProjectDialogOpen = vi.fn()
const mockNavigate = vi.fn()

vi.mock('@/hooks/ui/useHotkeys', () => ({
  useKeyboardShortcut: vi.fn(),
}))

vi.mock('@/hooks/ui/useLeftPanel', () => ({
  useLeftPanel: vi.fn(() => ({
    open: false,
    setLeftPanel: mockSetLeftPanel,
  })),
}))

vi.mock('@/hooks/ui/useSearchDialog', () => ({
  useSearchDialog: vi.fn(() => ({
    setOpen: mockSetSearchOpen,
  })),
}))

vi.mock('@/hooks/ui/useProjectDialog', () => ({
  useProjectDialog: vi.fn(() => ({
    setOpen: mockSetProjectDialogOpen,
  })),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: vi.fn(() => ({
    navigate: mockNavigate,
  })),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    home: '/',
    settings: { general: '/settings/general' },
  },
}))

vi.mock('@/lib/shortcuts', () => ({
  PlatformShortcuts: {
    TOGGLE_SIDEBAR: { key: 'b', meta: true },
    NEW_CHAT: { key: 'n', meta: true },
    NEW_PROJECT: { key: 'p', meta: true, shift: true },
    GO_TO_SETTINGS: { key: ',', meta: true },
    SEARCH: { key: 'k', meta: true },
  },
  ShortcutAction: {
    TOGGLE_SIDEBAR: 'TOGGLE_SIDEBAR',
    NEW_CHAT: 'NEW_CHAT',
    NEW_PROJECT: 'NEW_PROJECT',
    GO_TO_SETTINGS: 'GO_TO_SETTINGS',
    SEARCH: 'SEARCH',
  },
}))

describe('KeyboardShortcutsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders null (no visible output)', () => {
    const { container } = render(<KeyboardShortcutsProvider />)
    expect(container.innerHTML).toBe('')
  })

  it('registers five keyboard shortcuts via useKeyboardShortcut', async () => {
    const { useKeyboardShortcut } = await import('@/hooks/ui/useHotkeys')

    render(<KeyboardShortcutsProvider />)

    // 5 shortcuts: sidebar, new chat, new project, settings, search
    expect(useKeyboardShortcut).toHaveBeenCalledTimes(5)
  })

  it('passes shortcut specs with callback functions', async () => {
    const { useKeyboardShortcut } = await import('@/hooks/ui/useHotkeys')

    render(<KeyboardShortcutsProvider />)

    const calls = vi.mocked(useKeyboardShortcut).mock.calls
    for (const call of calls) {
      expect(call[0]).toHaveProperty('callback')
      expect(typeof call[0].callback).toBe('function')
    }
  })

  it('sidebar shortcut callback toggles left panel', async () => {
    const { useKeyboardShortcut } = await import('@/hooks/ui/useHotkeys')

    render(<KeyboardShortcutsProvider />)

    // First call is the sidebar shortcut
    const sidebarCallback = vi.mocked(useKeyboardShortcut).mock.calls[0][0].callback
    sidebarCallback()

    // open is false, so setLeftPanel should be called with !false = true
    expect(mockSetLeftPanel).toHaveBeenCalledWith(true)
  })

  it('new chat shortcut callback navigates to home', async () => {
    const { useKeyboardShortcut } = await import('@/hooks/ui/useHotkeys')

    render(<KeyboardShortcutsProvider />)

    const newChatCallback = vi.mocked(useKeyboardShortcut).mock.calls[1][0].callback
    newChatCallback()

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('new project shortcut callback opens project dialog', async () => {
    const { useKeyboardShortcut } = await import('@/hooks/ui/useHotkeys')

    render(<KeyboardShortcutsProvider />)

    const newProjectCallback = vi.mocked(useKeyboardShortcut).mock.calls[2][0].callback
    newProjectCallback()

    expect(mockSetProjectDialogOpen).toHaveBeenCalledWith(true)
  })

  it('settings shortcut callback navigates to settings page', async () => {
    const { useKeyboardShortcut } = await import('@/hooks/ui/useHotkeys')

    render(<KeyboardShortcutsProvider />)

    const settingsCallback = vi.mocked(useKeyboardShortcut).mock.calls[3][0].callback
    settingsCallback()

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/settings/general' })
  })

  it('search shortcut callback opens search dialog', async () => {
    const { useKeyboardShortcut } = await import('@/hooks/ui/useHotkeys')

    render(<KeyboardShortcutsProvider />)

    const searchCallback = vi.mocked(useKeyboardShortcut).mock.calls[4][0].callback
    searchCallback()

    expect(mockSetSearchOpen).toHaveBeenCalledWith(true)
  })
})
