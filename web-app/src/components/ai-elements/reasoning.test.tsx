import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/markdown/renderer', () => ({
  AXMarkdown: ({ children }: { children: string }) => (
    <div data-testid="ax-markdown">{children}</div>
  ),
}))

vi.mock('./shimmer', () => ({
  Shimmer: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="shimmer">{children}</span>
  ),
}))

import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
  useReasoning,
} from './reasoning'

describe('Reasoning', () => {
  it('renders children inside a collapsible', () => {
    render(
      <Reasoning>
        <div data-testid="child">Content</div>
      </Reasoning>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('is open by default (defaultOpen=true)', () => {
    render(
      <Reasoning>
        <ReasoningTrigger />
        <ReasoningContent>Thinking text</ReasoningContent>
      </Reasoning>
    )
    expect(screen.getByTestId('ax-markdown')).toBeInTheDocument()
    expect(screen.getByTestId('ax-markdown').textContent).toBe('Thinking text')
  })

  it('renders closed when defaultOpen=false', () => {
    render(
      <Reasoning defaultOpen={false}>
        <ReasoningTrigger />
        <ReasoningContent>Hidden text</ReasoningContent>
      </Reasoning>
    )
    // Collapsible content should not be visible
    const content = screen.queryByTestId('ax-markdown')
    // The content may still be in the DOM but hidden
    if (content) {
      const collapsibleContent = content.closest('[data-state]')
      expect(collapsibleContent?.getAttribute('data-state')).toBe('closed')
    }
  })

  it('applies custom className', () => {
    const { container } = render(
      <Reasoning className="custom-class">
        <div>child</div>
      </Reasoning>
    )
    const collapsible = container.firstChild as HTMLElement
    expect(collapsible.className).toContain('custom-class')
    expect(collapsible.className).toContain('not-prose')
  })
})

describe('ReasoningTrigger', () => {
  it('shows "Thinking..." when streaming', () => {
    render(
      <Reasoning isStreaming={true}>
        <ReasoningTrigger />
      </Reasoning>
    )
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('shows duration when not streaming and duration is defined', () => {
    render(
      <Reasoning isStreaming={false} duration={5}>
        <ReasoningTrigger />
      </Reasoning>
    )
    expect(screen.getByText('Thought for 5 seconds')).toBeInTheDocument()
  })

  it('shows "Thought for a few seconds" when duration is undefined and not streaming', () => {
    render(
      <Reasoning isStreaming={false}>
        <ReasoningTrigger />
      </Reasoning>
    )
    expect(
      screen.getByText('Thought for a few seconds')
    ).toBeInTheDocument()
  })

  it('shows "Thinking..." when duration is 0', () => {
    render(
      <Reasoning isStreaming={false} duration={0}>
        <ReasoningTrigger />
      </Reasoning>
    )
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('renders custom children instead of default trigger', () => {
    render(
      <Reasoning>
        <ReasoningTrigger>
          <span>Custom trigger</span>
        </ReasoningTrigger>
      </Reasoning>
    )
    expect(screen.getByText('Custom trigger')).toBeInTheDocument()
  })

  it('uses custom getThinkingMessage when provided', () => {
    const customMessage = (isStreaming: boolean) =>
      isStreaming ? 'Working...' : 'Done!'
    render(
      <Reasoning isStreaming={true}>
        <ReasoningTrigger getThinkingMessage={customMessage} />
      </Reasoning>
    )
    expect(screen.getByText('Working...')).toBeInTheDocument()
  })
})

describe('ReasoningContent', () => {
  it('renders markdown content from children string', () => {
    render(
      <Reasoning defaultOpen={true}>
        <ReasoningContent>Some reasoning text here</ReasoningContent>
      </Reasoning>
    )
    expect(screen.getByTestId('ax-markdown').textContent).toBe(
      'Some reasoning text here'
    )
  })
})

describe('useReasoning', () => {
  it('throws when used outside Reasoning context', () => {
    const TestComponent = () => {
      useReasoning()
      return null
    }
    expect(() => render(<TestComponent />)).toThrow(
      'Reasoning components must be used within Reasoning'
    )
  })
})
