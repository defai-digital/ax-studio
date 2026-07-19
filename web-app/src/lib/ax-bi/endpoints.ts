/**
 * Local AX BI port map (must stay aligned with the ax-bi stack defaults).
 *
 * | Variable | Default | Service |
 * |----------|--------:|---------|
 * | MCP_PORT | 31421 | MCP |
 * | NODE_PORT / WEBPACK_DEVSERVER_PORT | 31422 | Frontend dev |
 * | AXBI_PORT | 31423 | Web app |
 * | AX_SERVICES_PORT | 31424 | AX Services |
 * | WEBSOCKET_PORT | 31425 | Async WS |
 * | WEBSOCKET_HTTP_PORT | 31426 | WS HTTP |
 * | NGINX_PORT | 31429 | Nginx host port |
 * | DATABASE_PORT | 5432 | Postgres |
 * | REDIS_PORT | 6379 | Redis |
 *
 * AX Studio itself uses 31420 (Vite) and 31430 (HMR when host is set).
 */
export const AX_BI_SERVER = 'ax-bi'

/** MCP streamable-HTTP port (`MCP_PORT`). */
export const DEFAULT_AX_BI_MCP_PORT = 31421
/** AX BI web app port (`AXBI_PORT`). */
export const DEFAULT_AX_BI_WEB_PORT = 31423
/** AX BI webpack / frontend-dev port (`NODE_PORT` / `WEBPACK_DEVSERVER_PORT`). */
export const DEFAULT_AX_BI_NODE_PORT = 31422
/** AX Services port (`AX_SERVICES_PORT`). */
export const DEFAULT_AX_BI_SERVICES_PORT = 31424
/** Async WebSocket port (`WEBSOCKET_PORT`). */
export const DEFAULT_AX_BI_WEBSOCKET_PORT = 31425
/** WebSocket HTTP port (`WEBSOCKET_HTTP_PORT`). */
export const DEFAULT_AX_BI_WEBSOCKET_HTTP_PORT = 31426
/** Nginx published host port (`NGINX_PORT`). */
export const DEFAULT_AX_BI_NGINX_PORT = 31429

export const DEFAULT_AX_BI_WEB_URL = `http://127.0.0.1:${DEFAULT_AX_BI_WEB_PORT}`
/** Default streamable-HTTP MCP endpoint (`MCP_PORT` / FASTMCP). */
export const DEFAULT_AX_BI_MCP_URL = `http://127.0.0.1:${DEFAULT_AX_BI_MCP_PORT}/mcp`

/** Local web-facing ports that should rewrite `/mcp` traffic to the MCP port. */
const LOCAL_WEB_PORTS_TO_MCP = new Set([
  String(DEFAULT_AX_BI_WEB_PORT),
  String(DEFAULT_AX_BI_NODE_PORT),
  String(DEFAULT_AX_BI_NGINX_PORT),
  // Legacy Superset-style default still used in older installs/docs.
  '8088',
])

/**
 * Normalize user/config MCP URLs to the streamable-HTTP endpoint shape used by
 * ax-bi (`…/mcp`, no trailing slash, no credentials/query/fragment).
 * Local web ports (31423, 31422, 31429, legacy 8088) rewrite to MCP 31421
 * when the path is `/mcp`.
 */
export function normalizeAxBiMcpUrl(value: string): string {
  const trimmed = value.trim()
  const candidate = trimmed || DEFAULT_AX_BI_MCP_URL
  // Reject explicit non-HTTP absolute schemes (require "://") before host:port
  // shorthand prepending would turn `ftp://…` into a bogus `http://ftp://…`.
  // Do not treat `localhost:8088` as a scheme — that is host:port shorthand.
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) &&
    !/^https?:\/\//i.test(candidate)
  ) {
    throw new Error('AX BI MCP URL must use HTTP or HTTPS.')
  }
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
  // URL.hostname may be `::1` or `[::1]` depending on runtime.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    (host === '127.0.0.1' || host === 'localhost' || host === '::1') &&
    LOCAL_WEB_PORTS_TO_MCP.has(url.port) &&
    url.pathname.toLowerCase() === '/mcp'
  ) {
    url.port = String(DEFAULT_AX_BI_MCP_PORT)
  }
  return url.toString().replace(/\/$/, '')
}
