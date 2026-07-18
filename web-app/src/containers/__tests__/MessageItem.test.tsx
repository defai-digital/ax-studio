import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UIMessage } from 'ai'

// Mock dependencies
vi.mock('../RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => (
    <div data-testid="render-markdown">{content}</div>
  ),
}))

vi.mock('@/components/common/CopyButton', () => ({
  CopyButton: ({ text }: { text: string }) => (
    <button data-testid="copy-button" data-text={text}>
      Copy
    </button>
  ),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: vi.fn((selector) =>
    selector({ selectedModel: { id: 'test-model', name: 'Test Model' } })
  ),
}))

// Fork depends on the router + thread/message stores; isolate MessageItem from it.
vi.mock('@/hooks/threads/use-fork-thread', () => ({
  useForkThread: () => vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/containers/dialogs/message/EditMessageDialog', () => ({
  EditMessageDialog: () => <button data-testid="edit-dialog">Edit</button>,
}))

vi.mock('@/containers/dialogs/message/DeleteMessageDialog', () => ({
  DeleteMessageDialog: ({ onDelete }: { onDelete: () => void }) => (
    <button data-testid="delete-dialog" onClick={onDelete}>
      Delete
    </button>
  ),
}))

vi.mock('@/containers/TokenSpeedIndicator', () => ({
  TokenSpeedIndicator: () => <div data-testid="token-speed" />,
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
  ToolOutput: ({
    output,
    errorText,
  }: {
    output: unknown
    errorText?: string
  }) => (
    <div data-testid="tool-output">{errorText || JSON.stringify(output)}</div>
  ),
}))

vi.mock('@/components/AgentOutputCard', () => ({
  AgentOutputCard: () => <div data-testid="agent-output-card" />,
}))

vi.mock('@/components/RunLogViewer', () => ({
  RunLogSummary: () => <div data-testid="run-log-summary" />,
}))

import { useCitations } from '@/hooks/citations/use-citations'
import { useArtifactPanel } from '@/stores/artifact-panel-store'
import { MessageItem } from '../MessageItem'

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
    useCitations.setState({ citationsByMessage: {} })
  })

  describe('user messages', () => {
    it('renders user text in a styled bubble', () => {
      const msg = makeMessage({
        role: 'user',
        parts: [{ type: 'text', text: 'Hi there' }],
      })
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
      expect(screen.getByText('Hi there')).toBeInTheDocument()
    })

    it('does not render empty text parts', () => {
      const msg = makeMessage({
        role: 'user',
        parts: [{ type: 'text', text: '' }],
      })
      const { container } = render(
        <MessageItem message={msg} isLastMessage={false} status="ready" />
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
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
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
          isLastMessage={false}
          status="ready"
          onDelete={onDelete}
        />
      )
      fireEvent.click(screen.getByTestId('delete-dialog'))
      expect(onDelete).toHaveBeenCalledWith('del-msg')
    })

    it('shows local knowledge source status when a user message used retrieval', () => {
      const msg = makeMessage({
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'What real-world hiring outcome did the author achieve?',
          },
        ],
        metadata: {
          localKnowledgeRetrieval: {
            searched: true,
            extracted: true,
            source:
              '/Users/devop/Documents/akidb-testing/coding-interview-university.md',
          },
        },
      } as never)

      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)

      expect(
        screen.getByText(/Searched local knowledge and extracted source/i)
      ).toBeInTheDocument()
      expect(
        screen.getByText('coding-interview-university.md')
      ).toBeInTheDocument()
    })
  })

  describe('assistant messages', () => {
    it('renders text parts through RenderMarkdown', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'Response text' }],
      })
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
      const md = screen.getByTestId('render-markdown')
      expect(md.textContent).toBe('Response text')
    })

    it('hydrates updated citation metadata for the same assistant message', async () => {
      const initialCitationData = {
        sources: [
          {
            id: 'src-1',
            type: 'web' as const,
            url: 'https://example.com',
            title: 'Example',
            snippet: 'Initial source',
            retrievedAt: 1,
          },
        ],
        confidence: 'moderate' as const,
      }
      const updatedCitationData = {
        sources: [
          ...initialCitationData.sources,
          {
            id: 'src-2',
            type: 'document' as const,
            title: 'Internal notes',
            snippet: 'Updated source',
            documentName: 'notes.md',
            retrievedAt: 2,
          },
        ],
        confidence: 'strong' as const,
      }
      const initialMessage = makeMessage({
        id: 'citation-msg',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Response text [1]' }],
        metadata: { citationData: initialCitationData },
      } as never)

      const { rerender } = render(
        <MessageItem
          message={initialMessage}
          isLastMessage={false}
          status="ready"
        />
      )

      await waitFor(() => {
        expect(useCitations.getState().getCitations('citation-msg')).toEqual(
          initialCitationData
        )
      })

      rerender(
        <MessageItem
          message={{
            ...initialMessage,
            metadata: { citationData: updatedCitationData },
          }}
          isLastMessage={false}
          status="ready"
        />
      )

      await waitFor(() => {
        expect(useCitations.getState().getCitations('citation-msg')).toEqual(
          updatedCitationData
        )
      })
    })

    it('renders reasoning parts', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'Thinking...' } as never],
      })
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
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
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
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
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
      expect(screen.getByTestId('tool-header').textContent).toBe('web_search')
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
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
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
          isLastMessage={true}
          status="ready"
          onRegenerate={onRegenerate}
        />
      )
      const regenButton = screen.getByLabelText('common:regenerate')
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
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
      const outputs = screen.getAllByTestId('tool-output')
      // Should render error output
      expect(
        outputs.some((el) => el.textContent?.includes('Connection timeout'))
      ).toBe(true)
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
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
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
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
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
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
      fireEvent.click(screen.getByAltText('Uploaded attachment'))
      // Preview dialog should appear
      const previewImg = screen.getByAltText('common:preview')
      expect(previewImg.getAttribute('src')).toBe(
        'https://example.com/photo.jpg'
      )
    })
  })

  describe('agent status parts', () => {
    it('ignores legacy data-agentStatus parts that are no longer rendered by MessageItem', () => {
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
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
      expect(screen.queryByTestId('agent-output-card')).toBeNull()
    })
  })

  describe('artifacts panel button', () => {
    const longCode = `\`\`\`python\n${Array.from(
      { length: 15 },
      (_, i) => `line ${i + 1}`
    ).join('\n')}\n\`\`\``

    beforeEach(() => {
      useArtifactPanel.setState({ panels: {} })
    })

    it('shows "Open in panel" for assistant messages with artifacts', () => {
      const msg = makeMessage({
        id: 'art-msg',
        role: 'assistant',
        parts: [{ type: 'text', text: longCode }],
      })
      render(
        <MessageItem
          message={msg}
          isLastMessage={false}
          status="ready"
          threadId="thread-1"
        />
      )
      expect(
        screen.getByLabelText('common:artifacts.openInPanel')
      ).toBeInTheDocument()
    })

    it('opens the panel with the first artifact on click', () => {
      const msg = makeMessage({
        id: 'art-msg',
        role: 'assistant',
        parts: [{ type: 'text', text: longCode }],
      })
      render(
        <MessageItem
          message={msg}
          isLastMessage={false}
          status="ready"
          threadId="thread-1"
        />
      )
      fireEvent.click(screen.getByLabelText('common:artifacts.openInPanel'))
      expect(useArtifactPanel.getState().panels['thread-1']).toEqual({
        open: true,
        activeArtifactId: 'art-msg:0',
      })
    })

    it('hides the button for assistant messages without artifacts', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'short reply' }],
      })
      render(
        <MessageItem
          message={msg}
          isLastMessage={false}
          status="ready"
          threadId="thread-1"
        />
      )
      expect(screen.queryByLabelText('common:artifacts.openInPanel')).toBeNull()
    })

    it('hides the button for user messages even with artifact-like content', () => {
      const msg = makeMessage({
        role: 'user',
        parts: [{ type: 'text', text: longCode }],
      })
      render(
        <MessageItem
          message={msg}
          isLastMessage={false}
          status="ready"
          threadId="thread-1"
        />
      )
      expect(screen.queryByLabelText('common:artifacts.openInPanel')).toBeNull()
    })

    it('hides the button while streaming', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: longCode }],
      })
      render(
        <MessageItem
          message={msg}
          isLastMessage={true}
          status="streaming"
          threadId="thread-1"
        />
      )
      expect(screen.queryByLabelText('common:artifacts.openInPanel')).toBeNull()
    })

    it('hides the button when no threadId is available', () => {
      const msg = makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: longCode }],
      })
      render(<MessageItem message={msg} isLastMessage={false} status="ready" />)
      expect(screen.queryByLabelText('common:artifacts.openInPanel')).toBeNull()
    })
  })
})
