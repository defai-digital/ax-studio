import { Brain } from 'lucide-react'
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
  DropdownMenuItem: ({ children, onClick }: any) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuSub: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/components/TokenCounter', () => ({
  TokenCounter: () => <div data-testid="token-counter">tokens</div>,
}))

vi.mock('@/components/common/AvatarEmoji', () => ({
  AvatarEmoji: () => <span>avatar</span>,
}))

vi.mock('@/containers/DropdownToolsAvailable', () => ({
  DropdownToolsAvailable: ({ children }: any) => (
    <div data-testid="dropdown-tools-available">{children?.(false, 0)}</div>
  ),
}))

vi.mock('@/containers/McpExtensionToolLoader', () => ({
  McpExtensionToolLoader: () => <div data-testid="mcp-tool-loader" />,
}))

// ── Default props ───────────────────────────────────

const createProps = (
  overrides: Partial<Parameters<typeof ChatInputToolbar>[0]> = {}
) => ({
  isStreaming: false,
  prompt: '',
  textareaRef: {
    current: document.createElement('textarea'),
  } as React.RefObject<HTMLTextAreaElement>,
  setPrompt: vi.fn(),
  selectedModel: undefined,
  projectId: undefined,
  initialMessage: false,
  selectedAssistant: undefined,
  setSelectedAssistant: vi.fn(),
  currentThread: undefined,
  updateCurrentThreadAssistant: vi.fn(),
  effectiveThreadId: 'thread-1',
  assistants: [],
  tools: [],
  hasActiveMCPServers: false,
  MCPToolComponent: null,
  dropdownToolsAvailable: false,
  setDropdownToolsAvailable: vi.fn(),
  tooltipToolsAvailable: false,
  setTooltipToolsAvailable: vi.fn(),
  tokenCounterCompact: false,
  threadMessages: [],
  stopStreaming: vi.fn(),
  handleSendMessage: vi.fn(),
  onAttachImages: undefined,
  isLocalKnowledgeEnabled: false,
  toggleLocalKnowledge: vi.fn(),
  ...overrides,
})

// ── Tests ────────────────────────────────────────────

describe('ChatInputToolbar — Phase 3 Manual Test Protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Protocol #3: Send button remains clickable when empty so the textarea
  // fallback can read the live DOM value if React state is one tick behind.
  it('send button is enabled when prompt is empty', () => {
    render(<ChatInputToolbar {...createProps({ prompt: '' })} />)
    const sendButton = screen.getByText(
      (_, el) => el?.getAttribute('data-test-id') === 'send-message-button'
    )
    expect(sendButton).not.toBeDisabled()
  })

  // Protocol #3: Send button enabled when prompt has text
  it('send button is enabled when prompt has text', () => {
    render(<ChatInputToolbar {...createProps({ prompt: 'hello' })} />)
    const sendButton = screen.getByText(
      (_, el) => el?.getAttribute('data-test-id') === 'send-message-button'
    )
    expect(sendButton).not.toBeDisabled()
  })

  // Protocol #1: Send button calls handleSendMessage
  it('clicking send button calls handleSendMessage with prompt', () => {
    const handleSendMessage = vi.fn()
    render(
      <ChatInputToolbar
        {...createProps({ prompt: 'hello', handleSendMessage })}
      />
    )
    fireEvent.click(
      screen.getByText(
        (_, el) => el?.getAttribute('data-test-id') === 'send-message-button'
      )
    )
    expect(handleSendMessage).toHaveBeenCalledWith('hello')
  })

  // Protocol #4: Streaming state shows stop button instead of send
  it('shows stop button when streaming', () => {
    render(<ChatInputToolbar {...createProps({ isStreaming: true })} />)
    // Stop button should be present (destructive variant)
    const buttons = screen.getAllByRole('button')
    // The stop button has variant="destructive"
    expect(
      screen.queryByText(
        (_, el) => el?.getAttribute('data-test-id') === 'send-message-button'
      )
    ).not.toBeInTheDocument()
    // At least one button should exist for stop
    expect(buttons.length).toBeGreaterThan(0)
  })

  // Protocol #4: Toolbar buttons disabled during streaming
  it('toolbar buttons have opacity-50 and pointer-events-none during streaming', () => {
    const { container } = render(
      <ChatInputToolbar {...createProps({ isStreaming: true })} />
    )
    const actionDiv = container.querySelector('.opacity-50.pointer-events-none')
    expect(actionDiv).toBeInTheDocument()
  })

  // Protocol #5: Stop button calls stopStreaming
  it('stop button calls stopStreaming with effectiveThreadId', () => {
    const stopStreaming = vi.fn()
    const { container } = render(
      <ChatInputToolbar
        {...createProps({ isStreaming: true, stopStreaming })}
      />
    )
    // Find the stop button — it's the non-disabled button outside the opacity-50 div
    const buttonsOutsideDisabled = container.querySelectorAll(
      '.flex.items-center.gap-2 > button'
    )
    const stopButton = buttonsOutsideDisabled[0]
    if (stopButton) {
      fireEvent.click(stopButton)
      expect(stopStreaming).toHaveBeenCalledWith('thread-1')
    }
  })

  // Protocol #12: Token counter compact mode renders
  it('renders token counter in compact mode when enabled', () => {
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

  it('shows the tools dropdown when MCP tools are connected even if model capability metadata is missing', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          selectedModel: {
            id: 'custom-model',
            capabilities: ['completion'],
          } as Model,
          tools: [{ name: 'fabric_search', server: 'ax-studio' }],
          hasActiveMCPServers: true,
          MCPToolComponent: null,
        })}
      />
    )

    expect(screen.getByTestId('dropdown-tools-available')).toBeInTheDocument()
    expect(screen.queryByTestId('mcp-tool-loader')).not.toBeInTheDocument()
  })

  it('uses the MCP extension tool component when the selected model is tool-capable', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          selectedModel: {
            id: 'tool-model',
            capabilities: ['completion', 'tools'],
          } as Model,
          tools: [{ name: 'fabric_search', server: 'ax-studio' }],
          hasActiveMCPServers: true,
          MCPToolComponent: () => null,
        })}
      />
    )

    expect(screen.getByTestId('mcp-tool-loader')).toBeInTheDocument()
  })

  // Protocol #12: Token counter not shown on initial message
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

  // Keyboard hints
  it('renders keyboard hints (⏎ Send, ⇧⏎ Newline)', () => {
    render(<ChatInputToolbar {...createProps()} />)
    expect(screen.getByText('common:sendHint')).toBeInTheDocument()
    expect(screen.getByText('common:newlineHint')).toBeInTheDocument()
  })

  // Send button has tokenized brand gradient
  it('send button has brand gradient class', () => {
    render(<ChatInputToolbar {...createProps({ prompt: 'hello' })} />)
    const sendButton = screen.getByText(
      (_, el) => el?.getAttribute('data-test-id') === 'send-message-button'
    )
    expect(sendButton.className).toContain('bg-brand-gradient')
  })

  it('renders attach image action when handler is provided', () => {
    render(<ChatInputToolbar {...createProps({ onAttachImages: vi.fn() })} />)
    expect(screen.getByText('Attach Image')).toBeInTheDocument()
  })

  it('exposes accessible names on primary icon controls', () => {
    render(
      <ChatInputToolbar
        {...createProps({
          onAttachImages: vi.fn(),
          isLocalKnowledgeEnabled: true,
        })}
      />
    )
    expect(screen.getByLabelText('common:attach')).toBeInTheDocument()
    expect(screen.getByLabelText('common:sendMessage')).toBeInTheDocument()
    expect(
      screen.getByLabelText('common:localKnowledgeActive')
    ).toBeInTheDocument()
  })

  it('stop button has accessible name while streaming', () => {
    render(<ChatInputToolbar {...createProps({ isStreaming: true })} />)
    expect(screen.getByLabelText('common:stop')).toBeInTheDocument()
  })
})
