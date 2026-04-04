import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RunLogSummary } from './RunLogViewer'
import type { RunLogData } from '@/lib/multi-agent/run-log'

// ── Mocks ────────────────────────────────────────────

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual }
})

// ── Helpers ──────────────────────────────────────────

function makeRunLog(overrides?: Partial<RunLogData>): RunLogData {
  return {
    id: 'run-1',
    team_id: 'team-1',
    thread_id: 'thread-1',
    status: 'completed',
    steps: [
      {
        agent_id: 'agent-1',
        agent_name: 'Researcher',
        agent_role: 'analyst',
        tokens_used: 1200,
        duration_ms: 3400,
        status: 'complete',
        tool_calls: [{ name: 'web_search', args: { q: 'vitest' } }],
      },
      {
        agent_id: 'agent-2',
        agent_name: 'Writer',
        tokens_used: 800,
        duration_ms: 2100,
        status: 'complete',
      },
    ],
    total_tokens: 2500,
    orchestrator_tokens: 500,
    started_at: 1000,
    completed_at: 6500,
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────

describe('RunLogSummary', () => {
  it('renders the summary button with agent count', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    expect(screen.getByText(/2 agents/)).toBeInTheDocument()
  })

  it('renders total token count', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    expect(screen.getByText(/2,500 tokens/)).toBeInTheDocument()
  })

  it('renders duration in seconds', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    // (6500 - 1000) / 1000 = 5.5s
    expect(screen.getByText(/5\.5s/)).toBeInTheDocument()
  })

  it('uses singular "agent" for single agent', () => {
    const runLog = makeRunLog({
      steps: [
        {
          agent_id: 'agent-1',
          agent_name: 'Solo',
          tokens_used: 500,
          duration_ms: 1000,
          status: 'complete',
        },
      ],
    })
    render(<RunLogSummary runLog={runLog} />)
    expect(screen.getByText(/1 agent(?!s)/)).toBeInTheDocument()
  })

  it('shows 0.0s duration when completed_at is missing', () => {
    const runLog = makeRunLog({ completed_at: undefined })
    render(<RunLogSummary runLog={runLog} />)
    expect(screen.getByText(/0\.0s/)).toBeInTheDocument()
  })

  it('renders Details link', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    expect(screen.getByText('Details')).toBeInTheDocument()
  })

  it('opens dialog when Details button is clicked', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getByText('Run Log')).toBeInTheDocument()
  })

  it('shows status in dialog', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('shows orchestrator tokens in dialog', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getByText('500 tokens')).toBeInTheDocument()
  })

  it('shows step rows with agent names in dialog', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    fireEvent.click(screen.getByText('Details'))
    // Agent names appear in both legend and step rows
    const researchers = screen.getAllByText('Researcher')
    expect(researchers.length).toBeGreaterThanOrEqual(1)
    const writers = screen.getAllByText('Writer')
    expect(writers.length).toBeGreaterThanOrEqual(1)
  })

  it('shows agent role in step row', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getByText('(analyst)')).toBeInTheDocument()
  })

  it('shows token count and duration in step row', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getByText('1,200 tok')).toBeInTheDocument()
    expect(screen.getByText('3.4s')).toBeInTheDocument()
  })

  it('expands step row to show tool calls', () => {
    render(<RunLogSummary runLog={makeRunLog()} />)
    fireEvent.click(screen.getByText('Details'))

    // Click on Researcher step row - use getAllByText since name appears in legend too
    const researcherElements = screen.getAllByText('Researcher')
    // The last one should be in the step row (step rows are after legend)
    fireEvent.click(researcherElements[researcherElements.length - 1])
    expect(screen.getByText('web_search')).toBeInTheDocument()
  })

  it('shows error in dialog when runLog has error', () => {
    const runLog = makeRunLog({
      status: 'failed',
      error: 'Budget exceeded',
    })
    render(<RunLogSummary runLog={runLog} />)
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getByText('Budget exceeded')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('shows Error text for step with error status', () => {
    const runLog = makeRunLog({
      steps: [
        {
          agent_id: 'agent-1',
          agent_name: 'FailAgent',
          tokens_used: 0,
          duration_ms: 100,
          status: 'error',
          error: 'API timeout',
        },
      ],
    })
    render(<RunLogSummary runLog={runLog} />)
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getByText('Error')).toBeInTheDocument()
  })
})
