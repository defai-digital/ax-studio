import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  net: { fetch: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}))

import {
  createAxBiHandlers,
  validateAxBiMcpUrl,
  type AxBiMcpResponse,
} from '../../../../../electron/src/commands/ax-bi'

function response({
  sessionId = 'session-1',
}: { sessionId?: string | null } = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) => {
        if (name === 'content-type') return 'application/json'
        if (name === 'mcp-session-id') return sessionId
        return null
      },
    },
    text: async () =>
      JSON.stringify({ jsonrpc: '2.0', id: '1', result: { ok: true } }),
  }
}

describe('Electron AX BI MCP command', () => {
  it('adds the credential in main and returns only serializable response data', async () => {
    const fetchMcp = vi.fn().mockResolvedValue(response())
    const handler = createAxBiHandlers({
      fetchMcp,
      getToken: () => 'Bearer sst_main_process_only',
    }).ax_bi_mcp_request

    const result = (await handler({
      url: 'http://127.0.0.1:31421/mcp',
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'initialize' }),
      sessionId: 'existing-session',
      timeoutMs: 5_000,
    })) as AxBiMcpResponse

    expect(fetchMcp).toHaveBeenCalledWith(
      'http://127.0.0.1:31421/mcp',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: {
          Accept: 'application/json, text/event-stream',
          Authorization: 'Bearer sst_main_process_only',
          'Content-Type': 'application/json',
          'Mcp-Session-Id': 'existing-session',
        },
      })
    )
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      contentType: 'application/json',
      sessionId: 'session-1',
    })
    expect(JSON.stringify(result)).not.toContain('sst_main_process_only')
  })

  it.each([
    'https://example.com/mcp',
    'http://127.0.0.1:31421/admin',
    'http://user:pass@127.0.0.1:31421/mcp',
    'http://127.0.0.1:31421/mcp?redirect=evil',
    'file:///mcp',
  ])('rejects an unsafe target before reading the token: %s', async (url) => {
    const getToken = vi.fn(() => 'sst_secret')
    const handler = createAxBiHandlers({
      fetchMcp: vi.fn(),
      getToken,
    }).ax_bi_mcp_request

    await expect(
      handler({
        url,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize' }),
      })
    ).rejects.toThrow()
    expect(getToken).not.toHaveBeenCalled()
  })

  it('accepts each supported loopback spelling', () => {
    expect(validateAxBiMcpUrl('http://localhost:31421/mcp')).toBe(
      'http://localhost:31421/mcp'
    )
    expect(validateAxBiMcpUrl('http://[::1]:31421/mcp')).toBe(
      'http://[::1]:31421/mcp'
    )
  })

  it('fails before networking when no credential is saved', async () => {
    const fetchMcp = vi.fn()
    const handler = createAxBiHandlers({
      fetchMcp,
      getToken: () => null,
    }).ax_bi_mcp_request

    await expect(
      handler({
        url: 'http://127.0.0.1:31421/mcp',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize' }),
      })
    ).rejects.toThrow('API key or JWT is required')
    expect(fetchMcp).not.toHaveBeenCalled()
  })
})
