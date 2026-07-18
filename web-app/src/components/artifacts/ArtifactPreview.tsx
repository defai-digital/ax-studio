import { useMemo } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { Artifact } from '@/lib/artifacts/extract-artifacts'

/**
 * ArtifactPreview — static html/svg rendering inside a fully sandboxed
 * srcdoc iframe.
 *
 * Security model (v1, static preview only — artifact JavaScript never runs):
 * 1. `sandbox=""` — no allow-scripts, no allow-same-origin: opaque origin,
 *    no script execution, no access to the parent DOM or Tauri IPC.
 * 2. A meta CSP is injected as the FIRST <head> content of the srcdoc
 *    document (see wrapWithCsp), so even if scripts are ever re-enabled
 *    there is no network egress.
 * 3. The app CSP (frame-src 'self') already blocks blob:/data: frames;
 *    srcdoc needs no CSP change.
 *
 * SVG is always rendered inside this iframe, never inline in the app DOM
 * (SVG can carry <script>).
 */

export const ARTIFACT_PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; connect-src 'none'"

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_PREVIEW_CSP}" />`

/**
 * Inject the meta CSP as the first content of <head>. Documents without a
 * <head> (snippets) get the meta prepended so it is parsed before anything
 * else in the document.
 */
export function wrapWithCsp(html: string): string {
  const headOpen = /<head[^>]*>/i.exec(html)
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length
    return html.slice(0, at) + CSP_META + html.slice(at)
  }

  const htmlOpen = /<html[^>]*>/i.exec(html)
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length
    return `${html.slice(0, at)}<head>${CSP_META}</head>${html.slice(at)}`
  }

  const doctype = /<!doctype[^>]*>/i.exec(html)
  if (doctype) {
    const at = doctype.index + doctype[0].length
    return html.slice(0, at) + CSP_META + html.slice(at)
  }

  return CSP_META + html
}

/** Wrap a raw SVG document in a minimal HTML shell for iframe rendering. */
export function wrapSvgDocument(svg: string): string {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8" />' +
    '<style>html,body{margin:0;padding:0;min-height:100vh;display:flex;' +
    'align-items:center;justify-content:center}svg{max-width:100%;height:auto}</style>' +
    `</head><body>${svg}</body></html>`
  )
}

export function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const { t } = useTranslation()
  const srcdoc = useMemo(() => {
    const document =
      artifact.kind === 'svg'
        ? wrapSvgDocument(artifact.content)
        : artifact.content
    return wrapWithCsp(document)
  }, [artifact.kind, artifact.content])

  return (
    <iframe
      sandbox=""
      srcDoc={srcdoc}
      title={t('common:artifacts.previewTitle')}
      className="h-full w-full border-0 bg-white"
    />
  )
}
