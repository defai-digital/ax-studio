import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatInputToolbar } from '../ChatInputToolbar'

// ── Mocks ────────────────────────────────────────────

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className, ...props }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={className}
      {...props}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled }: any) => (
    <div role="menuitem" aria-disabled={disabled} onClick={onClick}>
      {children}
    </div>
  ),
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/components/TokenCounter', () => ({
  TokenCounter: () => <div data-testid="token-counter">tokens</div>,
}))

// ── Default props ───────────────────────────────────

const createProps = (
  overrides: Partial<Parameters<typeof ChatInputToolbar>[0]> = {}
) => ({
  isStreaming: false,
  prompt: '',
  selectedModel: undefined,
  projectId: undefined,
  initialMessage: false,
  effectiveThreadId: 'thread-1',
  tokenCounterCompact: false,
  threadMessages: [],
  stopStreaming: vi.fn(),
  handleSendMessage: vi.fn(),
  ...overrides,
})

const getSendButton = () =>
  screen.getByText(
    (_, el) => el?.getAttribute('data-test-id') === 'send-message-button'
  )

// ── Tests ────────────────────────────────────────────

describe('ChatInputToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('send button is enabled when prompt is empty', () => {
    render(<ChatInputToolbar {...createProps({ prompt: '' })} />)
    expect(getSendButton()).not.toBeDisabled()
  })

  it('send button is enabled when prompt has text', () => {
    render(<ChatInputToolbar {...createProps({ prompt: 'hello' })} />)
    expect(getSendButton()).not.toBeDisabled()
  })

  it('clicking send button calls handleSendMessage with prompt', () => {
    const handleSendMessage = vi.fn()
    render(
      <ChatInputToolbar
        {...createProps({ prompt: 'hello', handleSendMessage })}
      />
    )
    fireEvent.click(getSendButton())
    expect(handleSendMessage).toHaveBeenCalledWith('hello')
  })

  it('prefers submitCurrentPrompt over handleSendMessage when provided', () => {
    const submitCurrentPrompt = vi.fn()
    const handleSendMessage = vi.fn()
    render(
      <ChatInputToolbar
        {...createProps({
          prompt: 'hello',
          submitCurrentPrompt,
          handleSendMessage,
        })}
      />
    )
    fireEvent.click(getSendButton())
    expect(submitCurrentPrompt).toHaveBeenCalledTimes(1)
    expect(handleSendMessage).not.toHaveBeenCalled()
  })

  it('shows stop button instead of send while streaming', () => {
    render(<ChatInputToolbar {...createProps({ isStreaming: true })} />)
    expect(
      screen.queryByText(
        (_, el) => el?.getAttribute('data-test-id') === 'send-message-button'
      )
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('common:stop')).toBeInTheDocument()
  })

  it('toolbar buttons have opacity-50 and pointer-events-none during streaming', () => {
    const { container } = render(
      <ChatInputToolbar {...createProps({ isStreaming: true })} />
    )
    const actionDiv = container.querySelector('.opacity-50.pointer-events-none')
    expect(actionDiv).toBeInTheDocument()
  })

  it('stop button calls stopStreaming with effectiveThreadId', () => {
    const stopStreaming = vi.fn()
    render(
      <ChatInputToolbar
        {...createProps({ isStreaming: true, stopStreaming })}
      />
    )
    fireEvent.click(screen.getByLabelText('common:stop'))
    expect(stopStreaming).toHaveBeenCalledWith('thread-1')
  })

  it('renders token counter in compact mode when there is content', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          tokenCounterCompact: true,
          prompt: 'hello',
        })}
      />
    )
    expect(screen.getByTestId('token-counter')).toBeInTheDocument()
  })

  it('does not render token counter on initial message', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          tokenCounterCompact: true,
          initialMessage: true,
          prompt: 'hello',
        })}
      />
    )
    expect(screen.queryByTestId('token-counter')).not.toBeInTheDocument()
  })

  it('renders keyboard hints', () => {
    render(<ChatInputToolbar {...createProps()} />)
    expect(screen.getByText('common:sendHint')).toBeInTheDocument()
    expect(screen.getByText('common:newlineHint')).toBeInTheDocument()
  })

  it('send button has brand gradient class', () => {
    render(<ChatInputToolbar {...createProps({ prompt: 'hello' })} />)
    expect(getSendButton().className).toContain('bg-brand-gradient')
  })

  it('exposes accessible names on primary icon controls', () => {
    render(<ChatInputToolbar {...createProps()} />)
    expect(screen.getByLabelText('common:attach')).toBeInTheDocument()
    expect(screen.getByLabelText('common:sendMessage')).toBeInTheDocument()
  })

  // ── Attachments ──

  it('renders attach document and attach image actions when handlers are provided', () => {
    render(
      <ChatInputToolbar
        {...createProps({ onAttachDocuments: vi.fn(), onAttachImages: vi.fn() })}
      />
    )
    expect(screen.getByText('Attach Document')).toBeInTheDocument()
    expect(screen.getByText('Attach Image')).toBeInTheDocument()
  })

  it('clicking attach actions calls the handlers', () => {
    const onAttachDocuments = vi.fn()
    const onAttachImages = vi.fn()
    render(
      <ChatInputToolbar
        {...createProps({ onAttachDocuments, onAttachImages })}
      />
    )
    fireEvent.click(screen.getByText('Attach Document'))
    fireEvent.click(screen.getByText('Attach Image'))
    expect(onAttachDocuments).toHaveBeenCalledTimes(1)
    expect(onAttachImages).toHaveBeenCalledTimes(1)
  })

  it('omits attach actions when handlers are not provided', () => {
    render(<ChatInputToolbar {...createProps()} />)
    expect(screen.queryByText('Attach Document')).not.toBeInTheDocument()
    expect(screen.queryByText('Attach Image')).not.toBeInTheDocument()
  })

  it('shows indexing state and disables send while documents are ingesting', () => {
    render(
      <ChatInputToolbar
        {...createProps({ onAttachDocuments: vi.fn(), ingestingDocs: true })}
      />
    )
    expect(screen.getByText('Indexing documents...')).toBeInTheDocument()
    expect(getSendButton()).toBeDisabled()
  })

  // ── Model capability indicators ──

  it('shows an embeddings indicator when the model supports embeddings', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          selectedModel: {
            id: 'm1',
            capabilities: ['embeddings'],
          } as Model,
        })}
      />
    )
    expect(screen.getByText('embeddings')).toBeInTheDocument()
  })

  it('shows a reasoning indicator when the model supports reasoning', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          selectedModel: {
            id: 'm1',
            capabilities: ['reasoning'],
          } as Model,
        })}
      />
    )
    expect(screen.getByText('reasoning')).toBeInTheDocument()
  })

  it('shows no capability indicators for a plain model', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          selectedModel: {
            id: 'm1',
            capabilities: ['completion'],
          } as Model,
        })}
      />
    )
    expect(screen.queryByText('embeddings')).not.toBeInTheDocument()
    expect(screen.queryByText('reasoning')).not.toBeInTheDocument()
  })

  // ── Model selector slot ──

  it('renders the model selector slot when provided', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          modelSelector: <div data-testid="model-selector">model</div>,
        })}
      />
    )
    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
  })

  // ── Temporary chat toggle ──

  it('renders the temporary chat toggle on the new-chat composer with aria-pressed', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          initialMessage: true,
          temporaryChatEnabled: true,
          onToggleTemporaryChat: vi.fn(),
        })}
      />
    )
    const toggle = screen.getByTestId('temporary-chat-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAttribute('aria-label', 'Temporary chat')
  })

  it('reflects the off state via aria-pressed=false', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          initialMessage: true,
          temporaryChatEnabled: false,
          onToggleTemporaryChat: vi.fn(),
        })}
      />
    )
    expect(screen.getByTestId('temporary-chat-toggle')).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('clicking the temporary chat toggle calls onToggleTemporaryChat', () => {
    const onToggleTemporaryChat = vi.fn()
    render(
      <ChatInputToolbar
        {...createProps({ initialMessage: true, onToggleTemporaryChat })}
      />
    )
    fireEvent.click(screen.getByTestId('temporary-chat-toggle'))
    expect(onToggleTemporaryChat).toHaveBeenCalledTimes(1)
  })

  it('hides the temporary chat toggle inside an existing thread', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          initialMessage: false,
          onToggleTemporaryChat: vi.fn(),
        })}
      />
    )
    expect(
      screen.queryByTestId('temporary-chat-toggle')
    ).not.toBeInTheDocument()
  })

  it('hides the temporary chat toggle in a project composer', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          initialMessage: true,
          projectId: 'proj-1',
          onToggleTemporaryChat: vi.fn(),
        })}
      />
    )
    expect(
      screen.queryByTestId('temporary-chat-toggle')
    ).not.toBeInTheDocument()
  })
})
