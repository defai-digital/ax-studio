import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import { useAxBiConnection } from '@/stores/ax-bi-connection-store'
import {
  connectAxBiDirect,
  createDirectAxBiAuthoringClient,
  disconnectAxBiDirect,
  getDirectAxBiClient,
  getElectronAxBiMcpUrl,
  probeAxBiDirectConnection,
  resetDirectAxBiClientCache,
  setElectronAxBiMcpUrlOverride,
} from '../direct-client'
import { DEFAULT_AX_BI_MCP_URL } from '../endpoints'

let storedToken: string | null = null

vi.mock('../token-storage', async (importOriginal) => {
  // Keep the real normalizeAxBiToken (it lives in token-storage now); only
  // the persistence functions are stubbed.
  const actual = await importOriginal<typeof import('../token-storage')>()
  return {
    ...actual,
    readStoredAxBiMcpToken: vi.fn(async () => storedToken),
    storeAxBiMcpToken: vi.fn(async (token: string) => {
      storedToken = token
    }),
    clearStoredAxBiMcpToken: vi.fn(async () => {
      storedToken = null
    }),
  }
})

function jsonRpcResponse(id: string, result: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

const CAPABILITIES = {
  contract_version: '1.0',
  operations: ['prompt_to_dashboard'],
  upload_formats: ['csv'],
  limits: { max_charts_per_dashboard: 6, max_upload_bytes: 10_000_000 },
}

/** initialize → notifications/initialized (202) → per-tool-call responses. */
function handshakeThen(...toolResponses: Array<() => Response>) {
  const queue: Array<() => Response> = [
    () =>
      jsonRpcResponse(
        '1',
        { protocolVersion: '2025-03-26' },
        { 'Mcp-Session-Id': 'session-1' }
      ),
    () => new Response(null, { status: 202 }),
    ...toolResponses,
  ]
  // Responses are single-read; build a fresh one per fetch call and keep
  // answering with the last queued response once the queue drains.
  return vi.fn().mockImplementation(async () => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    return next()
  })
}

describe('AX BI direct client (Electron path)', () => {
  beforeEach(() => {
    storedToken = null
    localStorage.clear()
    useAxBiConnection.getState().setStatus('unknown')
  })

  afterEach(() => {
    resetDirectAxBiClientCache()
    vi.unstubAllGlobals()
  })

  it('defaults the MCP URL to the hidden local endpoint', () => {
    expect(getElectronAxBiMcpUrl()).toBe(DEFAULT_AX_BI_MCP_URL)
  })

  it('normalizes the dev/smoke URL override and ignores invalid values', () => {
    setElectronAxBiMcpUrlOverride('127.0.0.1:31423')
    // Local web ports rewrite /mcp traffic to the MCP port.
    expect(getElectronAxBiMcpUrl()).toBe('http://127.0.0.1:31421/mcp')

    // Invalid overrides are rejected eagerly; the hidden default stays.
    expect(() => setElectronAxBiMcpUrlOverride('ftp://example.com')).toThrow(
      'HTTP or HTTPS'
    )
    expect(getElectronAxBiMcpUrl()).toBe(DEFAULT_AX_BI_MCP_URL)

    setElectronAxBiMcpUrlOverride(null)
    expect(localStorage.getItem(localStorageKey.axBiMcpUrlOverride)).toBeNull()
  })

  it('requires a stored token before building the client', async () => {
    await expect(getDirectAxBiClient()).rejects.toThrow(
      'AX BI API key or JWT is required.'
    )
  })

  it('connect stores the token, handshakes, and injects the Bearer header', async () => {
    const fetchMock = handshakeThen(() =>
      jsonRpcResponse('2', { structuredContent: CAPABILITIES })
    )
    vi.stubGlobal('fetch', fetchMock)

    const url = await connectAxBiDirect({ token: 'Bearer sst_smoke' })

    expect(url).toBe(DEFAULT_AX_BI_MCP_URL)
    // "Bearer "-prefixed input is normalized before storing/sending.
    expect(storedToken).toBe('sst_smoke')
    expect(useAxBiConnection.getState().status).toBe('connected')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe(DEFAULT_AX_BI_MCP_URL)
      expect(call[1]?.headers).toMatchObject({
        Authorization: 'Bearer sst_smoke',
        Accept: 'application/json, text/event-stream',
      })
    }
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject(
      { method: 'initialize' }
    )
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      jsonrpc: '2.0',
      id: '2',
      method: 'tools/call',
      params: { name: 'get_authoring_capabilities', arguments: {} },
    })
  })

  it('marks needs-key when no token is available', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(connectAxBiDirect()).rejects.toThrow(
      'AX BI API key or JWT is required.'
    )
    expect(useAxBiConnection.getState().status).toBe('needs-key')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks needs-key on authentication failures', async () => {
    storedToken = 'sst_bad'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 401 }))
    )

    await expect(connectAxBiDirect()).rejects.toThrow('401')
    const state = useAxBiConnection.getState()
    expect(state.status).toBe('needs-key')
    expect(state.message).toContain('Authentication failed')
  })

  it('disconnect clears the saved token and cached client', async () => {
    storedToken = 'sst_smoke'
    const client = await getDirectAxBiClient()
    useAxBiConnection.getState().setStatus('connected')

    await disconnectAxBiDirect()

    expect(storedToken).toBeNull()
    expect(useAxBiConnection.getState().status).toBe('needs-key')

    storedToken = 'sst_smoke'
    expect(await getDirectAxBiClient()).not.toBe(client)
  })

  it('marks unreachable on network failures', async () => {
    storedToken = 'sst_smoke'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED'))
    )

    await expect(connectAxBiDirect()).rejects.toThrow('ECONNREFUSED')
    expect(useAxBiConnection.getState().status).toBe('unreachable')
  })

  it('probe reports needs-key without a token and never throws', async () => {
    await expect(probeAxBiDirectConnection()).resolves.toBeUndefined()
    expect(useAxBiConnection.getState().status).toBe('needs-key')
  })

  it('authoring client reuses one MCP session across calls', async () => {
    storedToken = 'sst_smoke'
    const fetchMock = handshakeThen(
      () => jsonRpcResponse('2', { structuredContent: CAPABILITIES }),
      () =>
        jsonRpcResponse('3', {
          structuredContent: {
            status: 'completed',
            dashboard_url: 'http://127.0.0.1:31423/ax-bi/dashboard/9/',
          },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = createDirectAxBiAuthoringClient()
    await client.ai.getAuthoringCapabilities()
    const result = await client.ai.promptToDashboard({
      prompt: 'Build a sales dashboard',
    })

    expect(result).toMatchObject({ status: 'completed' })
    // 1 initialize + 1 notification + 2 tool calls: the session is reused.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toMatchObject(
      {
        method: 'tools/call',
        params: { name: 'prompt_to_dashboard' },
      }
    )
    // Session header from the handshake is attached to subsequent calls.
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      'Mcp-Session-Id': 'session-1',
    })
  })

  it('rebuilds the client when the stored token changes', async () => {
    storedToken = 'sst_one'
    const first = await getDirectAxBiClient()
    storedToken = 'sst_two'
    const second = await getDirectAxBiClient()
    expect(second).not.toBe(first)
    storedToken = 'sst_two'
    expect(await getDirectAxBiClient()).toBe(second)
  })
})
