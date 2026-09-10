// Requires a running local Ollama and qwen3:4b; no external API or credentials.
import assert from 'node:assert/strict'
import {
  startProxyServer,
  stopProxyServer,
} from '../../electron/dist/server/proxy.js'
import { registerProviderConfig } from '../../electron/dist/server/providers.js'

try {
  await registerProviderConfig({
    provider: 'ollama',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: '',
    models: ['qwen3:4b'],
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
    180
  )
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ax-Provider': 'ollama' },
    body: JSON.stringify({
      model: 'qwen3:4b',
      stream: true,
      temperature: 0,
      max_tokens: 1024,
      reasoning_effort: 'none',
      messages: [{ role: 'user', content: 'Reply with exactly OK. /no_think' }],
    }),
    signal: AbortSignal.timeout(180000),
  })
  assert.equal(response.status, 200)
  const stream = await response.text()
  assert.ok(stream.includes('data: [DONE]'))
  const chunks = stream
    .split('\n')
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice(6)))
  const content = chunks
    .map((chunk) => chunk.choices?.[0]?.delta?.content ?? '')
    .join('')
  console.log(
    JSON.stringify({
      content,
      finishReasons: chunks
        .map((chunk) => chunk.choices?.[0]?.finish_reason)
        .filter(Boolean),
    })
  )
  assert.ok(content.includes('OK'))
  const finishReason = chunks
    .map((chunk) => chunk.choices?.[0]?.finish_reason)
    .find(Boolean)
  assert.equal(finishReason, 'stop')
  console.log(
    JSON.stringify({
      success: true,
      model: 'qwen3:4b',
      content,
      finishReason,
      completeStream: true,
    })
  )
} finally {
  await stopProxyServer()
}
