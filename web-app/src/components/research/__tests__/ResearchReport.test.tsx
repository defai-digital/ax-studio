import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ResearchReport } from '../ResearchReport'

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}))

describe('ResearchReport', () => {
  it('shows placeholder when no markdown and not streaming', () => {
    render(
      <ResearchReport markdown="" isStreaming={false} sources={[]} />
    )
    expect(
      screen.getByText('Report will appear here once writing begins…')
    ).toBeInTheDocument()
  })

  it('renders markdown content through RenderMarkdown', () => {
    render(
      <ResearchReport
        markdown="# Hello World"
        isStreaming={false}
        sources={[]}
      />
    )
    expect(screen.getByTestId('markdown')).toHaveTextContent('# Hello World')
  })

  it('appends cursor when streaming', () => {
    render(
      <ResearchReport
        markdown="In progress"
        isStreaming={true}
        sources={[]}
      />
    )
    expect(screen.getByTestId('markdown').textContent).toContain('▌')
  })

  it('does not append cursor when not streaming', () => {
    render(
      <ResearchReport
        markdown="Complete report"
        isStreaming={false}
        sources={[]}
      />
    )
    expect(screen.getByTestId('markdown').textContent).not.toContain('▌')
  })

  it('strips Sources section from markdown', () => {
    const md = '# Report\n\nContent here\n\n## Sources\n- [1] example.com'
    render(
      <ResearchReport markdown={md} isStreaming={false} sources={[]} />
    )
    const content = screen.getByTestId('markdown').textContent ?? ''
    expect(content).not.toContain('## Sources')
    expect(content).toContain('Content here')
  })

  it('strips References section from markdown', () => {
    const md = '# Report\n\nContent\n\n## References\n1. ref'
    render(
      <ResearchReport markdown={md} isStreaming={false} sources={[]} />
    )
    const content = screen.getByTestId('markdown').textContent ?? ''
    expect(content).not.toContain('## References')
  })

  it('makes citation markers clickable when sources are provided', () => {
    const md = 'According to [1], this is true.'
    const sources = [
      { url: 'https://example.com', title: 'Example', snippet: 'snip' },
    ]
    render(
      <ResearchReport
        markdown={md}
        isStreaming={false}
        sources={sources}
      />
    )
    const content = screen.getByTestId('markdown').textContent ?? ''
    expect(content).toContain('https://example.com')
  })

  it('leaves citation markers unchanged when index is out of bounds', () => {
    const md = 'See [99] for details.'
    const sources = [
      { url: 'https://example.com', title: 'Example', snippet: 'snip' },
    ]
    render(
      <ResearchReport
        markdown={md}
        isStreaming={false}
        sources={sources}
      />
    )
    const content = screen.getByTestId('markdown').textContent ?? ''
    expect(content).toContain('[99]')
  })
})
