import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AX_BI_MCP_URL,
  DEFAULT_AX_BI_WEB_URL,
  normalizeAxBiMcpUrl,
} from '../endpoints'

describe('normalizeAxBiMcpUrl', () => {
  it('defaults empty input to the local streamable-HTTP MCP endpoint', () => {
    expect(normalizeAxBiMcpUrl('')).toBe(DEFAULT_AX_BI_MCP_URL)
    expect(normalizeAxBiMcpUrl('   ')).toBe(DEFAULT_AX_BI_MCP_URL)
    expect(DEFAULT_AX_BI_MCP_URL).toBe('http://127.0.0.1:31421/mcp')
    expect(DEFAULT_AX_BI_WEB_URL).toBe('http://127.0.0.1:31423')
  })

  it('appends /mcp when missing and strips a trailing slash', () => {
    expect(normalizeAxBiMcpUrl('http://127.0.0.1:31421')).toBe(
      'http://127.0.0.1:31421/mcp'
    )
    expect(normalizeAxBiMcpUrl('http://127.0.0.1:31421/mcp/')).toBe(
      'http://127.0.0.1:31421/mcp'
    )
  })

  it('rewrites local web ports to MCP port 31421 for /mcp', () => {
    expect(normalizeAxBiMcpUrl('http://127.0.0.1:31423/mcp')).toBe(
      'http://127.0.0.1:31421/mcp'
    )
    expect(normalizeAxBiMcpUrl('localhost:31423')).toBe(
      'http://localhost:31421/mcp'
    )
    expect(normalizeAxBiMcpUrl('http://[::1]:31422/mcp')).toBe(
      'http://[::1]:31421/mcp'
    )
    expect(normalizeAxBiMcpUrl('http://127.0.0.1:31429/mcp')).toBe(
      'http://127.0.0.1:31421/mcp'
    )
    // Legacy Superset-style port.
    expect(normalizeAxBiMcpUrl('http://127.0.0.1:8088/mcp')).toBe(
      'http://127.0.0.1:31421/mcp'
    )
  })

  it('preserves remote hosts and ports (reverse-proxy /mcp)', () => {
    expect(normalizeAxBiMcpUrl('https://bi.example.com')).toBe(
      'https://bi.example.com/mcp'
    )
    expect(normalizeAxBiMcpUrl('https://bi.example.com:8443/api')).toBe(
      'https://bi.example.com:8443/api/mcp'
    )
  })

  it('rejects credentials, query strings, and non-HTTP schemes', () => {
    expect(() => normalizeAxBiMcpUrl('http://user:pass@localhost:31421/mcp')).toThrow(
      /credentials/
    )
    expect(() => normalizeAxBiMcpUrl('http://localhost:31421/mcp?x=1')).toThrow(
      /query or fragment/
    )
    expect(() => normalizeAxBiMcpUrl('ftp://localhost:31421/mcp')).toThrow(
      /HTTP or HTTPS/
    )
  })
})
