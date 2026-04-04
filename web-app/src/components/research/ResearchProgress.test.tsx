import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll } from 'vitest'
import { ResearchProgress } from './ResearchProgress'
import type { ResearchStep } from '@/hooks/useResearchPanel'

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

describe('ResearchProgress', () => {
  it('shows starting message when no steps', () => {
    render(<ResearchProgress steps={[]} />)
    expect(screen.getByText('Starting research…')).toBeInTheDocument()
  })

  it('renders planning step with default message', () => {
    const steps: ResearchStep[] = [
      { type: 'planning', timestamp: Date.now() },
    ]
    render(<ResearchProgress steps={steps} />)
    expect(screen.getByText('Planning research…')).toBeInTheDocument()
  })

  it('renders planning step with custom message', () => {
    const steps: ResearchStep[] = [
      { type: 'planning', message: 'Identifying topics', timestamp: Date.now() },
    ]
    render(<ResearchProgress steps={steps} />)
    expect(screen.getByText('Identifying topics')).toBeInTheDocument()
  })

  it('renders searching step with query', () => {
    const steps: ResearchStep[] = [
      { type: 'searching', query: 'AI safety', timestamp: Date.now() },
    ]
    render(<ResearchProgress steps={steps} />)
    expect(screen.getByText('Searching: AI safety')).toBeInTheDocument()
  })

  it('renders scraping step with message', () => {
    const steps: ResearchStep[] = [
      {
        type: 'scraping',
        message: 'Fetching: Wikipedia',
        timestamp: Date.now(),
      },
    ]
    render(<ResearchProgress steps={steps} />)
    expect(screen.getByText('Fetching: Wikipedia')).toBeInTheDocument()
  })

  it('renders writing step', () => {
    const steps: ResearchStep[] = [
      { type: 'writing', timestamp: Date.now() },
    ]
    render(<ResearchProgress steps={steps} />)
    expect(screen.getByText('Writing report…')).toBeInTheDocument()
  })

  it('renders done step', () => {
    const steps: ResearchStep[] = [
      { type: 'done', timestamp: Date.now() },
    ]
    render(<ResearchProgress steps={steps} />)
    expect(screen.getByText('Research complete')).toBeInTheDocument()
  })

  it('renders error step with message', () => {
    const steps: ResearchStep[] = [
      { type: 'error', message: 'Rate limit exceeded', timestamp: Date.now() },
    ]
    render(<ResearchProgress steps={steps} />)
    expect(screen.getByText('Error: Rate limit exceeded')).toBeInTheDocument()
  })

  it('renders error step with default message when none provided', () => {
    const steps: ResearchStep[] = [
      { type: 'error', timestamp: Date.now() },
    ]
    render(<ResearchProgress steps={steps} />)
    expect(screen.getByText('Error: Unknown error')).toBeInTheDocument()
  })

  it('renders multiple steps in order', () => {
    const steps: ResearchStep[] = [
      { type: 'planning', timestamp: Date.now() - 3000 },
      { type: 'searching', query: 'topic1', timestamp: Date.now() - 2000 },
      { type: 'done', timestamp: Date.now() },
    ]
    render(<ResearchProgress steps={steps} />)

    expect(screen.getByText('Planning research…')).toBeInTheDocument()
    expect(screen.getByText('Searching: topic1')).toBeInTheDocument()
    expect(screen.getByText('Research complete')).toBeInTheDocument()
  })

  it('renders summarising step with url fallback', () => {
    const steps: ResearchStep[] = [
      {
        type: 'summarising',
        url: 'https://example.com/article',
        timestamp: Date.now(),
      },
    ]
    render(<ResearchProgress steps={steps} />)
    expect(
      screen.getByText('Summarising: https://example.com/article')
    ).toBeInTheDocument()
  })
})
