import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import { route } from '@/constants/routes'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setProjectDialogOpen: vi.fn(),
  onOpenChange: vi.fn(),
  threads: {
    'thread-alpha': {
      id: 'thread-alpha',
      title: 'Alpha roadmap',
      updated: 1,
      metadata: {},
    },
    'thread-beta': {
      id: 'thread-beta',
      title: 'Beta notes',
      updated: 2,
      metadata: {},
    },
  } as Record<string, Thread>,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: (
    selector: (state: { threads: Record<string, Thread> }) => unknown
  ) => selector({ threads: mocks.threads }),
}))

vi.mock('@/hooks/ui/useProjectDialog', () => ({
  useProjectDialog: () => ({ setOpen: mocks.setProjectDialogOpen }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? translations[key] ?? key,
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode
    open: boolean
  }) => (open ? <div data-testid="search-dialog-root">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

vi.mock('@radix-ui/react-visually-hidden', () => ({
  VisuallyHidden: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

vi.mock('lucide-react', () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="icon" {...props} />
  )

  return {
    MessageSquare: Icon,
    Search: Icon,
    Plus: Icon,
    FolderPlus: Icon,
    Settings: Icon,
    Plug: Icon,
    Palette: Icon,
    Server: Icon,
    Cpu: Icon,
    History: Icon,
    FolderOpen: Icon,
    Blocks: Icon,
  }
})

import { SearchDialog } from '../SearchDialog'

const translations: Record<string, string> = {
  'common:actions': 'Actions',
  'common:all': 'All',
  'common:chats': 'Chats',
  'common:clearRecent': 'Clear recent',
  'common:commands': 'Commands',
  'common:filter': 'Filter',
  'common:navigate': 'Navigate',
  'common:newChat': 'New Chat',
  'common:noResultsFound': 'No results found',
  'common:noResultsFoundDesc': 'Try a different search',
  'common:recents': 'Recents',
  'common:search': 'Search',
  'common:searchThreads': 'Search threads',
  'common:settings': 'Settings',
  'common:toNavigate': 'to navigate',
  'common:toSelect': 'to select',
  'settings:hardware.title': 'Hardware',
  'settings:mcpServers.title': 'MCP Servers',
  'settings:providers': 'Model Providers',
}

describe('SearchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('selects a filtered thread with Enter and records it as recent', async () => {
    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)

    const input = screen.getByRole('textbox', { name: 'Search' })
    fireEvent.change(input, { target: { value: 'Alpha' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: route.threadsDetail,
        params: { threadId: 'thread-alpha' },
      })
    })
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
    expect(
      JSON.parse(localStorage.getItem(localStorageKey.recentSearches) ?? '[]')
    ).toEqual(['thread-alpha'])
  })

  it('deduplicates recent searches when clicking a recent thread', async () => {
    localStorage.setItem(
      localStorageKey.recentSearches,
      JSON.stringify(['thread-beta', 'thread-alpha'])
    )

    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)

    fireEvent.click(screen.getByRole('option', { name: 'Alpha roadmap' }))

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: route.threadsDetail,
        params: { threadId: 'thread-alpha' },
      })
    })
    expect(
      JSON.parse(localStorage.getItem(localStorageKey.recentSearches) ?? '[]')
    ).toEqual(['thread-alpha', 'thread-beta'])
  })

  it('clears rendered recent searches and persisted recent ids', () => {
    localStorage.setItem(
      localStorageKey.recentSearches,
      JSON.stringify(['thread-beta', 'thread-alpha'])
    )

    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)

    expect(screen.getByRole('option', { name: 'Alpha roadmap' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear recent' }))

    expect(localStorage.getItem(localStorageKey.recentSearches)).toBeNull()
    expect(screen.queryByRole('option', { name: 'Alpha roadmap' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Beta notes' })).toBeNull()
  })
})
