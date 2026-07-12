import { afterEach, describe, expect, it, vi } from 'vitest'
import { AxBI } from '../sdk'

function jsonRpcResponse(id: string, result: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

describe('AX BI SDK shim', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the dedicated MCP port and current prompt-to-dashboard envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRpcResponse(
          '1',
          { protocolVersion: '2025-03-26' },
          { 'Mcp-Session-Id': 'session-1' }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonRpcResponse('2', {
          content: [{ type: 'text', text: 'Dashboard created' }],
          structuredContent: {
            status: 'completed',
            dashboard_url: 'http://127.0.0.1:8088/ax-bi/dashboard/8/',
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = new AxBI({
      baseUrl: 'http://127.0.0.1:8088',
      auth: { type: 'token', accessToken: '' },
    })
    await expect(
      client.ai.promptToDashboard({ prompt: 'Build a sales dashboard' })
    ).resolves.toEqual({
      status: 'completed',
      dashboard_url: 'http://127.0.0.1:8088/ax-bi/dashboard/8/',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe('http://127.0.0.1:5008/mcp')
    }
    // Streamable HTTP requires Accept on every POST, including notifications.
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.headers).toMatchObject({
        Accept: 'application/json, text/event-stream',
      })
    }
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'Mcp-Session-Id': 'session-1',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      jsonrpc: '2.0',
      id: '2',
      method: 'tools/call',
      params: {
        name: 'prompt_to_dashboard',
        arguments: {
          request: {
            prompt: 'Build a sales dashboard',
            dataset_ids: [],
            max_charts: 6,
            draft: true,
            save_charts: true,
            dry_run: false,
            min_confidence: 0.25,
            force: false,
          },
        },
      },
    })
  })

  it('parses multiline SSE tool responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRpcResponse('1', {}))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          [
            'event: message',
            'data: {"jsonrpc":"2.0",',
            'data: "id":"2","result":{"structuredContent":{"plan":{"plan_id":"p1","title":"Plan","sections":[]},"warnings":[]}}}',
            '',
          ].join('\n'),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = new AxBI({
      baseUrl: 'http://127.0.0.1:8088',
      mcpUrl: 'http://127.0.0.1:5008/mcp/',
    })

    await expect(client.ai.planDashboard({ prompt: 'Plan it' })).resolves.toEqual(
      {
        plan: { plan_id: 'p1', title: 'Plan', sections: [] },
        warnings: [],
      }
    )
  })

  it('accepts numeric JSON-RPC response ids from streamable HTTP', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              structuredContent: {
                plan: { plan_id: 'p2', title: 'Numeric', sections: [] },
                warnings: [],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = new AxBI({
      baseUrl: 'http://127.0.0.1:8088',
      mcpUrl: 'http://127.0.0.1:5008/mcp',
    })

    await expect(client.ai.planDashboard({ prompt: 'Plan' })).resolves.toEqual({
      plan: { plan_id: 'p2', title: 'Numeric', sections: [] },
      warnings: [],
    })
  })

  it('does not force MCP port 5008 on remote web bases', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRpcResponse('1', {}))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonRpcResponse('2', {
          structuredContent: {
            plan: { plan_id: 'p3', title: 'Remote', sections: [] },
            warnings: [],
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = new AxBI({
      baseUrl: 'https://bi.example.com',
    })
    await client.ai.planDashboard({ prompt: 'Plan' })

    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe('https://bi.example.com/mcp')
    }
  })

  it('throws when tools/call returns is_error (snake_case) failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRpcResponse('1', {}))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonRpcResponse('2', {
          is_error: true,
          content: [{ type: 'text', text: 'dataset not found' }],
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = new AxBI({
      baseUrl: 'http://127.0.0.1:8088',
      mcpUrl: 'http://127.0.0.1:5008/mcp',
    })

    await expect(
      client.ai.planDashboard({ prompt: 'Plan' })
    ).rejects.toThrow('dataset not found')
  })
})
