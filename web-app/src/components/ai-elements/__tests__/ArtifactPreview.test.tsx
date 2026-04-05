import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ArtifactPreview } from '../ArtifactPreview'

vi.mock('@/lib/artifacts/harness', () => ({
  buildHarnessAsync: vi.fn().mockResolvedValue('<html><body>test</body></html>'),
}))

describe('ArtifactPreview', () => {
  it('renders SVG inline via dangerouslySetInnerHTML for svg type', () => {
    const svgSource = '<svg><circle r="10"/></svg>'
    const { container } = render(
      <ArtifactPreview type="svg" source={svgSource} />
    )

    const wrapper = container.querySelector('.min-h-\\[300px\\]')
    expect(wrapper).toBeInTheDocument()
    // jsdom normalizes self-closing tags like <circle r="10"/> to <circle r="10"></circle>
    expect(wrapper?.innerHTML).toContain('<svg>')
    expect(wrapper?.innerHTML).toContain('circle')
  })

  it('renders an iframe for html type', () => {
    render(<ArtifactPreview type="html" source="<p>hello</p>" version={1} />)

    const iframe = screen.getByTitle('Artifact Preview')
    expect(iframe.tagName).toBe('IFRAME')
  })

  it('renders an iframe for react type', () => {
    render(
      <ArtifactPreview type="react" source="export default () => <div/>" />
    )

    const iframe = screen.getByTitle('Artifact Preview')
    expect(iframe.tagName).toBe('IFRAME')
  })

  it('shows loading indicator while preparing iframe', () => {
    render(<ArtifactPreview type="html" source="<p>test</p>" />)

    expect(screen.getByText('Preparing…')).toBeInTheDocument()
  })

  it('renders an iframe for chartjs type', () => {
    render(<ArtifactPreview type="chartjs" source="{}" />)

    const iframe = screen.getByTitle('Artifact Preview')
    expect(iframe.tagName).toBe('IFRAME')
  })

  it('renders an iframe for vega type', () => {
    render(<ArtifactPreview type="vega" source="{}" />)

    const iframe = screen.getByTitle('Artifact Preview')
    expect(iframe.tagName).toBe('IFRAME')
  })
})
