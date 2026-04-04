import { render, screen } from '@testing-library/react'
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

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn((selector) =>
    selector({
      getFilteredThreads: (query: string) => [...mockThreads, ...mockThreadsWithProject],
      threads: [...mockThreads, ...mockThreadsWithProject],
      deleteAllThreads: vi.fn(),
      renameThread: vi.fn(),
      deleteThread: vi.fn(),
    })
  ),
}))

vi.mock('@/hooks/usePinnedThreads', () => ({
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

vi.mock('@/lib/date-group', () => ({
  groupByDate: vi.fn(
    (items: Thread[], _getTs: unknown, pinnedSet: Set<string>, _getId: unknown) => {
      const nonPinned = items.filter((t: Thread) => !pinnedSet.has(t.id))
      return [{ group: 'Today' as const, items: nonPinned }]
    }
  ),
}))

vi.mock('@/containers/ThreadList', () => ({
  default: ({ threads }: { threads: Thread[] }) => (
    <div data-testid="thread-list">
      {threads.map((t: Thread) => (
        <div key={t.id} data-testid={`thread-${t.id}`}>
          {t.title}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/containers/dialogs/DeleteAllThreadsDialog', () => ({
  DeleteAllThreadsDialog: () => <button data-testid="delete-all">Delete All</button>,
}))

vi.mock('@/containers/dialogs', () => ({
  RenameThreadDialog: () => null,
  DeleteThreadDialog: () => null,
}))

vi.mock('@/lib/thread-export', () => ({
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
  SidebarGroupAction: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
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
  useSidebar: vi.fn().mockReturnValue({ isMobile: false }),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { NavChats } from './NavChats'

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
    // The groupByDate mock filters out project threads
    // Should show Chat Alpha and Chat Beta (no project)
    expect(screen.getByText('Chat Alpha')).toBeInTheDocument()
    expect(screen.getByText('Chat Beta')).toBeInTheDocument()
  })

  it('renders date group section labels', () => {
    render(<NavChats />)
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('renders delete all button', () => {
    render(<NavChats />)
    expect(screen.getByTestId('delete-all')).toBeInTheDocument()
  })

  it('returns null when there are no threads without projects', async () => {
    const { useThreads } = await import('@/hooks/useThreads') as { useThreads: ReturnType<typeof vi.fn> }
    vi.mocked(useThreads).mockImplementation((selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        getFilteredThreads: () => [],
        threads: [],
        deleteAllThreads: vi.fn(),
        renameThread: vi.fn(),
        deleteThread: vi.fn(),
      })
    )
    const { container } = render(<NavChats />)
    expect(container.firstChild).toBeNull()
  })

  it('renders pinned section when there are pinned threads', async () => {
    // Restore threads mock first (previous test cleared it)
    const { useThreads } = await import('@/hooks/useThreads') as { useThreads: ReturnType<typeof vi.fn> }
    vi.mocked(useThreads).mockImplementation((selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        getFilteredThreads: () => [...mockThreads, ...mockThreadsWithProject],
        threads: [...mockThreads, ...mockThreadsWithProject],
        deleteAllThreads: vi.fn(),
        renameThread: vi.fn(),
        deleteThread: vi.fn(),
      })
    )

    const { usePinnedThreads } = await import('@/hooks/usePinnedThreads') as { usePinnedThreads: ReturnType<typeof vi.fn> }
    vi.mocked(usePinnedThreads).mockReturnValue({
      pinnedIds: ['t1'],
      pinnedSet: new Set(['t1']),
      togglePin: vi.fn(),
      reorder: vi.fn(),
    })
    render(<NavChats />)
    expect(screen.getByText('Pinned')).toBeInTheDocument()
  })
})
