export const ARTIFACT_PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; connect-src 'none'"

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_PREVIEW_CSP}" />`

/** Inject the preview CSP before any document-controlled head content. */
export function wrapWithCsp(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return `<!DOCTYPE html><html><head>${CSP_META}</head><body>${html}</body></html>`
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const meta = parsed.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = ARTIFACT_PREVIEW_CSP
  parsed.head.prepend(meta)
  return `<!DOCTYPE html>${parsed.documentElement.outerHTML}`
}

/** Wrap a raw SVG document in a minimal HTML shell for iframe rendering.
 * CSP is applied the same way as HTML artifacts so SVG `<script>`,
 * event handlers, and network-fetching elements cannot escape the sandbox.
 */
export function wrapSvgDocument(svg: string): string {
  return wrapWithCsp(
    '<!DOCTYPE html><html><head><meta charset="utf-8" />' +
      '<style>html,body{margin:0;padding:0;min-height:100vh;display:flex;' +
      'align-items:center;justify-content:center}svg{max-width:100%;height:auto}</style>' +
      `</head><body>${svg}</body></html>`
  )
}
