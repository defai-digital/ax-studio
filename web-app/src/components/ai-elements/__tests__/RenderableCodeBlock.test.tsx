import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { RenderableCodeBlock } from '../RenderableCodeBlock'

vi.mock('../ArtifactBlock', () => ({
  ArtifactBlock: ({
    type,
    source,
    children,
  }: {
    type: string
    source: string
    children: React.ReactNode
  }) => (
    <div data-testid="artifact-block">
      {type}:{source}
      {children}
    </div>
  ),
}))

describe('RenderableCodeBlock', () => {
  it('renders children with a Render button initially', () => {
    render(
      <RenderableCodeBlock type="html" source="<p>hello</p>">
        <pre>code block</pre>
      </RenderableCodeBlock>
    )

    expect(screen.getByText('code block')).toBeInTheDocument()
    expect(screen.getByText('Render')).toBeInTheDocument()
  })

  it('shows correct title attribute based on type', () => {
    render(
      <RenderableCodeBlock type="react" source="<App/>">
        <pre>code</pre>
      </RenderableCodeBlock>
    )

    expect(
      screen.getByTitle('Render as React artifact')
    ).toBeInTheDocument()
  })

  it('switches to ArtifactBlock when Render is clicked', async () => {
    const user = userEvent.setup()
    render(
      <RenderableCodeBlock type="html" source="<p>hello</p>">
        <pre>code block</pre>
      </RenderableCodeBlock>
    )

    await user.click(screen.getByText('Render'))
    expect(screen.getByTestId('artifact-block')).toBeInTheDocument()
    expect(screen.queryByText('Render')).not.toBeInTheDocument()
  })

  it('passes threadId to ArtifactBlock after rendering', async () => {
    const user = userEvent.setup()
    render(
      <RenderableCodeBlock
        type="svg"
        source="<svg/>"
        threadId="thread-123"
      >
        <pre>svg code</pre>
      </RenderableCodeBlock>
    )

    await user.click(screen.getByText('Render'))
    expect(screen.getByTestId('artifact-block')).toBeInTheDocument()
  })

  it('renders the correct label for each artifact type', () => {
    const types = [
      { type: 'html' as const, label: 'HTML' },
      { type: 'react' as const, label: 'React' },
      { type: 'svg' as const, label: 'SVG' },
      { type: 'chartjs' as const, label: 'Chart.js' },
      { type: 'vega' as const, label: 'Vega-Lite' },
    ]

    for (const { type, label } of types) {
      const { unmount } = render(
        <RenderableCodeBlock type={type} source="src">
          <pre>code</pre>
        </RenderableCodeBlock>
      )

      expect(
        screen.getByTitle(`Render as ${label} artifact`)
      ).toBeInTheDocument()
      unmount()
    }
  })
})
