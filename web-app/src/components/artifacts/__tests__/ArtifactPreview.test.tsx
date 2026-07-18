import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ArtifactPreview } from '../ArtifactPreview'
import {
  wrapWithCsp,
  wrapSvgDocument,
  ARTIFACT_PREVIEW_CSP,
} from '@/lib/artifacts/artifact-preview'
import type { Artifact } from '@/lib/artifacts/extract-artifacts'

const makeArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'm1:0',
  messageId: 'm1',
  kind: 'html',
  language: 'html',
  content: '<p>hello</p>',
  lineCount: 1,
  ...overrides,
})

describe('wrapWithCsp', () => {
  it('injects the meta CSP as the first content of <head>', () => {
    const out = wrapWithCsp('<html><head><title>t</title></head></html>')
    const headAt = out.toLowerCase().indexOf('<head>')
    const metaAt = out.indexOf('http-equiv="Content-Security-Policy"')
    const titleAt = out.indexOf('<title>')
    expect(metaAt).toBeGreaterThan(headAt)
    expect(metaAt).toBeLessThan(titleAt)
  })

  it('injects a <head> when the document only has <html>', () => {
    const out = wrapWithCsp('<html><body>x</body></html>')
    expect(out).toMatch(
      /<html><head><meta[^>]*Content-Security-Policy[^>]*><\/head><body>/
    )
  })

  it('inserts right after a doctype when no html/head tags exist', () => {
    const out = wrapWithCsp('<!DOCTYPE html><p>x</p>')
    const doctypeEnd =
      out.toLowerCase().indexOf('<!doctype html>') + '<!doctype html>'.length
    expect(out.slice(doctypeEnd).startsWith('<meta ')).toBe(true)
  })

  it('prepends the meta CSP to bare snippets so it comes first', () => {
    const out = wrapWithCsp('<p>x</p>')
    expect(out.startsWith('<meta ')).toBe(true)
    expect(out.indexOf('<p>')).toBeGreaterThan(
      out.indexOf('Content-Security-Policy')
    )
  })

  it('carries the restrictive policy (no network egress)', () => {
    const out = wrapWithCsp('<p>x</p>')
    expect(out).toContain(ARTIFACT_PREVIEW_CSP)
    expect(ARTIFACT_PREVIEW_CSP).toContain("connect-src 'none'")
    expect(ARTIFACT_PREVIEW_CSP).toContain('img-src data: blob:')
  })
})

describe('wrapSvgDocument', () => {
  it('wraps svg markup in a minimal html document', () => {
    const out = wrapSvgDocument('<svg viewBox="0 0 1 1"></svg>')
    expect(out).toContain('<html>')
    expect(out).toContain('<body><svg viewBox="0 0 1 1"></svg></body>')
  })
})

describe('ArtifactPreview', () => {
  it('renders a fully sandboxed srcdoc iframe', () => {
    render(<ArtifactPreview artifact={makeArtifact()} />)
    const iframe = screen.getByTitle(
      'common:artifacts.previewTitle'
    ) as HTMLIFrameElement

    // sandbox="" — no permissions at all
    expect(iframe.getAttribute('sandbox')).toBe('')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')

    // srcdoc carries the injected meta CSP as first head content
    const srcdoc = iframe.getAttribute('srcdoc') ?? ''
    expect(srcdoc.startsWith('<meta ')).toBe(true)
    expect(srcdoc).toContain(ARTIFACT_PREVIEW_CSP)
    expect(srcdoc).toContain('<p>hello</p>')
  })

  it('keeps sandbox attributes correct when the artifact contains scripts', () => {
    // jsdom never executes iframe scripts — this asserts the attribute layer:
    // even hostile content is loaded into a scriptless, opaque-origin frame.
    render(
      <ArtifactPreview
        artifact={makeArtifact({
          content:
            '<!DOCTYPE html><html><head></head><body><script>alert(1)</script></body></html>',
        })}
      />
    )
    const iframe = screen.getByTitle(
      'common:artifacts.previewTitle'
    ) as HTMLIFrameElement
    expect(iframe.getAttribute('sandbox')).toBe('')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')

    const srcdoc = iframe.getAttribute('srcdoc') ?? ''
    // meta CSP is still the first thing inside <head>
    const headAt = srcdoc.toLowerCase().indexOf('<head>')
    const metaAt = srcdoc.indexOf('Content-Security-Policy')
    const scriptAt = srcdoc.indexOf('<script>')
    expect(metaAt).toBeGreaterThan(headAt)
    expect(metaAt).toBeLessThan(scriptAt)
  })

  it('wraps svg artifacts in a minimal html document with CSP first', () => {
    render(
      <ArtifactPreview
        artifact={makeArtifact({
          kind: 'svg',
          language: 'svg',
          content:
            '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
        })}
      />
    )
    const iframe = screen.getByTitle(
      'common:artifacts.previewTitle'
    ) as HTMLIFrameElement
    const srcdoc = iframe.getAttribute('srcdoc') ?? ''
    expect(srcdoc).toContain('<svg viewBox="0 0 10 10">')
    expect(srcdoc).toContain('<body>')
    // CSP meta sits at the very start of <head>, before charset/style
    const headAt = srcdoc.toLowerCase().indexOf('<head>')
    const metaAt = srcdoc.indexOf('Content-Security-Policy')
    const charsetAt = srcdoc.indexOf('charset')
    expect(metaAt).toBeGreaterThan(headAt)
    expect(metaAt).toBeLessThan(charsetAt)
  })
})
