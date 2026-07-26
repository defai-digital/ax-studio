import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: vi.fn((selector) =>
    selector({
      deleteThread: vi.fn(),
      renameThread: vi.fn(),
      updateThread: vi.fn(),
    })
  ),
}))

vi.mock('@/hooks/chat/useMessages', () => ({
  useMessages: vi.fn((selector) => selector({ messages: {} })),
}))

vi.mock('@/hooks/threads/useThreadManagement', () => ({
  useThreadManagement: vi.fn().mockReturnValue({
    getFolderById: vi.fn(),
    folders: [],
  }),
}))

const mockChatOrganization = vi.hoisted(() => ({
  folders: [
    { id: 'f1', name: 'Work', updatedAt: 200 },
    { id: 'f2', name: 'Personal', updatedAt: 100 },
  ],
  tags: [
    { id: 'tag1', name: 'urgent' },
    { id: 'tag2', name: 'later' },
  ],
  addFolder: vi.fn(),
  addTag: vi.fn(),
  assignFolder: vi.fn(),
  setThreadTags: vi.fn(),
}))

vi.mock('@/hooks/threads/useChatOrganization', () => ({
  useChatOrganization: () => mockChatOrganization,
  useChatOrganizationStore: () => mockChatOrganization,
}))

const namePromptProps = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/containers/dialogs/chat-organization/NamePromptDialog', () => ({
  NamePromptDialog: (props: Record<string, unknown>) => {
    namePromptProps.calls.push(props)
    return props.open ? (
      <div data-testid="name-prompt-dialog">{String(props.title)}</div>
    ) : null
  },
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuAction: ({
    children,
    showOnHover,
    ...props
  }: {
    children: React.ReactNode
    showOnHover?: boolean
  }) => <button {...props}>{children}</button>,
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
}))

vi.mock('@/components/ui/sidebar-context', () => ({
  useSidebar: vi.fn().mockReturnValue({ isMobile: false }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue || key,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, string>
  }) => (
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
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    onClick,
    disabled,
  }: {
    children: React.ReactNode
    onSelect?: (e: React.MouseEvent) => void
    onClick?: (e: React.MouseEvent) => void
    disabled?: boolean
  }) => (
    <div
      aria-disabled={disabled}
      onClick={(e) => {
        if (disabled) return
        onClick?.(e)
        onSelect?.(e)
      }}
    >
      {children}
    </div>
  ),
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange,
    onSelect,
  }: {
    children: React.ReactNode
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    onSelect?: (e: React.MouseEvent) => void
  }) => (
    <div
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={(e) => {
        onSelect?.(e)
        onCheckedChange?.(!checked)
      }}
    >
      {children}
    </div>
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

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="context-menu-content">{children}</div>
  ),
  ContextMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: React.ReactNode
    onSelect?: (e: React.MouseEvent) => void
    disabled?: boolean
  }) => (
    <div
      aria-disabled={disabled}
      onClick={(e) => {
        if (disabled) return
        onSelect?.(e)
      }}
    >
      {children}
    </div>
  ),
  ContextMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange,
    onSelect,
  }: {
    children: React.ReactNode
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    onSelect?: (e: React.MouseEvent) => void
  }) => (
    <div
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={(e) => {
        onSelect?.(e)
        onCheckedChange?.(!checked)
      }}
    >
      {children}
    </div>
  ),
  ContextMenuSeparator: () => <hr />,
  ContextMenuSub: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ContextMenuSubContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuSubTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/lib/export/thread-export', () => ({
  CHAT_EXPORT_OPTIONS: [
    { format: 'json', label: 'JSON' },
    { format: 'csv', label: 'CSV' },
    { format: 'alpaca', label: 'JSON (Alpaca)' },
    { format: 'openai-jsonl', label: 'JSONL (OpenAI)' },
  ],
  exportThread: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { ThreadList } from '../ThreadList'

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

  it('does not render scriptable chat logo data URIs', () => {
    const threads = [
      makeThread({
        id: 't1',
        title: 'Logo Thread',
        metadata: {
          chatLogo:
            'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+',
        },
      }),
    ]

    render(<ThreadList threads={threads} />)

    expect(screen.queryByRole('img', { name: 'Logo Thread' })).toBeNull()
  })
})

describe('ThreadItem folder and tag menus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    namePromptProps.calls.length = 0
  })

  it('renders Move to folder with None, folders sorted by updatedAt desc, and New folder', () => {
    render(<ThreadList threads={[makeThread({ id: 't1' })]} />)

    const dropdown = screen.getByTestId('dropdown-content')
    expect(
      within(dropdown).getByText('common:chatOrganization.moveToFolder')
    ).toBeInTheDocument()
    expect(
      within(dropdown).getByText('common:chatOrganization.noFolder')
    ).toBeInTheDocument()
    expect(within(dropdown).getByText('Work')).toBeInTheDocument()
    expect(within(dropdown).getByText('Personal')).toBeInTheDocument()
    expect(
      within(dropdown).getByText('common:chatOrganization.newFolder…')
    ).toBeInTheDocument()

    // Work (updatedAt 200) sorts before Personal (updatedAt 100)
    const text = dropdown.textContent ?? ''
    expect(text.indexOf('Work')).toBeLessThan(text.indexOf('Personal'))
  })

  it('assigns a folder from the dropdown menu', () => {
    render(<ThreadList threads={[makeThread({ id: 't1' })]} />)

    fireEvent.click(
      within(screen.getByTestId('dropdown-content')).getByText('Work')
    )

    expect(mockChatOrganization.assignFolder).toHaveBeenCalledWith('t1', 'f1')
  })

  it('clears the folder via the None option', () => {
    render(
      <ThreadList
        threads={[makeThread({ id: 't1', metadata: { folderId: 'f1' } })]}
      />
    )

    fireEvent.click(
      within(screen.getByTestId('dropdown-content')).getByText(
        'common:chatOrganization.noFolder'
      )
    )

    expect(mockChatOrganization.assignFolder).toHaveBeenCalledWith('t1', null)
  })

  it('does not reassign when selecting the current folder', () => {
    render(
      <ThreadList
        threads={[makeThread({ id: 't1', metadata: { folderId: 'f1' } })]}
      />
    )

    fireEvent.click(
      within(screen.getByTestId('dropdown-content')).getByText('Work')
    )

    expect(mockChatOrganization.assignFolder).not.toHaveBeenCalled()
  })

  it('renders Move to folder and Edit tags unconditionally', () => {
    render(<ThreadList threads={[makeThread({ id: 't1' })]} />)

    expect(
      screen.getAllByText('common:chatOrganization.moveToFolder').length
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText('common:chatOrganization.editTags').length
    ).toBeGreaterThan(0)
  })

  it('toggles tags from the Edit tags submenu', () => {
    render(
      <ThreadList
        threads={[makeThread({ id: 't1', metadata: { tagIds: ['tag1'] } })]}
      />
    )

    const dropdown = screen.getByTestId('dropdown-content')
    const urgent = within(dropdown).getByRole('menuitemcheckbox', {
      name: 'urgent',
    })
    const later = within(dropdown).getByRole('menuitemcheckbox', {
      name: 'later',
    })

    expect(urgent).toHaveAttribute('aria-checked', 'true')
    expect(later).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(later)
    expect(mockChatOrganization.setThreadTags).toHaveBeenCalledWith('t1', [
      'tag1',
      'tag2',
    ])

    fireEvent.click(urgent)
    expect(mockChatOrganization.setThreadTags).toHaveBeenCalledWith('t1', [])
  })

  it('creates a new folder from the dialog and assigns the thread to it', async () => {
    mockChatOrganization.addFolder.mockResolvedValue({
      id: 'f3',
      name: 'Fresh',
      updatedAt: 1,
    })
    render(<ThreadList threads={[makeThread({ id: 't1' })]} />)

    fireEvent.click(
      within(screen.getByTestId('dropdown-content')).getByText(
        'common:chatOrganization.newFolder…'
      )
    )

    expect(screen.getByTestId('name-prompt-dialog')).toHaveTextContent(
      'common:chatOrganization.newFolder'
    )

    const openCall = namePromptProps.calls.findLast(
      (call) => call.open === true && call.title === 'common:chatOrganization.newFolder'
    )
    expect(openCall).toBeDefined()

    await act(async () => {
      await (openCall!.onSubmit as (name: string) => Promise<void>)('Fresh')
    })

    expect(mockChatOrganization.addFolder).toHaveBeenCalledWith('Fresh')
    expect(mockChatOrganization.assignFolder).toHaveBeenCalledWith('t1', 'f3')
  })

  it('creates a new tag from the dialog and applies it to the thread', async () => {
    mockChatOrganization.addTag.mockResolvedValue({ id: 'tag3', name: 'Fresh' })
    render(<ThreadList threads={[makeThread({ id: 't1' })]} />)

    fireEvent.click(
      within(screen.getByTestId('dropdown-content')).getByText(
        'common:chatOrganization.newTag…'
      )
    )

    const openCall = namePromptProps.calls.findLast(
      (call) => call.open === true && call.title === 'common:chatOrganization.newTag'
    )
    expect(openCall).toBeDefined()

    await act(async () => {
      await (openCall!.onSubmit as (name: string) => Promise<void>)('Fresh')
    })

    expect(mockChatOrganization.addTag).toHaveBeenCalledWith('Fresh')
    expect(mockChatOrganization.setThreadTags).toHaveBeenCalledWith('t1', [
      'tag3',
    ])
  })

  it('offers the same folder and tag menus in the right-click context menu', () => {
    render(<ThreadList threads={[makeThread({ id: 't1' })]} />)

    const contextMenu = screen.getByTestId('context-menu-content')
    expect(
      within(contextMenu).getByText('common:chatOrganization.moveToFolder')
    ).toBeInTheDocument()
    expect(
      within(contextMenu).getByText('common:chatOrganization.editTags')
    ).toBeInTheDocument()

    fireEvent.click(within(contextMenu).getByText('Personal'))
    expect(mockChatOrganization.assignFolder).toHaveBeenCalledWith('t1', 'f2')

    fireEvent.click(
      within(contextMenu).getByRole('menuitemcheckbox', { name: 'urgent' })
    )
    expect(mockChatOrganization.setThreadTags).toHaveBeenCalledWith('t1', [
      'tag1',
    ])
  })
})
