import { describe, it, expect, vi } from 'vitest'
import {
  baseName,
  dirName,
  getAppDataFolderPath,
  joinPath,
  openExternalUrl,
  openFileExplorer,
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
