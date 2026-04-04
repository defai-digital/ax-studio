import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResearchPanel } from './ResearchPanel'
import type { ResearchEntry } from '@/hooks/useResearchPanel'

let mockEntry: ResearchEntry | null = null
const mockCancelResearch = vi.fn()

vi.mock('@/hooks/useResearchPanel', () => ({
  useResearchPanel: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getPinned: (_threadId: string) => mockEntry,
    }),
}))

vi.mock('@/hooks/useResearch', () => ({
  useResearch: () => ({
    cancelResearch: mockCancelResearch,
  }),
}))

vi.mock('./ResearchProgress', () => ({
  ResearchProgress: ({ steps }: { steps: unknown[] }) => (
    <div data-testid="research-progress">steps:{steps.length}</div>
  ),
}))

vi.mock('./ResearchReport', () => ({
  ResearchReport: ({ markdown }: { markdown: string }) => (
    <div data-testid="research-report">{markdown}</div>
  ),
}))

vi.mock('./SourcesList', () => ({
  SourcesList: ({ sources }: { sources: unknown[] }) => (
    <div data-testid="sources-list">sources:{sources.length}</div>
  ),
}))

describe('ResearchPanel', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockEntry = null
  })

  it('returns null when no entry is pinned', () => {
    const { container } = render(
      <ResearchPanel threadId="t1" onClose={onClose} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders Research badge and query when entry exists', () => {
    mockEntry = {
      status: 'running',
      query: 'AI safety trends',
      depth: 2,
      steps: [],
      sources: [],
      reportMarkdown: '',
    }
    render(<ResearchPanel threadId="t1" onClose={onClose} />)

    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getByText('AI safety trends')).toBeInTheDocument()
  })

  it('shows Researching status when running', () => {
    mockEntry = {
      status: 'running',
      query: 'test',
      depth: 1,
      steps: [],
      sources: [],
      reportMarkdown: '',
    }
    render(<ResearchPanel threadId="t1" onClose={onClose} />)
    expect(screen.getByText('Researching…')).toBeInTheDocument()
  })

  it('shows source count when done', () => {
    mockEntry = {
      status: 'done',
      query: 'test',
      depth: 1,
      steps: [],
      sources: [
        { url: 'https://a.com', title: 'A', snippet: 's' },
        { url: 'https://b.com', title: 'B', snippet: 's' },
      ],
      reportMarkdown: '# Report',
    }
    render(<ResearchPanel threadId="t1" onClose={onClose} />)
    expect(screen.getByText('2 sources')).toBeInTheDocument()
  })

  it('shows Cancel button when running', () => {
    mockEntry = {
      status: 'running',
      query: 'test',
      depth: 1,
      steps: [],
      sources: [],
      reportMarkdown: '',
    }
    render(<ResearchPanel threadId="t1" onClose={onClose} />)
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('does not show Cancel button when done', () => {
    mockEntry = {
      status: 'done',
      query: 'test',
      depth: 1,
      steps: [],
      sources: [],
      reportMarkdown: 'report',
    }
    render(<ResearchPanel threadId="t1" onClose={onClose} />)
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', async () => {
    mockEntry = {
      status: 'done',
      query: 'test',
      depth: 1,
      steps: [],
      sources: [],
      reportMarkdown: '',
    }
    const user = userEvent.setup()
    render(<ResearchPanel threadId="t1" onClose={onClose} />)

    await user.click(screen.getByTitle('Close panel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows progress tab by default for running entry', () => {
    mockEntry = {
      status: 'running',
      query: 'test',
      depth: 1,
      steps: [{ type: 'planning', timestamp: Date.now() }],
      sources: [],
      reportMarkdown: '',
    }
    render(<ResearchPanel threadId="t1" onClose={onClose} />)
    expect(screen.getByTestId('research-progress')).toBeInTheDocument()
  })

  it('switches to sources tab on click', async () => {
    mockEntry = {
      status: 'done',
      query: 'test',
      depth: 1,
      steps: [],
      sources: [{ url: 'https://a.com', title: 'A', snippet: 's' }],
      reportMarkdown: 'report',
    }
    const user = userEvent.setup()
    render(<ResearchPanel threadId="t1" onClose={onClose} />)

    await user.click(screen.getByTitle('Sources'))
    expect(screen.getByTestId('sources-list')).toBeInTheDocument()
  })

  it('shows Cancelled status', () => {
    mockEntry = {
      status: 'cancelled',
      query: 'test',
      depth: 1,
      steps: [],
      sources: [],
      reportMarkdown: '',
    }
    render(<ResearchPanel threadId="t1" onClose={onClose} />)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })
})
