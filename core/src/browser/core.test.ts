import { describe, it, expect, vi } from 'vitest'
import { AppEvent } from '../types/api'
import {
  baseName,
  dirName,
  getAppDataFolderPath,
  isSubdirectory,
  joinPath,
  log,
  openExternalUrl,
  openFileExplorer,
  showToast,
} from './core'

describe('test core apis', () => {
  it('should open external url', async () => {
    const url = 'http://example.com'
    globalThis.core = {
      api: {
        openExternalUrl: vi.fn().mockResolvedValue(undefined),
      },
    }
    await openExternalUrl(url)
    expect(globalThis.core.api.openExternalUrl).toHaveBeenCalledWith(url)
  })

  it('should accept https URLs', async () => {
    const url = 'https://example.com'
    globalThis.core = {
      api: {
        openExternalUrl: vi.fn().mockResolvedValue(undefined),
      },
    }
    await openExternalUrl(url)
    expect(globalThis.core.api.openExternalUrl).toHaveBeenCalledWith(url)
  })

  it('should reject unsafe protocols', () => {
    const url = 'javascript:alert("xss")'
    expect(() => openExternalUrl(url)).toThrow('Unsafe URL protocol: javascript:')
  })

  it('should reject file URLs', () => {
    const url = 'file:///etc/passwd'
    expect(() => openExternalUrl(url)).toThrow('Unsafe URL protocol: file:')
  })

  it('should reject invalid URL formats', () => {
    const url = 'not-a-url'
    expect(() => openExternalUrl(url)).toThrow('Invalid URL format: not-a-url')
  })

  it('should reject private/local network URLs', () => {
    expect(() => openExternalUrl('http://localhost/something')).toThrow('private/internal networks')
    expect(() => openExternalUrl('http://127.0.0.1/something')).toThrow('private/internal networks')
    expect(() => openExternalUrl('http://192.168.1.1/something')).toThrow(
      'private/internal networks'
    )
    expect(() => openExternalUrl('http://10.0.0.1/something')).toThrow('private/internal networks')
  })

  it('should reject IPv6 loopback, ULA, link-local, and IPv4-mapped private hosts', () => {
    // URL.hostname may keep brackets around IPv6 literals; patterns must still match.
    expect(() => openExternalUrl('http://[::1]/')).toThrow('private/internal networks')
    expect(() => openExternalUrl('http://[fc00::1]/')).toThrow('private/internal networks')
    expect(() => openExternalUrl('http://[fd12:3456:789a::1]/')).toThrow(
      'private/internal networks'
    )
    expect(() => openExternalUrl('http://[fe80::1]/')).toThrow('private/internal networks')
    expect(() => openExternalUrl('http://[::ffff:127.0.0.1]/')).toThrow(
      'private/internal networks'
    )
    expect(() => openExternalUrl('http://[::ffff:192.168.1.10]/')).toThrow(
      'private/internal networks'
    )
    expect(() => openExternalUrl('http://[::ffff:10.0.0.1]/')).toThrow(
      'private/internal networks'
    )
  })

  it('should still allow public IPv6 hosts', async () => {
    const url = 'http://[2001:4860:4860::8888]/'
    globalThis.core = {
      api: {
        openExternalUrl: vi.fn().mockResolvedValue(undefined),
      },
    }
    await openExternalUrl(url)
    expect(globalThis.core.api.openExternalUrl).toHaveBeenCalledWith(url)
  })

  it('should join paths', async () => {
    const paths = ['/path/one', '/path/two']
    globalThis.core = {
      api: {
        joinPath: vi.fn().mockResolvedValue('/path/one/path/two'),
      },
    }
    const result = await joinPath(paths)
    expect(globalThis.core.api.joinPath).toHaveBeenCalledWith({ args: paths })
    expect(result).toBe('/path/one/path/two')
  })

  it('should open file explorer', async () => {
    const path = '/path/to/open'
    globalThis.core = {
      api: {
        openFileExplorer: vi.fn().mockResolvedValue(undefined),
      },
    }
    await openFileExplorer(path)
    expect(globalThis.core.api.openFileExplorer).toHaveBeenCalledWith({ path })
  })

  it('should get app data folder path', async () => {
    globalThis.core = {
      api: {
        getAppDataFolderPath: vi.fn().mockResolvedValue('/path/to/app/data'),
      },
    }
    const result = await getAppDataFolderPath()
    expect(globalThis.core.api.getAppDataFolderPath).toHaveBeenCalled()
    expect(result).toBe('/path/to/app/data')
  })

  it('should emit toast events through the core event bridge', () => {
    const emit = vi.fn()
    globalThis.core = {
      events: {
        emit,
        on: vi.fn(),
        off: vi.fn(),
      },
    }

    showToast('Backend setup failed', 'Network down')

    expect(emit).toHaveBeenCalledWith(AppEvent.onShowToast, {
      title: 'Backend setup failed',
      message: 'Network down',
    })
  })
})

describe('dirName - just a pass thru api', () => {
  it('should retrieve the directory name from a file path', async () => {
    const mockDirName = vi.fn()
    globalThis.core = {
      api: {
        dirName: mockDirName.mockResolvedValue('/path/to'),
        baseName: vi.fn().mockResolvedValue('file.txt'),
      },
    }
    const path = '/path/to/file.txt'

    await dirName(path)
    await baseName(path)

    expect(mockDirName).toHaveBeenCalledWith({ args: [path] })
    expect(globalThis.core.api.baseName).toHaveBeenCalledWith({ args: [path] })
  })
})

describe('system bridge helpers', () => {
  it('sends isSubdirectory args as a named payload', async () => {
    const isSubdirectoryApi = vi.fn().mockResolvedValue(true)
    globalThis.core = {
      api: {
        isSubdirectory: isSubdirectoryApi,
      },
    }

    await expect(isSubdirectory('/path/to/file.txt', '/path')).resolves.toBe(true)

    expect(isSubdirectoryApi).toHaveBeenCalledWith({
      from: '/path/to/file.txt',
      to: '/path',
    })
  })

  it('sends log messages as a single bridge payload', () => {
    const logApi = vi.fn().mockResolvedValue(undefined)
    globalThis.core = {
      api: {
        log: logApi,
      },
    }

    log('started', 'extension.ts')
    log('done')

    expect(logApi).toHaveBeenNthCalledWith(1, {
      message: 'started',
      fileName: 'extension.ts',
    })
    expect(logApi).toHaveBeenNthCalledWith(2, {
      message: 'done',
    })
  })
})
