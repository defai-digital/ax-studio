import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockThreads: Thread[] = [
  {
    id: 't1',
    title: 'Chat Alpha',
    updated: Date.now() / 1000 - 60,
    created: Date.now() / 1000 - 3600,
    metadata: {},
  } as Thread,
  {
    id: 't2',
    title: 'Chat Beta',
    updated: Date.now() / 1000 - 120,
    created: Date.now() / 1000 - 7200,
    metadata: {},
  } as Thread,
]

const mockThreadsWithProject: Thread[] = [
  {
    id: 't3',
    title: 'Project Chat',
    updated: Date.now() / 1000,
    created: Date.now() / 1000,
    metadata: { project: { id: 'p1', name: 'Project A' } },
  } as Thread,
]

const mockTemporaryThreads: Thread[] = [
  {
    id: 'temporary-chat',
    title: 'Temporary Chat',
    updated: Date.now() / 1000,
    created: Date.now() / 1000,
    metadata: {},
  } as Thread,
]

function toThreadRecord(threads: Thread[]) {
  return Object.fromEntries(threads.map((thread) => [thread.id, thread]))
}

const allMockThreads = [
  ...mockThreads,
  ...mockThreadsWithProject,
  ...mockTemporaryThreads,
]

vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: vi.fn((selector) =>
    selector({
      getFilteredThreads: (_query: string) => allMockThreads,
      threads: toThreadRecord(allMockThreads),
      deleteAllThreads: vi.fn(),
      renameThread: vi.fn(),
      deleteThread: vi.fn(),
    })
  ),
}))

vi.mock('@/hooks/threads/usePinnedThreads', () => ({
  usePinnedThreads: vi.fn().mockReturnValue({
    pinnedIds: [],
    pinnedSet: new Set(),
    togglePin: vi.fn(),
    reorder: vi.fn(),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:chats': 'Chats',
        'common:newThread': 'New Thread',
        'common:rename': 'Rename',
        'common:delete': 'Delete',
      }
      return map[key] || key
    },
  }),
}))

vi.mock('@/lib/utils/date-group', () => ({
  groupByDate: vi.fn(
    (
      items: Thread[],
      _getTs: unknown,
      pinnedSet: Set<string>,
      _getId: unknown
    ) => {
      const nonPinned = items.filter((t: Thread) => !pinnedSet.has(t.id))
      return [{ group: 'Today' as const, items: nonPinned }]
    }
  ),
}))

vi.mock('@/containers/ThreadList', () => ({
  ThreadList: ({ threads }: { threads: Thread[] }) => (
    <div data-testid="thread-list">
      {threads.map((t: Thread) => (
        <div key={t.id} data-testid={`thread-${t.id}`}>
          {t.title}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/containers/dialogs/thread/DeleteAllThreadsDialog', () => ({
  DeleteAllThreadsDialog: () => (
    <button data-testid="delete-all">Delete All</button>
  ),
}))

vi.mock('@/containers/dialogs', () => ({
  RenameThreadDialog: () => null,
  DeleteThreadDialog: () => null,
}))

vi.mock('@/lib/export/thread-export', () => ({
  CHAT_EXPORT_OPTIONS: [
    { format: 'json', label: 'JSON' },
    { format: 'csv', label: 'CSV' },
    { format: 'alpaca', label: 'JSON (Alpaca)' },
    { format: 'openai-jsonl', label: 'JSONL (OpenAI)' },
  ],
  exportThread: vi.fn(),
  exportAllThreads: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-group">{children}</div>
  ),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => (
    <h3 data-testid="sidebar-group-label">{children}</h3>
  ),
  SidebarGroupAction: ({
    children,
    ...props
  }: {
    children: React.ReactNode
  }) => <button {...props}>{children}</button>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul data-testid="sidebar-menu">{children}</ul>
  ),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarMenuAction: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}))

vi.mock('@/components/ui/sidebar-context', () => ({
  useSidebar: vi.fn().mockReturnValue({ isMobile: false }),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { NavChats } from '../NavChats'

describe('NavChats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the "Chats" label', () => {
    render(<NavChats />)
    expect(screen.getByText('Chats')).toBeInTheDocument()
  })

  it('renders thread list with non-project threads only', () => {
    render(<NavChats />)
    // Should show Chat Alpha and Chat Beta, but no project or temporary threads.
    expect(screen.getByText('Chat Alpha')).toBeInTheDocument()
    expect(screen.getByText('Chat Beta')).toBeInTheDocument()
    expect(screen.queryByText('Project Chat')).toBeNull()
    expect(screen.queryByText('Temporary Chat')).toBeNull()
  })

  it('renders date group section labels', () => {
    render(<NavChats />)
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('renders delete all button', () => {
    render(<NavChats />)
    expect(screen.getByTestId('delete-all')).toBeInTheDocument()
  })

  it('renders an empty state when there are no threads without projects', async () => {
    const { useThreads } = (await import('@/hooks/threads/useThreads')) as {
      useThreads: ReturnType<typeof vi.fn>
    }
    vi.mocked(useThreads).mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) =>
        selector({
          getFilteredThreads: () => [],
          threads: {},
          deleteAllThreads: vi.fn(),
          renameThread: vi.fn(),
          deleteThread: vi.fn(),
        })
    )
    render(<NavChats />)
    expect(screen.getByText('No chats yet')).toBeInTheDocument()
    expect(screen.getByText('New Chat')).toBeInTheDocument()
  })

  it('renders pinned section when there are pinned threads', async () => {
    // Restore threads mock first (previous test cleared it)
    const { useThreads } = (await import('@/hooks/threads/useThreads')) as {
      useThreads: ReturnType<typeof vi.fn>
    }
    vi.mocked(useThreads).mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) =>
        selector({
          getFilteredThreads: () => [...mockThreads, ...mockThreadsWithProject],
          threads: toThreadRecord([...mockThreads, ...mockThreadsWithProject]),
          deleteAllThreads: vi.fn(),
          renameThread: vi.fn(),
          deleteThread: vi.fn(),
        })
    )

    const { usePinnedThreads } = (await import(
      '@/hooks/threads/usePinnedThreads'
    )) as { usePinnedThreads: ReturnType<typeof vi.fn> }
    vi.mocked(usePinnedThreads).mockReturnValue({
      pinnedIds: ['t1'],
      pinnedSet: new Set(['t1']),
      togglePin: vi.fn(),
      reorder: vi.fn(),
    })
    render(<NavChats />)
    expect(screen.getByText('Pinned')).toBeInTheDocument()
  })

  it('reorders pinned threads via keyboard (dnd-kit KeyboardSensor)', async () => {
    const { useThreads } = (await import('@/hooks/threads/useThreads')) as {
      useThreads: ReturnType<typeof vi.fn>
    }
    vi.mocked(useThreads).mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) =>
        selector({
          getFilteredThreads: () => mockThreads,
          threads: toThreadRecord(mockThreads),
          deleteAllThreads: vi.fn(),
          renameThread: vi.fn(),
          deleteThread: vi.fn(),
        })
    )

    const reorder = vi.fn()
    const { usePinnedThreads } = (await import(
      '@/hooks/threads/usePinnedThreads'
    )) as { usePinnedThreads: ReturnType<typeof vi.fn> }
    vi.mocked(usePinnedThreads).mockReturnValue({
      pinnedIds: ['t1', 't2'],
      pinnedSet: new Set(['t1', 't2']),
      togglePin: vi.fn(),
      reorder,
    })

    // jsdom reports zero rects; give each sortable row a stacked 32px rect so
    // dnd-kit collision detection can resolve the drop target.
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const label =
          this.querySelector?.('[aria-label^="Reorder"]')?.getAttribute(
            'aria-label'
          ) ?? ''
        const index = label.includes('Beta') ? 1 : 0
        return {
          x: 0,
          y: index * 32,
          top: index * 32,
          left: 0,
          right: 200,
          bottom: index * 32 + 32,
          width: 200,
          height: 32,
          toJSON: () => ({}),
        } as DOMRect
      })

    try {
      render(<NavChats />)

      const handle = screen.getByRole('button', { name: 'Reorder Chat Beta' })
      handle.focus()
      // Lift, move up one row, drop.
      fireEvent.keyDown(handle, { code: 'Space' })
      // dnd-kit's KeyboardSensor attaches its move/end keydown listeners in a
      // setTimeout after activation — flush a macrotask before moving.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      fireEvent.keyDown(handle, { code: 'ArrowUp' })
      fireEvent.keyDown(handle, { code: 'Space' })

      expect(reorder).toHaveBeenCalledWith(['t2', 't1'])
    } finally {
      rectSpy.mockRestore()
    }
  })
})
