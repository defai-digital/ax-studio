import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isTauri: false,
  invoke: vi.fn(),
  open: vi.fn(),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => mocks.isTauri,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({ invoke: mocks.invoke }),
  }),
}))

import { APIs, openExternalUrl } from '../service'

describe('legacy API bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isTauri = false
    vi.stubGlobal('open', mocks.open)
  })

  it('opens external URLs in a new browser tab', () => {
    openExternalUrl('https://example.com')

    expect(mocks.open).toHaveBeenCalledWith('https://example.com', '_blank')
  })

  it('returns null for bridged API calls on web', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(APIs.getTools({ provider: 'mcp' })).resolves.toBeNull()

    expect(warn).toHaveBeenCalledWith(
      "API call 'getTools' not supported in web environment",
      { provider: 'mcp' },
    )
  })

  it('invokes Tauri commands using snake_case route names', async () => {
    mocks.isTauri = true
    mocks.invoke.mockResolvedValueOnce(['tool'])

    await expect(APIs.getTools({ provider: 'mcp' })).resolves.toEqual(['tool'])

    expect(mocks.invoke).toHaveBeenCalledWith('get_tools', { provider: 'mcp' })
  })

  it('wraps legacy startServer args into the new config shape', async () => {
    mocks.isTauri = true
    const args = {
      host: '127.0.0.1',
      port: 1337,
      prefix: '/v1',
      apiKey: 'secret',
      trustedHosts: ['localhost'],
      isCorsEnabled: true,
      proxyTimeout: 30,
    }

    await APIs.startServer(args)

    expect(mocks.invoke).toHaveBeenCalledWith('start_server', {
      config: {
        host: '127.0.0.1',
        port: 1337,
        prefix: '/v1',
        api_key: 'secret',
        trusted_hosts: ['localhost'],
        cors_enabled: true,
        proxy_timeout: 30,
      },
    })
  })

  it('passes through startServer args that already contain config', async () => {
    mocks.isTauri = true
    const args = { config: { host: '0.0.0.0', port: 8080 } }

    await APIs.startServer(args)

    expect(mocks.invoke).toHaveBeenCalledWith('start_server', args)
  })

  it('wraps filesystem request commands unless already wrapped', async () => {
    mocks.isTauri = true

    await APIs.appendFileSync({ path: '/tmp/file.txt', content: 'hello' })
    await APIs.appendFileSync({
      request: { path: '/tmp/file.txt', content: 'hello' },
    })

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'append_file_sync', {
      request: { path: '/tmp/file.txt', content: 'hello' },
    })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'append_file_sync', {
      request: { path: '/tmp/file.txt', content: 'hello' },
    })
  })
})
