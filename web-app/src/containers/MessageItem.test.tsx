import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UIMessage } from 'ai'

// Mock dependencies
vi.mock('./RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => (
    <div data-testid="render-markdown">{content}</div>
  ),
}))

vi.mock('./CopyButton', () => ({
  CopyButton: ({ text }: { text: string }) => (
    <button data-testid="copy-button" data-text={text}>
      Copy
    </button>
  ),
}))

vi.mock('@/features/models/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn((selector) =>
    selector({ selectedModel: { id: 'test-model', name: 'Test Model' } })
  ),
}))

vi.mock('@/containers/dialogs/EditMessageDialog', () => ({
  EditMessageDialog: () => <button data-testid="edit-dialog">Edit</button>,
}))

vi.mock('@/containers/dialogs/DeleteMessageDialog', () => ({
  DeleteMessageDialog: ({ onDelete }: { onDelete: () => void }) => (
    <button data-testid="delete-dialog" onClick={onDelete}>
      Delete
    </button>
  ),
}))

vi.mock('@/containers/TokenSpeedIndicator', () => ({
  default: () => <div data-testid="token-speed" />,
}))

vi.mock('@/lib/fileMetadata', () => ({
  extractFilesFromPrompt: vi.fn((text: string) => ({
    cleanPrompt: text,
    files: [],
  })),
  FileMetadata: {},
}))

vi.mock('@/components/ai-elements/reasoning', () => ({
  Reasoning: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="reasoning">{children}</div>
  ),
  ReasoningTrigger: () => <div data-testid="reasoning-trigger" />,
  ReasoningContent: ({ children }: { children: string }) => (
    <div data-testid="reasoning-content">{children}</div>
  ),
}))

vi.mock('@/components/ai-elements/tool', () => ({
  Tool: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tool">{children}</div>
  ),
  ToolHeader: ({ title }: { title: string }) => (
    <div data-testid="tool-header">{title}</div>
  ),
  ToolContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tool-content">{children}</div>
  ),
  ToolInput: ({ input }: { input: unknown }) => (
    <div data-testid="tool-input">{JSON.stringify(input)}</div>
  ),
  ToolOutput: ({ output, errorText }: { output: unknown; errorText?: string }) => (
    <div data-testid="tool-output">
      {errorText || JSON.stringify(output)}
    </div>
  ),
}))

vi.mock('@/features/multi-agent/components/AgentOutputCard', () => ({
  AgentOutputCard: () => <div data-testid="agent-output-card" />,
}))

vi.mock('@/features/multi-agent/components/RunLogViewer', () => ({
  RunLogSummary: () => <div data-testid="run-log-summary" />,
}))

import { MessageItem } from './MessageItem'

function makeMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Hello world' }],
    ...overrides,
  } as UIMessage
}

describe('MessageItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('user messages', () => {
    it('renders user text in a styled bubble', () => {
      const msg = makeMessage({
        role: 'user',
        parts: [{ type: 'text', text: 'Hi there' }],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={true}
          isLastMessage={false}
          status="ready"
        />
      )
      expect(screen.getByText('Hi there')).toBeInTheDocument()
    })

    it('does not render empty text parts', () => {
      const msg = makeMessage({
        role: 'user',
        parts: [{ type: 'text', text: '' }],
      })
      const { container } = render(
        <MessageItem
          message={msg}
          isFirstMessage={true}
          isLastMessage={false}
          status="ready"
        />
      )
      // The message wrapper exists but no text content div
      expect(container.querySelector('.rounded-2xl')).toBeNull()
    })

    it('renders image file part for user messages', () => {
      const msg = makeMessage({
        role: 'user',
        parts: [
          {
            type: 'file',
            url: 'https://example.com/image.png',
            mediaType: 'image/png',
          } as never,
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={true}
          isLastMessage={false}
          status="ready"
        />
      )
      const img = screen.getByAltText('Uploaded attachment')
      expect(img.getAttribute('src')).toBe('https://example.com/image.png')
    })

    it('shows edit button when onEdit is provided and not streaming', () => {
      const msg = makeMessage({
        role: 'user',
        parts: [{ type: 'text', text: 'edit me' }],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={true}
          isLastMessage={false}
          status="ready"
          onEdit={vi.fn()}
        />
      )
      expect(screen.getByTestId('edit-dialog')).toBeInTheDocument()
    })

    it('hides edit button while streaming', () => {
      const msg = makeMessage({
        role: 'user',
        parts: [{ type: 'text', text: 'edit me' }],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={true}
          isLastMessage={true}
          status="streaming"
          onEdit={vi.fn()}
        />
      )
      expect(screen.queryByTestId('edit-dialog')).toBeNull()
    })

    it('calls onDelete when delete is triggered', () => {
      const onDelete = vi.fn()
      const msg = makeMessage({
        id: 'del-msg',
        role: 'user',
        parts: [{ type: 'text', text: 'delete me' }],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={true}
          isLastMessage={false}
          status="ready"
          onDelete={onDelete}
        />
      )
      fireEvent.click(screen.getByTestId('delete-dialog'))
      expect(onDelete).toHaveBeenCalledWith('del-msg')
    })
  })

  describe('assistant messages', () => {
    it('renders text parts through RenderMarkdown', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'Response text' }],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      const md = screen.getByTestId('render-markdown')
      expect(md.textContent).toBe('Response text')
    })

    it('renders reasoning parts', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'Thinking...' } as never],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      expect(screen.getByTestId('reasoning')).toBeInTheDocument()
      expect(screen.getByTestId('reasoning-content').textContent).toBe(
        'Thinking...'
      )
    })

    it('renders tool parts with static tool type', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-search',
            state: 'output-available',
            input: { query: 'test' },
            output: { results: [] },
          } as never,
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      expect(screen.getByTestId('tool')).toBeInTheDocument()
      expect(screen.getByTestId('tool-header').textContent).toBe('search')
    })

    it('renders dynamic-tool parts', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'web_search',
            state: 'output-available',
            input: { q: 'test' },
            output: 'results',
          } as never,
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      expect(screen.getByTestId('tool-header').textContent).toBe('web_search')
    })

    it('renders generate_diagram tool as inline mermaid', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-generate_diagram',
            state: 'output-available',
            output: {
              source: 'graph TD; A-->B',
              title: 'My Diagram',
            },
          } as never,
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      // Should render through RenderMarkdown with mermaid fence
      const md = screen.getByTestId('render-markdown')
      expect(md.textContent).toContain('graph TD; A-->B')
      // Title should be rendered
      expect(screen.getByText('My Diagram')).toBeInTheDocument()
    })

    it('strips mermaid fence markers from generate_diagram source', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-generate_diagram',
            state: 'output-available',
            output: {
              source: '```mermaid\ngraph LR; A-->B\n```',
              title: '',
            },
          } as never,
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      const md = screen.getByTestId('render-markdown')
      // Should not have double fencing
      expect(md.textContent).toContain('graph LR; A-->B')
    })

    it('renders nothing for generate_diagram with no source yet', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-generate_diagram',
            state: 'input-streaming',
            output: undefined,
          } as never,
        ],
      })
      const { container } = render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      expect(screen.queryByTestId('render-markdown')).toBeNull()
    })

    it('renders assistant image file parts', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'file',
            url: 'https://example.com/gen.png',
            mediaType: 'image/png',
          } as never,
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      expect(screen.getByAltText('Generated image')).toBeInTheDocument()
    })

    it('shows regenerate button for last message when not streaming', () => {
      const onRegenerate = vi.fn()
      const msg = makeMessage({
        id: 'regen-msg',
        role: 'assistant',
        parts: [{ type: 'text', text: 'response' }],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={true}
          status="ready"
          onRegenerate={onRegenerate}
        />
      )
      const regenButton = screen.getByLabelText('Regenerate response')
      expect(regenButton).toBeInTheDocument()
      fireEvent.click(regenButton)
      expect(onRegenerate).toHaveBeenCalledWith('regen-msg')
    })

    it('hides regenerate button while streaming', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'response' }],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={true}
          status="streaming"
          onRegenerate={vi.fn()}
        />
      )
      expect(screen.queryByLabelText('Regenerate response')).toBeNull()
    })

    it('hides regenerate button for non-last messages', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'response' }],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
          onRegenerate={vi.fn()}
        />
      )
      expect(screen.queryByLabelText('Regenerate response')).toBeNull()
    })

    it('renders tool error output', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-failing_tool',
            state: 'output-error',
            error: 'Connection timeout',
          } as never,
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      const outputs = screen.getAllByTestId('tool-output')
      // Should render error output
      expect(outputs.some((el) => el.textContent?.includes('Connection timeout'))).toBe(true)
    })
  })

  describe('multiple parts', () => {
    it('renders text + reasoning + tool parts together', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Hmm...' } as never,
          { type: 'text', text: 'Answer' },
          {
            type: 'tool-calc',
            state: 'output-available',
            input: { expr: '2+2' },
            output: '4',
          } as never,
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      expect(screen.getByTestId('reasoning')).toBeInTheDocument()
      expect(screen.getByTestId('render-markdown')).toBeInTheDocument()
      expect(screen.getByTestId('tool')).toBeInTheDocument()
    })
  })

  describe('getFullTextContent', () => {
    it('concatenates multiple text parts for copy button', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Part one' },
          { type: 'text', text: 'Part two' },
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      const copyBtn = screen.getByTestId('copy-button')
      expect(copyBtn.getAttribute('data-text')).toBe('Part one\nPart two')
    })
  })

  describe('image preview', () => {
    it('opens image preview on user image click', () => {
      const msg = makeMessage({
        role: 'user',
        parts: [
          {
            type: 'file',
            url: 'https://example.com/photo.jpg',
            mediaType: 'image/jpeg',
          } as never,
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={true}
          isLastMessage={false}
          status="ready"
        />
      )
      fireEvent.click(screen.getByAltText('Uploaded attachment'))
      // Preview overlay should appear
      const previewImg = screen.getByAltText('Preview')
      expect(previewImg.getAttribute('src')).toBe(
        'https://example.com/photo.jpg'
      )
    })
  })

  describe('agent status deduplication', () => {
    it('only renders the latest status per agent_id', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'data-agentStatus',
            data: {
              agent_id: 'a1',
              agent_name: 'Agent1',
              status: 'running',
            },
          } as never,
          {
            type: 'data-agentStatus',
            data: {
              agent_id: 'a1',
              agent_name: 'Agent1',
              status: 'complete',
            },
          } as never,
        ],
      })
      render(
        <MessageItem
          message={msg}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      // Only one agent card should render (the latest)
      const cards = screen.getAllByTestId('agent-output-card')
      expect(cards).toHaveLength(1)
    })
  })
})
