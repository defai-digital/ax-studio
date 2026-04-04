import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Mock use-stick-to-bottom
vi.mock('use-stick-to-bottom', () => {
  const StickToBottom = ({
    children,
    className,
    role,
    ...props
  }: {
    children: React.ReactNode
    className?: string
    role?: string
  }) => (
    <div data-testid="stick-to-bottom" className={className} role={role} {...props}>
      {children}
    </div>
  )

  StickToBottom.Content = ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => (
    <div data-testid="stick-content" className={className}>
      {children}
    </div>
  )

  return {
    StickToBottom,
    useStickToBottomContext: vi.fn().mockReturnValue({
      isAtBottom: true,
      scrollToBottom: vi.fn(),
    }),
  }
})

// Mock motion/react
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  motion: {
    div: ({
      children,
      ...props
    }: {
      children: React.ReactNode
      [key: string]: unknown
    }) => <div {...props}>{children}</div>,
  },
}))

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './conversation'
import { useStickToBottomContext } from 'use-stick-to-bottom'

describe('Conversation', () => {
  it('renders with role="log"', () => {
    render(
      <Conversation>
        <div>Messages</div>
      </Conversation>
    )
    expect(screen.getByRole('log')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(
      <Conversation>
        <div data-testid="msg">Hello</div>
      </Conversation>
    )
    expect(screen.getByTestId('msg')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(
      <Conversation className="my-convo">
        <div>child</div>
      </Conversation>
    )
    const el = screen.getByTestId('stick-to-bottom')
    expect(el.className).toContain('my-convo')
  })
})

describe('ConversationContent', () => {
  it('renders children', () => {
    render(
      <ConversationContent>
        <div data-testid="content-child">Content</div>
      </ConversationContent>
    )
    expect(screen.getByTestId('content-child')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(
      <ConversationContent className="custom-content">
        <div>child</div>
      </ConversationContent>
    )
    const el = screen.getByTestId('stick-content')
    expect(el.className).toContain('custom-content')
  })
})

describe('ConversationEmptyState', () => {
  it('renders default title and description', () => {
    render(<ConversationEmptyState />)
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
    expect(
      screen.getByText('Start a conversation to see messages here')
    ).toBeInTheDocument()
  })

  it('renders custom title and description', () => {
    render(
      <ConversationEmptyState
        title="Welcome"
        description="Type to begin"
      />
    )
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Type to begin')).toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    render(
      <ConversationEmptyState icon={<span data-testid="icon">I</span>} />
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders children instead of default content', () => {
    render(
      <ConversationEmptyState>
        <span data-testid="custom">Custom empty</span>
      </ConversationEmptyState>
    )
    expect(screen.getByTestId('custom')).toBeInTheDocument()
    expect(screen.queryByText('No messages yet')).toBeNull()
  })

  it('does not render description when set to empty string', () => {
    render(<ConversationEmptyState description="" />)
    // Only title should appear
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  })
})

describe('ConversationScrollButton', () => {
  it('does not render button when at bottom', () => {
    vi.mocked(useStickToBottomContext).mockReturnValue({
      isAtBottom: true,
      scrollToBottom: vi.fn(),
    } as never)
    render(<ConversationScrollButton />)
    expect(screen.queryByText('Scroll to bottom')).toBeNull()
  })

  it('renders button when not at bottom', () => {
    vi.mocked(useStickToBottomContext).mockReturnValue({
      isAtBottom: false,
      scrollToBottom: vi.fn(),
    } as never)
    render(<ConversationScrollButton />)
    expect(screen.getByText('Scroll to bottom')).toBeInTheDocument()
  })

  it('calls scrollToBottom on click', async () => {
    const scrollToBottom = vi.fn()
    vi.mocked(useStickToBottomContext).mockReturnValue({
      isAtBottom: false,
      scrollToBottom,
    } as never)
    render(<ConversationScrollButton />)
    screen.getByText('Scroll to bottom').closest('button')?.click()
    expect(scrollToBottom).toHaveBeenCalledOnce()
  })
})
