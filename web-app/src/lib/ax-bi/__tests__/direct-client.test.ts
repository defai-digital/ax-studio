import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import { invoke } from '@/lib/tauri-shim/api-core'
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

vi.mock('@/lib/tauri-shim/api-core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../token-storage', async (importOriginal) => {
  // Keep the real normalizeAxBiToken (it lives in token-storage now); only
  // the persistence functions are stubbed.
  const actual = await importOriginal<typeof import('../token-storage')>()
  return {
    ...actual,
    hasStoredAxBiMcpToken: vi.fn(
      async () => typeof storedToken === 'string' && storedToken.trim().length > 0
    ),
    storeAxBiMcpToken: vi.fn(async (token: string) => {
      storedToken = token
    }),
    clearStoredAxBiMcpToken: vi.fn(async () => {
      storedToken = null
    }),
  }
})

const invokeMock = vi.mocked(invoke)

function jsonRpcResponse(
  id: string,
  result: unknown,
  options?: { sessionId?: string }
) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    contentType: 'application/json',
    sessionId: options?.sessionId ?? null,
    body: JSON.stringify({ jsonrpc: '2.0', id, result }),
  }
}

const CAPABILITIES = {
  contract_version: '1.0',
  operations: ['prompt_to_dashboard'],
  upload_formats: ['csv'],
  limits: { max_charts_per_dashboard: 6, max_upload_bytes: 10_000_000 },
}

/** initialize → notifications/initialized (202) → per-tool-call responses. */
function handshakeThen(...toolResponses: Array<() => unknown>) {
  const queue: Array<() => unknown> = [
    () =>
      jsonRpcResponse('1', { protocolVersion: '2025-03-26' }, {
        sessionId: 'session-1',
      }),
    () => ({
      ok: true,
      status: 202,
      statusText: 'Accepted',
      contentType: null,
      sessionId: null,
      body: '',
    }),
    ...toolResponses,
  ]
  // Keep answering with the last queued response once the queue drains.
  const implementation = vi.fn().mockImplementation(async (command: string) => {
    expect(command).toBe('ax_bi_mcp_request')
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    return next()
  })
  invokeMock.mockImplementation(implementation)
  return implementation
}

describe('AX BI direct client (Electron path)', () => {
  beforeEach(() => {
    storedToken = null
    localStorage.clear()
    vi.clearAllMocks()
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

  it('connect stores the token and brokers the handshake through Electron', async () => {
    const requestMock = handshakeThen(() =>
      jsonRpcResponse('2', { structuredContent: CAPABILITIES })
    )

    const url = await connectAxBiDirect({ token: 'Bearer sst_smoke' })

    expect(url).toBe(DEFAULT_AX_BI_MCP_URL)
    // "Bearer "-prefixed input is normalized before secure storage.
    expect(storedToken).toBe('sst_smoke')
    expect(useAxBiConnection.getState().status).toBe('connected')

    expect(requestMock).toHaveBeenCalledTimes(3)
    for (const call of requestMock.mock.calls) {
      expect(call[1]).toMatchObject({
        url: DEFAULT_AX_BI_MCP_URL,
      })
      expect(call[1]).not.toHaveProperty('token')
      expect(call[1]).not.toHaveProperty('headers')
    }
    expect(JSON.parse(String(requestMock.mock.calls[0]?.[1]?.body))).toMatchObject(
      { method: 'initialize' }
    )
    expect(JSON.parse(String(requestMock.mock.calls[2]?.[1]?.body))).toEqual({
      jsonrpc: '2.0',
      id: '2',
      method: 'tools/call',
      params: { name: 'get_authoring_capabilities', arguments: {} },
    })
  })

  it('marks needs-key when no token is available', async () => {
    await expect(connectAxBiDirect()).rejects.toThrow(
      'AX BI API key or JWT is required.'
    )
    expect(useAxBiConnection.getState().status).toBe('needs-key')
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('marks needs-key on authentication failures', async () => {
    storedToken = 'sst_bad'
    invokeMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      contentType: 'text/plain',
      sessionId: null,
      body: 'nope',
    })

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
    invokeMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(connectAxBiDirect()).rejects.toThrow('Failed to fetch')
    expect(useAxBiConnection.getState().status).toBe('unreachable')
  })

  it('probe reports needs-key without a token and never throws', async () => {
    await expect(probeAxBiDirectConnection()).resolves.toBeUndefined()
    expect(useAxBiConnection.getState().status).toBe('needs-key')
  })

  it('authoring client reuses one MCP session across calls', async () => {
    storedToken = 'sst_smoke'
    const requestMock = handshakeThen(
      () => jsonRpcResponse('2', { structuredContent: CAPABILITIES }),
      () =>
        jsonRpcResponse('3', {
          structuredContent: {
            status: 'completed',
            dashboard_url: 'http://127.0.0.1:31423/ax-bi/dashboard/9/',
          },
        })
    )

    const client = createDirectAxBiAuthoringClient()
    await client.ai.getAuthoringCapabilities()
    const result = await client.ai.promptToDashboard({
      prompt: 'Build a sales dashboard',
    })

    expect(result).toMatchObject({ status: 'completed' })
    // 1 initialize + 1 notification + 2 tool calls: the session is reused.
    expect(requestMock).toHaveBeenCalledTimes(4)
    expect(JSON.parse(String(requestMock.mock.calls[3]?.[1]?.body))).toMatchObject(
      {
        method: 'tools/call',
        params: { name: 'prompt_to_dashboard' },
      }
    )
    // Session header from the handshake is attached to subsequent calls.
    expect(requestMock.mock.calls[2]?.[1]).toMatchObject({
      sessionId: 'session-1',
    })
  })

  it('rebuilds the client when connect replaces the stored token', async () => {
    storedToken = 'sst_one'
    const first = await getDirectAxBiClient()
    handshakeThen(() =>
      jsonRpcResponse('2', { structuredContent: CAPABILITIES })
    )
    await connectAxBiDirect({ token: 'sst_two' })
    const second = await getDirectAxBiClient()
    expect(second).not.toBe(first)
    expect(await getDirectAxBiClient()).toBe(second)
  })
})
