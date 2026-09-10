import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import {
  startProxyServer,
  stopProxyServer,
} from '../../electron/src/server/proxy.ts'
import {
  registerProviderConfig,
  unregisterProviderConfig,
} from '../../electron/src/server/providers.ts'

let upstream
const timers = new Set()
afterEach(async () => {
  for (const timer of timers) clearTimeout(timer)
  timers.clear()
  await stopProxyServer()
  unregisterProviderConfig('ollama')
  if (upstream) {
    upstream.closeAllConnections()
    await new Promise((r) => upstream.close(r))
    upstream = undefined
  }
})
async function start(handler, timeout = 60) {
  upstream = http.createServer(handler)
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  await registerProviderConfig({
    provider: 'ollama',
    base_url: `http://127.0.0.1:${upstream.address().port}/v1`,
    api_key: '',
    models: ['fixture'],
  })
  const port = await startProxyServer(
    '127.0.0.1',
    0,
    {
      host: '127.0.0.1',
      prefix: '/v1',
      proxyApiKey: '',
      corsEnabled: false,
      trustedHosts: [['localhost', '127.0.0.1']],
      verboseLogs: false,
    },
    timeout
  )
  return () =>
    fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ax-Provider': 'ollama',
      },
      body: JSON.stringify({
        model: 'fixture',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })
}
describe('proxy response semantics', () => {
  it('preserves reasoning and final content as separate SSE fields', async () => {
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n'
    const request = await start((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(sse)
    })
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(sse)
  })
  it('honors a configured deadline greater than 30 seconds', async () => {
    const request = await start((_req, res) => {
      timers.add(
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"ok":true}')
        }, 31_000)
      )
    }, 40)
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  }, 45_000)
  it('reports an expired response deadline as gateway timeout', async () => {
    const request = await start(() => {}, 1)
    const response = await request()
    expect(response.status).toBe(504)
    expect(await response.text()).toContain('Timed out')
  })
})
