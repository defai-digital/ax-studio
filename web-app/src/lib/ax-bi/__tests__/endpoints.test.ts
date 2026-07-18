import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AX_BI_MCP_URL,
  normalizeAxBiMcpUrl,
} from '../endpoints'

describe('normalizeAxBiMcpUrl', () => {
  it('defaults empty input to the local streamable-HTTP MCP endpoint', () => {
    expect(normalizeAxBiMcpUrl('')).toBe(DEFAULT_AX_BI_MCP_URL)
    expect(normalizeAxBiMcpUrl('   ')).toBe(DEFAULT_AX_BI_MCP_URL)
  })

  it('appends /mcp when missing and strips a trailing slash', () => {
    expect(normalizeAxBiMcpUrl('http://127.0.0.1:5008')).toBe(
      'http://127.0.0.1:5008/mcp'
    )
    expect(normalizeAxBiMcpUrl('http://127.0.0.1:5008/mcp/')).toBe(
      'http://127.0.0.1:5008/mcp'
    )
  })

  it('rewrites local web port 8088 to MCP port 5008 for /mcp', () => {
    expect(normalizeAxBiMcpUrl('http://127.0.0.1:8088/mcp')).toBe(
      'http://127.0.0.1:5008/mcp'
    )
    expect(normalizeAxBiMcpUrl('localhost:8088')).toBe(
      'http://localhost:5008/mcp'
    )
    expect(normalizeAxBiMcpUrl('http://[::1]:8088/mcp')).toBe(
      'http://[::1]:5008/mcp'
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
    expect(() => normalizeAxBiMcpUrl('http://user:pass@localhost:5008/mcp')).toThrow(
      /credentials/
    )
    expect(() => normalizeAxBiMcpUrl('http://localhost:5008/mcp?x=1')).toThrow(
      /query or fragment/
    )
    expect(() => normalizeAxBiMcpUrl('ftp://localhost:5008/mcp')).toThrow(
      /HTTP or HTTPS/
    )
  })
})
