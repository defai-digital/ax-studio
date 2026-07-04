import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const threadsState = { threads: {} as Record<string, Thread> }

vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: (selector: (s: typeof threadsState) => unknown) =>
    selector(threadsState),
}))

vi.mock('@/constants/routes', () => ({
  route: { threadsDetail: '/threads/$threadId' },
}))

vi.mock('@/constants/chat', () => ({ TEMPORARY_CHAT_ID: 'temp' }))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
  }: {
    children: React.ReactNode
    params: { threadId: string }
  }) => (
    <a href="#" data-thread={params.threadId}>
      {children}
    </a>
  ),
}))

// Render popover + sidebar wrappers inline so content is queryable.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}))

vi.mock('lucide-react', () => ({
  History: () => <svg />,
  MessageCircle: () => <svg />,
}))

import { CollapsedRecentChats } from '@/components/left-sidebar/CollapsedRecentChats'

beforeEach(() => {
  threadsState.threads = {}
})

describe('CollapsedRecentChats', () => {
  it('renders nothing when there are no threads', () => {
    const { container } = render(<CollapsedRecentChats />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists threads most-recent-first and excludes the temporary chat', () => {
    threadsState.threads = {
      a: { id: 'a', title: 'Older', updated: 1 } as Thread,
      b: { id: 'b', title: 'Newer', updated: 3 } as Thread,
      temp: { id: 'temp', title: 'Scratch', updated: 99 } as Thread,
    }
    render(<CollapsedRecentChats />)

    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('data-thread'))).toEqual(['b', 'a'])
    expect(screen.queryByText('Scratch')).toBeNull()
  })

  it('caps the list at 10 recent threads', () => {
    const threads: Record<string, Thread> = {}
    for (let i = 0; i < 15; i++) {
      threads[`t${i}`] = { id: `t${i}`, title: `T${i}`, updated: i } as Thread
    }
    threadsState.threads = threads
    render(<CollapsedRecentChats />)
    expect(screen.getAllByRole('link')).toHaveLength(10)
  })
})
