import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteSecureSecret: vi.fn(),
  getSecureSecret: vi.fn(),
  invoke: vi.fn(),
  setSecureSecret: vi.fn(),
}))

vi.mock('@/lib/storage/secure-secret', () => ({
  AX_ENGINE_ATTACH_API_KEY_SECRET: 'ax-engine-attach-api-key',
  deleteSecureSecret: mocks.deleteSecureSecret,
  getSecureSecret: mocks.getSecureSecret,
  setSecureSecret: mocks.setSecureSecret,
}))

vi.mock('@/lib/tauri-shim/api-core', () => ({
  invoke: mocks.invoke,
}))

import {
  AX_ENGINE_ATTACH_API_KEY_SECRET,
  axEngineEndpointsMayAlias,
  clearAxEngineAttachApiKey,
  getAxEngineConnectionMode,
  normalizeAxEngineAttachBaseURL,
  probeAxEngineConnection,
  readAxEngineAttachApiKey,
  storeAxEngineAttachApiKey,
} from '../connection'

describe('AX Engine connection helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults legacy provider state to managed mode', () => {
    expect(getAxEngineConnectionMode()).toBe('managed')
    expect(getAxEngineConnectionMode({ connection_mode: 'managed' })).toBe(
      'managed'
    )
    expect(getAxEngineConnectionMode({ connection_mode: 'attach' })).toBe(
      'attach'
    )
  })

  it('normalizes loopback endpoints to the OpenAI-compatible /v1 base', () => {
    expect(normalizeAxEngineAttachBaseURL('127.0.0.2:31418')).toBe(
      'http://127.0.0.2:31418/v1'
    )
    expect(normalizeAxEngineAttachBaseURL('https://localhost:31418/v1/')).toBe(
      'https://localhost:31418/v1'
    )
    expect(normalizeAxEngineAttachBaseURL('http://[::1]:31418')).toBe(
      'http://[::1]:31418/v1'
    )
  })

  it('detects common loopback aliases for a managed listener', () => {
    expect(
      axEngineEndpointsMayAlias(
        'http://127.0.0.1:31418/v1',
        'http://localhost:31418'
      )
    ).toBe(true)
    expect(
      axEngineEndpointsMayAlias(
        'http://127.0.0.2:31418/v1',
        'http://localhost:31418/v1'
      )
    ).toBe(false)
  })

  it.each([
    'https://engine.example.com',
    'http://0.0.0.0:31418',
    'file:///tmp/engine.sock',
    'http://user:secret@localhost:31418',
    'http://localhost:31418?token=secret',
    'http://localhost:31418/#fragment',
  ])('rejects unsafe attach endpoint %s', (endpoint) => {
    expect(() => normalizeAxEngineAttachBaseURL(endpoint)).toThrow()
  })

  it('rejects an oversized endpoint before IPC', async () => {
    await expect(
      probeAxEngineConnection({
        baseURL: `http://localhost/${'x'.repeat(2_049)}`,
      })
    ).rejects.toThrow(/too long/i)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('uses the saved secure key when probing an attached server', async () => {
    mocks.getSecureSecret.mockResolvedValue(' saved-secret ')
    mocks.invoke.mockResolvedValue({
      baseURL: 'http://127.0.0.1:32000/v1',
      models: ['qwen'],
      toolcall: true,
    })

    await expect(
      probeAxEngineConnection({ baseURL: '127.0.0.1:32000' })
    ).resolves.toEqual({
      baseURL: 'http://127.0.0.1:32000/v1',
      models: ['qwen'],
      toolcall: true,
    })
    expect(mocks.invoke).toHaveBeenCalledWith('ax_engine_probe', {
      baseURL: 'http://127.0.0.1:32000/v1',
      apiKey: 'saved-secret',
    })
  })

  it('keeps the attach credential in secure storage', async () => {
    mocks.getSecureSecret.mockResolvedValue(' stored-key ')

    await expect(readAxEngineAttachApiKey()).resolves.toBe('stored-key')
    await expect(storeAxEngineAttachApiKey(' new-key ')).resolves.toBe(
      'new-key'
    )
    await clearAxEngineAttachApiKey()

    expect(AX_ENGINE_ATTACH_API_KEY_SECRET).toBe('ax-engine-attach-api-key')
    expect(mocks.setSecureSecret).toHaveBeenCalledWith(
      'ax-engine-attach-api-key',
      'new-key'
    )
    expect(mocks.deleteSecureSecret).toHaveBeenCalledWith(
      'ax-engine-attach-api-key'
    )
  })

  it('rejects malformed or oversized credentials before secure storage', async () => {
    await expect(storeAxEngineAttachApiKey('bad\0key')).rejects.toThrow(
      /invalid or too large/i
    )
    await expect(storeAxEngineAttachApiKey('x'.repeat(16_385))).rejects.toThrow(
      /invalid or too large/i
    )
    expect(mocks.setSecureSecret).not.toHaveBeenCalled()
  })
})
