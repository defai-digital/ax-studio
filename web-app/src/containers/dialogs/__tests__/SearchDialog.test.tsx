import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import { route } from '@/constants/routes'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setProjectDialogOpen: vi.fn(),
  onOpenChange: vi.fn(),
  updateCurrentThreadModel: vi.fn(),
  selectModelProvider: vi.fn(),
  providers: [] as unknown[],
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
  folders: [] as { id: string; name: string; updatedAt: number }[],
  tags: [] as { id: string; name: string }[],
  pinnedIds: [] as string[],
  indexSnapshot: {
    status: 'idle',
    version: 0,
    documents: new Map<string, string>(),
  } as {
    status: 'idle' | 'indexing' | 'ready'
    version: number
    documents: Map<string, string>
  },
  ensureIndex: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      threads: mocks.threads,
      updateCurrentThreadModel: mocks.updateCurrentThreadModel,
    }),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      providers: mocks.providers,
      selectModelProvider: mocks.selectModelProvider,
    }),
}))

vi.mock('sonner', () => ({ toast: vi.fn() }))

vi.mock('@/hooks/ui/useProjectDialog', () => ({
  useProjectDialog: () => ({ setOpen: mocks.setProjectDialogOpen }),
}))

vi.mock('@/hooks/threads/useChatOrganization', () => ({
  useChatOrganizationStore: (
    selector: (state: { folders: unknown[]; tags: unknown[] }) => unknown
  ) => selector({ folders: mocks.folders, tags: mocks.tags }),
}))

vi.mock('@/hooks/threads/usePinnedThreads', () => ({
  usePinnedThreads: () => ({
    pinnedIds: mocks.pinnedIds,
    pinnedSet: new Set(mocks.pinnedIds),
    togglePin: vi.fn(),
    isPinned: (threadId: string) => mocks.pinnedIds.includes(threadId),
    reorder: vi.fn(),
  }),
}))

vi.mock('@/lib/search/message-search-index', () => ({
  ensureMessageSearchIndex: (threads: Record<string, Thread>) =>
    mocks.ensureIndex(threads),
  subscribeMessageSearchIndex: () => () => {},
  getMessageSearchIndexSnapshot: () => mocks.indexSnapshot,
  getMessageSearchContent: (threadId: string) =>
    mocks.indexSnapshot.documents.get(threadId),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? translations[key] ?? key,
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="search-dialog-root">{children}</div> : null,
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
    Settings2: Icon,
    BarChart3: Icon,
    Plug: Icon,
    Palette: Icon,
    Server: Icon,
    ServerCog: Icon,
    Database: Icon,
    Sparkles: Icon,
    Cpu: Icon,
    History: Icon,
    FolderOpen: Icon,
    Blocks: Icon,
    Bot: Icon,
    Lock: Icon,
    ShieldCheck: Icon,
    Paperclip: Icon,
    Route: Icon,
    Keyboard: Icon,
    Puzzle: Icon,
    Network: Icon,
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
  'common:indexingMessages': 'Indexing messages…',
  'common:navigate': 'Navigate',
  'common:newChat': 'New Chat',
  'common:noResultsFound': 'No results found',
  'common:noResultsFoundDesc': 'Try a different search',
  'common:recents': 'Recents',
  'common:search': 'Search',
  'common:searchThreads': 'Search threads',
  'common:settings': 'Settings',
  'common:axEngine': 'AX Engine',
  'common:toNavigate': 'to navigate',
  'common:toSelect': 'to select',
  'settings:hardware.title': 'Hardware',
  'settings:mcpServers.title': 'MCP Servers',
  'settings:providers': 'Cloud Model Providers',
}

describe('SearchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.providers = []
    mocks.threads = {
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
    } as Record<string, Thread>
    mocks.folders = []
    mocks.tags = []
    mocks.pinnedIds = []
    mocks.indexSnapshot = { status: 'idle', version: 0, documents: new Map() }
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

  it('drops stale and duplicate recent ids when storing a selected thread', async () => {
    localStorage.setItem(
      localStorageKey.recentSearches,
      JSON.stringify([
        'missing-thread',
        'thread-beta',
        'thread-beta',
        'thread-alpha',
        '',
        42,
      ])
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

    expect(
      screen.getByRole('option', { name: 'Alpha roadmap' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear recent' }))

    expect(localStorage.getItem(localStorageKey.recentSearches)).toBeNull()
    expect(screen.queryByRole('option', { name: 'Alpha roadmap' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Beta notes' })).toBeNull()
  })

  it('does not show models in the empty-state command list', () => {
    mocks.providers = [
      { provider: 'openai', active: true, models: [{ id: 'gpt-4o' }] },
    ]
    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)
    // No query yet → models are search-only, not listed
    expect(screen.queryByRole('option', { name: /gpt-4o/ })).toBeNull()
  })

  it('surfaces a model on search and switches to it on select', async () => {
    mocks.providers = [
      { provider: 'openai', active: true, models: [{ id: 'gpt-4o' }] },
      { provider: 'disabled-co', active: false, models: [{ id: 'secret' }] },
    ]
    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)

    const input = screen.getByRole('textbox', { name: 'Search' })
    fireEvent.change(input, { target: { value: 'gpt-4o' } })

    const option = await screen.findByRole('option', { name: /gpt-4o/ })
    fireEvent.click(option)

    expect(mocks.selectModelProvider).toHaveBeenCalledWith('openai', 'gpt-4o')
    expect(mocks.updateCurrentThreadModel).toHaveBeenCalledWith({
      id: 'gpt-4o',
      provider: 'openai',
    })
    expect(
      JSON.parse(localStorage.getItem(localStorageKey.lastUsedModel) ?? '{}')
    ).toEqual({ provider: 'openai', model: 'gpt-4o' })
  })

  it('excludes models from inactive providers even when searched', () => {
    mocks.providers = [
      {
        provider: 'disabled-co',
        active: false,
        models: [{ id: 'secret-model' }],
      },
    ]
    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'secret-model' },
    })
    expect(screen.queryByRole('option', { name: /secret-model/ })).toBeNull()
  })

  it('filters chats by folder: prefix, resolving names case-insensitively', () => {
    mocks.folders = [{ id: 'folder-work', name: 'Work', updatedAt: 1 }]
    mocks.threads['thread-alpha'].metadata = { folderId: 'folder-work' }

    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'folder:work' },
    })

    expect(
      screen.getByRole('option', { name: 'Alpha roadmap' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Beta notes' })).toBeNull()
  })

  it('filters chats by tag: prefix', () => {
    mocks.tags = [{ id: 'tag-urgent', name: 'urgent' }]
    mocks.threads['thread-beta'].metadata = { tagIds: ['tag-urgent'] }

    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'tag:urgent' },
    })

    expect(
      screen.getByRole('option', { name: 'Beta notes' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Alpha roadmap' })).toBeNull()
  })

  it('filters chats by is:pinned', () => {
    mocks.pinnedIds = ['thread-alpha']

    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'is:pinned' },
    })

    expect(
      screen.getByRole('option', { name: 'Alpha roadmap' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Beta notes' })).toBeNull()
  })

  it('combines prefix filters with free text', () => {
    mocks.folders = [{ id: 'folder-work', name: 'Work', updatedAt: 1 }]
    mocks.threads['thread-alpha'].metadata = { folderId: 'folder-work' }
    mocks.threads['thread-beta'].metadata = { folderId: 'folder-work' }

    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'folder:Work roadmap' },
    })

    expect(
      screen.getByRole('option', { name: 'Alpha roadmap' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Beta notes' })).toBeNull()
  })

  it('shows no chat results when a folder name matches nothing', () => {
    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'folder:Ghost' },
    })

    expect(screen.queryByRole('option', { name: 'Alpha roadmap' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Beta notes' })).toBeNull()
    expect(screen.getByText('No results found')).toBeInTheDocument()
  })

  it('renders a highlighted snippet when message content matches', () => {
    mocks.indexSnapshot = {
      status: 'ready',
      version: 1,
      documents: new Map([
        [
          'thread-alpha',
          'some long prefix text about roadmap planning and more text here',
        ],
      ]),
    }

    const { container } = render(
      <SearchDialog open onOpenChange={mocks.onOpenChange} />
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'planning' },
    })

    expect(
      screen.getByRole('option', { name: /Alpha roadmap/ })
    ).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Beta notes/ })).toBeNull()
    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark?.textContent).toBe('planning')
  })

  it('orders chat results by most recently updated', () => {
    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'a' },
    })

    const options = screen
      .getAllByRole('option')
      .map((element) => element.textContent ?? '')
    const betaIndex = options.findIndex((text) => text.includes('Beta notes'))
    const alphaIndex = options.findIndex((text) =>
      text.includes('Alpha roadmap')
    )
    expect(betaIndex).toBeGreaterThanOrEqual(0)
    expect(alphaIndex).toBeGreaterThan(betaIndex)
  })

  it('shows an indexing hint in the footer while the content index builds', () => {
    mocks.indexSnapshot = {
      status: 'indexing',
      version: 0,
      documents: new Map(),
    }

    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'Al' },
    })

    expect(screen.getByTestId('indexing-indicator')).toHaveTextContent(
      'Indexing messages…'
    )
  })

  it('triggers content indexing only once free text reaches 2 characters', () => {
    render(<SearchDialog open onOpenChange={mocks.onOpenChange} />)
    const input = screen.getByRole('textbox', { name: 'Search' })

    fireEvent.change(input, { target: { value: 'A' } })
    expect(mocks.ensureIndex).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'Al' } })
    expect(mocks.ensureIndex).toHaveBeenCalledWith(mocks.threads)
  })

  it('degrades to title-only results while no content is indexed', () => {
    const { container } = render(
      <SearchDialog open onOpenChange={mocks.onOpenChange} />
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'Beta' },
    })

    expect(
      screen.getByRole('option', { name: 'Beta notes' })
    ).toBeInTheDocument()
    expect(container.querySelector('mark')).toBeNull()
  })
})
