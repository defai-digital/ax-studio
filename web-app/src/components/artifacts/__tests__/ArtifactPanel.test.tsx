import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { UIMessage } from '@ai-sdk/react'
import type { ReactNode } from 'react'

// ── Mocks ───────────────────────────────────────────────────────────────

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    aside: ({
      children,
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      ...props
    }: Record<string, unknown> & { children: ReactNode }) => (
      <aside {...props}>{children}</aside>
    ),
  },
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => (
    <div data-testid="render-markdown">{content}</div>
  ),
}))

const mockCopy = vi.fn()
vi.mock('@/components/common/CopyButton', () => ({
  CopyButton: ({ text }: { text: string }) => (
    <button data-testid="copy-button" onClick={() => mockCopy(text)}>
      Copy
    </button>
  ),
}))

// Render dropdown contents inline so items are directly clickable.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode
    onSelect?: () => void
  }) => (
    <button data-testid="dropdown-item" onClick={onSelect}>
      {children}
    </button>
  ),
}))

import { ArtifactPanel, buildRevisePrompt } from '../ArtifactPanel'
import { useArtifactPanel } from '@/stores/artifact-panel-store'
import { usePrompt } from '@/hooks/ui/usePrompt'

// ── Helpers ─────────────────────────────────────────────────────────────

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')

const codeMessage = (id: string, lang = 'python', n = 15): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [{ type: 'text', text: `\`\`\`${lang}\n${lines(n)}\n\`\`\`` }],
  }) as UIMessage

const htmlMessage = (id: string, body = '<p>hi</p>'): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [{ type: 'text', text: `\`\`\`html\n${body}\n\`\`\`` }],
  }) as UIMessage

const multiArtifactMessage = (id: string): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: [
          `\`\`\`html\n<p>first</p>\n\`\`\``,
          `\`\`\`python\n${lines(20)}\n\`\`\``,
        ].join('\n'),
      },
    ],
  }) as UIMessage

const openPanel = (threadId = 't1', artifactId?: string) => {
  useArtifactPanel.getState().openPanel(threadId, artifactId)
}

describe('ArtifactPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useArtifactPanel.setState({ panels: {} })
    usePrompt.setState({ prompt: '' })
  })

  it('renders nothing when the panel is closed', () => {
    const { container } = render(
      <ArtifactPanel threadId="t1" messages={[codeMessage('m1')]} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders header info and code view for a code artifact', () => {
    openPanel('t1', 'm1:0')
    render(<ArtifactPanel threadId="t1" messages={[codeMessage('m1')]} />)

    expect(screen.getByText('python')).toBeInTheDocument()
    expect(screen.getByText('common:artifacts.lines')).toBeInTheDocument()
    expect(screen.getByTestId('artifact-code-view')).toBeInTheDocument()
    expect(screen.getByTestId('render-markdown').textContent).toContain(
      'line 15'
    )
  })

  it('shows an empty state when the thread has no artifacts', () => {
    openPanel('t1')
    render(<ArtifactPanel threadId="t1" messages={[]} />)
    expect(screen.getByText('common:artifacts.empty')).toBeInTheDocument()
  })

  it('switches artifacts via tabs within one message', () => {
    openPanel('t1', 'm1:0')
    render(
      <ArtifactPanel threadId="t1" messages={[multiArtifactMessage('m1')]} />
    )

    // The active tab is aria-pressed (the Preview toggle is too, since this
    // message's first artifact is previewable html)
    const pressed = screen.getAllByRole('button', { pressed: true })
    expect(pressed.some((b) => b.textContent === 'html 1')).toBe(true)
    expect(screen.getByText('html 1')).toBeInTheDocument()
    expect(screen.getByText('python 2')).toBeInTheDocument()

    fireEvent.click(screen.getByText('python 2'))
    expect(useArtifactPanel.getState().panels['t1'].activeArtifactId).toBe(
      'm1:1'
    )
    expect(screen.getByText('python')).toBeInTheDocument()
  })

  it('lists artifact-bearing messages in the dropdown and jumps to them', () => {
    openPanel('t1', 'm1:0')
    render(
      <ArtifactPanel
        threadId="t1"
        messages={[codeMessage('m1'), htmlMessage('m2')]}
      />
    )

    const items = screen.getAllByTestId('dropdown-item')
    expect(items).toHaveLength(2)

    fireEvent.click(items[1])
    expect(useArtifactPanel.getState().panels['t1'].activeArtifactId).toBe(
      'm2:0'
    )
    // The html artifact renders as a sandboxed preview by default
    expect(
      screen.getByTitle('common:artifacts.previewTitle')
    ).toBeInTheDocument()
  })

  it('closes on Esc and on the close button', () => {
    openPanel('t1', 'm1:0')
    render(<ArtifactPanel threadId="t1" messages={[codeMessage('m1')]} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useArtifactPanel.getState().panels['t1'].open).toBe(false)
  })

  it('closes via the close button', () => {
    openPanel('t1', 'm1:0')
    render(<ArtifactPanel threadId="t1" messages={[codeMessage('m1')]} />)

    fireEvent.click(screen.getByLabelText('common:artifacts.close'))
    expect(useArtifactPanel.getState().panels['t1'].open).toBe(false)
  })

  it('copies the artifact content from the footer', () => {
    openPanel('t1', 'm1:0')
    render(<ArtifactPanel threadId="t1" messages={[codeMessage('m1')]} />)

    fireEvent.click(screen.getByTestId('copy-button'))
    expect(mockCopy).toHaveBeenCalledWith(lines(15))
  })

  it('downloads the artifact as a blob with a kind-based extension', () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(window.URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
    })
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
    })
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    openPanel('t1', 'm1:0')
    render(<ArtifactPanel threadId="t1" messages={[codeMessage('m1')]} />)
    fireEvent.click(screen.getByLabelText('common:artifacts.download'))

    expect(createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    clickSpy.mockRestore()
  })

  it('renders html artifacts in the sandboxed preview with a Code toggle', () => {
    openPanel('t1', 'm1:0')
    render(<ArtifactPanel threadId="t1" messages={[htmlMessage('m1')]} />)

    // Default: preview iframe
    expect(
      screen.getByTitle('common:artifacts.previewTitle')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('artifact-code-view')).toBeNull()

    // Toggle to code view
    fireEvent.click(screen.getByText('common:artifacts.code'))
    expect(screen.getByTestId('artifact-code-view')).toBeInTheDocument()
    expect(screen.getByTestId('render-markdown').textContent).toContain(
      '<p>hi</p>'
    )
  })

  it('revise flow: selection → floating input → prefills composer prompt', () => {
    openPanel('t1', 'm1:0')
    render(<ArtifactPanel threadId="t1" messages={[codeMessage('m1')]} />)

    // Select "line 3" inside the code view
    const codeView = screen.getByTestId('render-markdown')
    const textNode = codeView.firstChild as Text
    const start = textNode.textContent!.indexOf('line 3')
    const selection = window.getSelection()!
    selection.setBaseAndExtent(textNode, start, textNode, start + 6)
    fireEvent(document, new Event('selectionchange'))

    // Floating box appears with instruction input
    const input = screen.getByLabelText('common:artifacts.revisePlaceholder')
    fireEvent.change(input, { target: { value: 'make it async' } })
    fireEvent.click(screen.getByLabelText('common:artifacts.reviseSubmit'))

    const expected = `Regarding this code artifact:\n\n<artifact>\n${lines(
      15
    )}\n</artifact>\n\nFor this part:\n<selection>\nline 3\n</selection>\n\nmake it async`
    expect(usePrompt.getState().prompt).toBe(expected)

    // Box dismissed after submit
    expect(
      screen.queryByLabelText('common:artifacts.revisePlaceholder')
    ).toBeNull()
  })

  it('does not show the revise box for selections outside the code view', () => {
    openPanel('t1', 'm1:0')
    render(
      <div>
        <ArtifactPanel threadId="t1" messages={[codeMessage('m1')]} />
        <p data-testid="outside">outside text</p>
      </div>
    )

    const outside = screen.getByTestId('outside').firstChild as Text
    const selection = window.getSelection()!
    selection.setBaseAndExtent(outside, 0, outside, 7)
    fireEvent(document, new Event('selectionchange'))

    expect(
      screen.queryByLabelText('common:artifacts.revisePlaceholder')
    ).toBeNull()
  })
})

describe('buildRevisePrompt', () => {
  it('builds the spec template for short artifacts', () => {
    const prompt = buildRevisePrompt({
      kind: 'html',
      content: '<p>hello</p>',
      selection: 'hello',
      instruction: 'make it bold',
    })
    expect(prompt).toBe(
      'Regarding this html artifact:\n\n<artifact>\n<p>hello</p>\n</artifact>\n\nFor this part:\n<selection>\nhello\n</selection>\n\nmake it bold'
    )
  })

  it('narrows artifacts over 4000 chars to ±500 chars around the selection', () => {
    const content = 'a'.repeat(3000) + 'SELECTION' + 'b'.repeat(3000)
    const prompt = buildRevisePrompt({
      kind: 'code',
      content,
      selection: 'SELECTION',
      instruction: 'fix',
    })
    const artifactMatch = prompt.match(/<artifact>\n([\s\S]*?)\n<\/artifact>/)
    expect(artifactMatch).not.toBeNull()
    const body = artifactMatch![1]
    // ±500 chars around the selection, with ellipsis markers on both sides
    expect(body).toContain('SELECTION')
    expect(body.length).toBe(500 + 'SELECTION'.length + 500 + 2 + 2) // + ellipses and newlines
    expect(body.startsWith('…')).toBe(true)
    expect(body.endsWith('…')).toBe(true)
  })

  it('keeps the full content when the selection cannot be located', () => {
    const content = 'x'.repeat(5000)
    const prompt = buildRevisePrompt({
      kind: 'code',
      content,
      selection: 'not-in-content',
      instruction: 'fix',
    })
    expect(prompt).toContain(`<artifact>\n${content}\n</artifact>`)
  })
})
