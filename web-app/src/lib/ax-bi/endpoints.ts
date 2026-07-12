export const AX_BI_SERVER = 'ax-bi'
export const DEFAULT_AX_BI_WEB_URL = 'http://127.0.0.1:8088'
export const DEFAULT_AX_BI_MCP_URL = 'http://127.0.0.1:5008/mcp'

export function normalizeAxBiMcpUrl(value: string): string {
  const trimmed = value.trim()
  const candidate = trimmed || DEFAULT_AX_BI_MCP_URL
  const withProtocol = /^https?:\/\//i.test(candidate)
    ? candidate
    : `http://${candidate}`

  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new Error('AX BI MCP URL must be a valid HTTP(S) URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('AX BI MCP URL must use HTTP or HTTPS.')
  }
  if (url.username || url.password) {
    throw new Error('AX BI MCP URL must not include credentials.')
  }
  if (url.search || url.hash) {
    throw new Error('AX BI MCP URL must not include a query or fragment.')
  }

  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = /\/mcp$/i.test(path) ? path : `${path}/mcp`
  if (
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
    url.port === '8088' &&
    url.pathname.toLowerCase() === '/mcp'
  ) {
    url.port = '5008'
  }
  return url.toString().replace(/\/$/, '')
}
