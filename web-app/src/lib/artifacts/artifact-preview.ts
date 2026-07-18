export const ARTIFACT_PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; connect-src 'none'"

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_PREVIEW_CSP}" />`

/** Inject the preview CSP before any document-controlled head content. */
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
