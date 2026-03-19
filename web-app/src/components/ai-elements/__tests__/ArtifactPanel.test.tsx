import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ArtifactPanel } from '../ArtifactPanel'

// Mock useArtifactPanel store
const mockUpdateSource = vi.fn()
const mockRestoreVersion = vi.fn()
let mockPinned: Record<string, unknown> | null = null
let mockHistory: Array<Record<string, unknown>> = []

vi.mock('@/hooks/useArtifactPanel', () => ({
  useArtifactPanel: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      pinnedByThread: { 'thread-1': mockPinned },
      historyByThread: { 'thread-1': mockHistory },
      updateSource: mockUpdateSource,
      restoreVersion: mockRestoreVersion,
    }),
}))

vi.mock('../ArtifactPreview', () => ({
  ArtifactPreview: ({ type, source }: { type: string; source: string }) => (
    <div data-testid="artifact-preview">
      {type}:{source}
    </div>
  ),
}))

describe('ArtifactPanel', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockPinned = null
    mockHistory = []
  })

  it('returns null when no pinned artifact exists', () => {
    mockPinned = null
    const { container } = render(
      <ArtifactPanel threadId="thread-1" onClose={onClose} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders header with type label and Artifact text when pinned', () => {
    mockPinned = { type: 'html', source: '<h1>Hello</h1>', version: 1 }
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    expect(screen.getByText('HTML')).toBeInTheDocument()
    expect(screen.getByText('Artifact')).toBeInTheDocument()
  })

  it('shows preview tab by default', () => {
    mockPinned = { type: 'svg', source: '<svg></svg>', version: 1 }
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    expect(screen.getByTestId('artifact-preview')).toBeInTheDocument()
  })

  it('switches to source tab and shows textarea', async () => {
    mockPinned = { type: 'html', source: '<p>test</p>', version: 1 }
    const user = userEvent.setup()
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    await user.click(screen.getByTitle('Edit source'))
    expect(screen.getByRole('textbox')).toHaveValue('<p>test</p>')
  })

  it('disables Apply and Reset when source is unchanged', async () => {
    mockPinned = { type: 'html', source: '<p>test</p>', version: 1 }
    const user = userEvent.setup()
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    await user.click(screen.getByTitle('Edit source'))

    expect(screen.getByText('Apply')).toBeDisabled()
    expect(screen.getByText('Reset')).toBeDisabled()
  })

  it('enables Apply when source is modified', async () => {
    mockPinned = { type: 'html', source: '<p>test</p>', version: 1 }
    const user = userEvent.setup()
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    await user.click(screen.getByTitle('Edit source'))
    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, '<p>modified</p>')

    expect(screen.getByText('Apply')).not.toBeDisabled()
  })

  it('calls updateSource and switches to preview on Apply', async () => {
    mockPinned = { type: 'html', source: '<p>test</p>', version: 1 }
    const user = userEvent.setup()
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    await user.click(screen.getByTitle('Edit source'))
    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, 'new')
    await user.click(screen.getByText('Apply'))

    expect(mockUpdateSource).toHaveBeenCalledWith('thread-1', 'new')
  })

  it('shows empty history message when no history', async () => {
    mockPinned = { type: 'html', source: '<p>test</p>', version: 1 }
    mockHistory = []
    const user = userEvent.setup()
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    await user.click(screen.getByTitle('Version history'))
    expect(screen.getByText('No history yet.')).toBeInTheDocument()
  })

  it('renders history entries with version numbers', async () => {
    mockPinned = { type: 'html', source: '<p>test</p>', version: 2 }
    mockHistory = [
      { type: 'html', source: '<p>v2</p>', version: 2, timestamp: Date.now() },
      {
        type: 'html',
        source: '<p>v1</p>',
        version: 1,
        timestamp: Date.now() - 60000,
      },
    ]
    const user = userEvent.setup()
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    await user.click(screen.getByTitle('Version history'))
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
  })

  it('shows Restore button only for non-current versions', async () => {
    mockPinned = { type: 'html', source: '<p>v2</p>', version: 2 }
    mockHistory = [
      { type: 'html', source: '<p>v2</p>', version: 2, timestamp: Date.now() },
      {
        type: 'html',
        source: '<p>v1</p>',
        version: 1,
        timestamp: Date.now() - 120000,
      },
    ]
    const user = userEvent.setup()
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    await user.click(screen.getByTitle('Version history'))
    const restoreButtons = screen.getAllByText('Restore')
    expect(restoreButtons).toHaveLength(1)
  })

  it('calls onClose when close button is clicked', async () => {
    mockPinned = { type: 'html', source: '<p>test</p>', version: 1 }
    const user = userEvent.setup()
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    await user.click(screen.getByTitle('Close panel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('copies source to clipboard on copy click', async () => {
    mockPinned = { type: 'html', source: '<p>copy me</p>', version: 1 }
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })
    render(<ArtifactPanel threadId="thread-1" onClose={onClose} />)

    fireEvent.click(screen.getByTitle('Copy source'))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('<p>copy me</p>')
    })
  })
})
