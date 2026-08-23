import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@/lib/tauri-shim/api-core'
import {
  deleteSecureSecret,
  getSecureSecret,
  hasSecureSecret,
  setSecureSecret,
} from '../secure-secret'

vi.mock('@/lib/tauri-shim/api-core', () => ({
  invoke: vi.fn(),
}))

const invokeMock = vi.mocked(invoke)

describe('secure-secret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
  })

  it('uses the native allowlisted secret commands', async () => {
    invokeMock.mockResolvedValueOnce('stored-password')
    invokeMock.mockResolvedValueOnce(true)

    await expect(getSecureSecret('proxy-password')).resolves.toBe(
      'stored-password'
    )
    await expect(hasSecureSecret('proxy-password')).resolves.toBe(true)
    await setSecureSecret('proxy-password', 'new-password')
    await deleteSecureSecret('proxy-password')

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'get_secret', {
      key: 'proxy-password',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'has_secret', {
      key: 'proxy-password',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'set_secret', {
      key: 'proxy-password',
      value: 'new-password',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'delete_secret', {
      key: 'proxy-password',
    })
  })

  it('rejects invalid values returned by the native layer', async () => {
    invokeMock.mockResolvedValue(42)

    await expect(getSecureSecret('proxy-password')).rejects.toThrow(
      'invalid value'
    )
  })

  it('does not persist secrets in a regular browser', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')

    await expect(getSecureSecret('proxy-password')).resolves.toBeNull()
    await expect(hasSecureSecret('proxy-password')).resolves.toBe(false)
    await setSecureSecret('proxy-password', 'memory-only')
    await deleteSecureSecret('proxy-password')

    expect(invokeMock).not.toHaveBeenCalled()
  })
})
