import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn((selector) =>
    selector({
      deleteThread: vi.fn(),
      renameThread: vi.fn(),
      updateThread: vi.fn(),
    })
  ),
}))

vi.mock('@/hooks/useMessages', () => ({
  useMessages: vi.fn((selector) =>
    selector({ messages: {} })
  ),
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: vi.fn().mockReturnValue({
    getFolderById: vi.fn(),
    folders: [],
  }),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuAction: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  useSidebar: vi.fn().mockReturnValue({ isMobile: false }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue || key,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: React.ReactNode; to: string; params?: Record<string, string> }) => (
    <a href={`${to}/${params?.threadId || ''}`} data-testid="thread-link">
      {children}
    </a>
  ),
}))

vi.mock('@/containers/dialogs', () => ({
  RenameThreadDialog: () => null,
  DeleteThreadDialog: () => null,
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

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuSeparator: () => <hr />,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/lib/thread-export', () => ({
  exportThread: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import ThreadList from './ThreadList'

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: `thread-${Math.random().toString(36).slice(2)}`,
    title: 'Test Thread',
    updated: Date.now() / 1000,
    created: Date.now() / 1000,
    metadata: {},
    ...overrides,
  } as Thread
}

describe('ThreadList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders thread titles', () => {
    const threads = [
      makeThread({ id: 't1', title: 'First Thread' }),
      makeThread({ id: 't2', title: 'Second Thread' }),
    ]
    render(<ThreadList threads={threads} />)
    expect(screen.getByText('First Thread')).toBeInTheDocument()
    expect(screen.getByText('Second Thread')).toBeInTheDocument()
  })

  it('sorts threads by updated time descending', () => {
    const threads = [
      makeThread({ id: 't1', title: 'Old Thread', updated: 1000 }),
      makeThread({ id: 't2', title: 'New Thread', updated: 2000 }),
    ]
    render(<ThreadList threads={threads} />)
    const links = screen.getAllByTestId('thread-link')
    // New thread should appear first
    expect(links[0].textContent).toContain('New Thread')
    expect(links[1].textContent).toContain('Old Thread')
  })

  it('renders empty list gracefully', () => {
    const { container } = render(<ThreadList threads={[]} />)
    expect(container.querySelectorAll('li')).toHaveLength(0)
  })

  it('uses "New Thread" fallback title for untitled threads', () => {
    const threads = [makeThread({ id: 't1', title: '' })]
    render(<ThreadList threads={threads} />)
    // The i18n mock returns the key "common:newThread"
    expect(screen.getByText('common:newThread')).toBeInTheDocument()
  })
})

describe('formatRelativeTime (via ThreadItem)', () => {
  it('shows "Just now" for very recent threads', () => {
    const threads = [
      makeThread({ id: 't1', title: 'Recent', updated: Date.now() / 1000 }),
    ]
    render(<ThreadList threads={threads} currentProjectId="proj1" />)
    expect(screen.getByText('Just now')).toBeInTheDocument()
  })

  it('shows minutes ago for threads updated minutes ago', () => {
    const fiveMinAgo = Date.now() / 1000 - 300
    const threads = [
      makeThread({ id: 't1', title: 'Minutes', updated: fiveMinAgo }),
    ]
    render(<ThreadList threads={threads} currentProjectId="proj1" />)
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  it('shows hours ago for threads updated hours ago', () => {
    const twoHoursAgo = Date.now() / 1000 - 7200
    const threads = [
      makeThread({ id: 't1', title: 'Hours', updated: twoHoursAgo }),
    ]
    render(<ThreadList threads={threads} currentProjectId="proj1" />)
    expect(screen.getByText('2h ago')).toBeInTheDocument()
  })

  it('shows days ago for threads updated days ago', () => {
    const threeDaysAgo = Date.now() / 1000 - 259200
    const threads = [
      makeThread({ id: 't1', title: 'Days', updated: threeDaysAgo }),
    ]
    render(<ThreadList threads={threads} currentProjectId="proj1" />)
    expect(screen.getByText('3d ago')).toBeInTheDocument()
  })
})
