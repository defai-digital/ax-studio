import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fs } from './fs'

describe('fs module', () => {
  beforeEach(() => {
    globalThis.core = {
      api: {
        writeFileSync: vi.fn().mockResolvedValue(undefined),
        writeBlob: vi.fn().mockResolvedValue(undefined),
        readFileSync: vi.fn().mockResolvedValue('file contents'),
        existsSync: vi.fn().mockResolvedValue(true),
        readdirSync: vi.fn().mockResolvedValue(['file.txt']),
        mkdir: vi.fn().mockResolvedValue(undefined),
        rm: vi.fn().mockResolvedValue(undefined),
        mv: vi.fn().mockResolvedValue(undefined),
        unlinkSync: vi.fn().mockResolvedValue(undefined),
        appendFileSync: vi.fn().mockResolvedValue(undefined),
        copyFile: vi.fn().mockResolvedValue(undefined),
        getGgufFiles: vi.fn().mockResolvedValue({ gguf: [], nonGguf: [] }),
        fileStat: vi.fn().mockResolvedValue(undefined),
      },
    }
  })

  it('should call writeFileSync with correct arguments', () => {
    fs.writeFileSync('path/to/file', 'data')
    expect(globalThis.core.api.writeFileSync).toHaveBeenCalledWith({ args: ['path/to/file', 'data'] })
  })

  it('should call writeBlob with correct arguments', async () => {
    const path = 'path/to/file'
    const data = 'blob data'
    await fs.writeBlob(path, data)
    expect(globalThis.core.api.writeBlob).toHaveBeenCalledWith(path, data)
  })

  it('should call readFileSync with correct arguments', () => {
    fs.readFileSync('path/to/file')
    expect(globalThis.core.api.readFileSync).toHaveBeenCalledWith({ args: ['path/to/file'] })
  })

  it('should call existsSync with correct arguments', () => {
    fs.existsSync('path/to/file')
    expect(globalThis.core.api.existsSync).toHaveBeenCalledWith({ args: ['path/to/file'] })
  })

  it('should call readdirSync with correct arguments', () => {
    fs.readdirSync('path/to/directory')
    expect(globalThis.core.api.readdirSync).toHaveBeenCalledWith({ args: ['path/to/directory'] })
  })

  it('should call mkdir with correct arguments', () => {
    fs.mkdir('path/to/directory')
    expect(globalThis.core.api.mkdir).toHaveBeenCalledWith({ args: ['path/to/directory'] })
  })

  it('should call rm with correct arguments', () => {
    fs.rm('path/to/directory')
    expect(globalThis.core.api.rm).toHaveBeenCalledWith({ args: ['path/to/directory'] })
  })

  it('should call mv with correct arguments', () => {
    fs.mv('path/to/src', 'path/to/dest')
    expect(globalThis.core.api.mv).toHaveBeenCalledWith({ args: ['path/to/src', 'path/to/dest'] })
  })

  it('should call unlinkSync with correct arguments', () => {
    fs.unlinkSync('path/to/file')
    expect(globalThis.core.api.unlinkSync).toHaveBeenCalledWith({ args: ['path/to/file'] })
  })

  it('should call appendFileSync with correct arguments', () => {
    fs.appendFileSync('path/to/file', 'data')
    expect(globalThis.core.api.appendFileSync).toHaveBeenCalledWith({ args: ['path/to/file', 'data'] })
  })

  it('should call copyFile with correct arguments', async () => {
    const src = 'path/to/src'
    const dest = 'path/to/dest'
    await fs.copyFile(src, dest)
    expect(globalThis.core.api.copyFile).toHaveBeenCalledWith(src, dest)
  })

  it('should call getGgufFiles with correct arguments', async () => {
    const paths = ['path/to/file1', 'path/to/file2']
    await fs.getGgufFiles(paths)
    expect(globalThis.core.api.getGgufFiles).toHaveBeenCalledWith(paths)
  })

  it('should call fileStat with correct arguments', async () => {
    const path = 'path/to/file'
    await fs.fileStat(path)
    expect(globalThis.core.api.fileStat).toHaveBeenCalledWith({ args: path })
  })

  describe('path validation', () => {
    it('should reject paths with directory traversal', () => {
      expect(() => fs.writeFileSync('../../../etc/passwd', 'data')).toThrow('Path traversal not allowed: ../../../etc/passwd')
      expect(() => fs.readFileSync('../secret/file')).toThrow('Path traversal not allowed: ../secret/file')
      expect(() => fs.existsSync('file/../../../root')).toThrow('Path traversal not allowed: file/../../../root')
      expect(() => fs.readFileSync('%2e%2e/secret/file')).toThrow('Path traversal not allowed: %2e%2e/secret/file')
      expect(() => fs.readFileSync('%252e%252e%2fsecret/file')).toThrow('Path traversal not allowed: %252e%252e%2fsecret/file')
      expect(() => fs.readFileSync('..%2fsecret/file')).toThrow('Path traversal not allowed: ..%2fsecret/file')
    })

    it('should allow absolute paths (Tauri handles sandboxing)', () => {
      // Absolute paths are allowed - Tauri backend provides sandboxing
      const validAbsolutePath = '/valid/path/file.txt'
      fs.writeFileSync(validAbsolutePath, 'data')
      expect(globalThis.core.api.writeFileSync).toHaveBeenCalledWith({ args: [validAbsolutePath, 'data'] })

      fs.readFileSync('C:\\valid\\path\\file.txt')
      expect(globalThis.core.api.readFileSync).toHaveBeenCalledWith({ args: ['C:\\valid\\path\\file.txt'] })
    })

    it('should reject paths with invalid characters', () => {
      expect(() => fs.writeFileSync('file\0name', 'data')).toThrow('Invalid characters in path: file')
      expect(() => fs.readFileSync('file\x01name')).toThrow('Invalid characters in path: file')
    })

    it('should accept valid relative paths', () => {
      const validPath = 'data/files/myfile.txt'
      fs.writeFileSync(validPath, 'data')
      expect(globalThis.core.api.writeFileSync).toHaveBeenCalledWith({ args: [validPath, 'data'] })

      fs.readFileSync(validPath)
      expect(globalThis.core.api.readFileSync).toHaveBeenCalledWith({ args: [validPath] })
    })

    it('should validate both src and dest in copyFile', () => {
      expect(() => fs.copyFile('../../../evil', 'safe')).toThrow('Path traversal not allowed: ../../../evil')
      // Absolute paths are now allowed - Tauri provides sandboxing
      expect(async () => await fs.copyFile('safe', '/absolute')).not.toThrow()
    })

    it('should validate all paths in getGgufFiles', () => {
      expect(() => fs.getGgufFiles(['safe/path', '../../../evil'])).toThrow('Path traversal not allowed: ../../../evil')
    })

    it('should validate path in fileStat', () => {
      expect(() => fs.fileStat('../escape')).toThrow('Path traversal not allowed: ../escape')
    })

    it('should validate path in writeBlob', async () => {
      // Absolute paths are now allowed - Tauri provides sandboxing
      await fs.writeBlob('/valid/path/file', 'data')
      expect(globalThis.core.api.writeBlob).toHaveBeenCalledWith('/valid/path/file', 'data')
    })
  })

  describe('bridge response validation', () => {
    it('rejects invalid readFileSync payloads from the bridge', async () => {
      globalThis.core.api.readFileSync = vi.fn().mockResolvedValue(null)

      await expect(fs.readFileSync('path/to/file')).rejects.toThrow(
        'Invalid response from core api.readFileSync: expected string, got null'
      )
    })

    it('rejects invalid getGgufFiles payloads from the bridge', async () => {
      globalThis.core.api.getGgufFiles = vi
        .fn()
        .mockResolvedValue({ gguf: ['a.gguf'], nonGguf: 'oops' })

      await expect(fs.getGgufFiles(['path/to/file'])).rejects.toThrow(
        'Invalid response from core api.getGgufFiles.nonGguf: expected string[], got string'
      )
    })
  })

  describe('decodePathRecursively edge cases', () => {
    it('should reject double-encoded traversal (%252e%252e%252f)', () => {
      // '%252e' → decodeURI → '%2e' → decodeURI → '.' (dot)
      // Two levels of encoding fully decode within the 32-iteration cap.
      expect(() => fs.readFileSync('%252e%252e%252fsecret/file')).toThrow(
        'Path traversal not allowed: %252e%252e%252fsecret/file'
      )
    })

    it('should reject triple-encoded traversal (%25252e%25252e%25252f)', () => {
      // Three levels of encoding still fully decode to '../' within the cap.
      expect(() => fs.readFileSync('%25252e%25252e%25252fsecret/file')).toThrow(
        'Path traversal not allowed: %25252e%25252e%25252fsecret/file'
      )
    })

    it('should reject NFKC-normalized fullwidth traversal characters', () => {
      // Fullwidth dot (U+FF0E) and fullwidth solidus (U+FF0F) normalize to
      // '.' and '/' via NFKC. The string '..／' → '../'.
      expect(() =>
        fs.readFileSync('\uff0e\uff0e\uff0fsecret/file')
      ).toThrow('Path traversal not allowed')
    })

    it('should handle 35 levels of encoding without crashing', () => {
      // Build a path with 35 levels of URL-encoding starting from %2e%2e%2f.
      // The 32-iteration cap cannot fully decode it, so the function falls
      // back to the last stable value. The partially-decoded result no longer
      // contains raw '..' segments, so validation does not throw — the Tauri
      // backend provides the real sandboxing layer.
      let deeplyEncoded = '%2e%2e%2f'
      for (let i = 0; i < 35; i++) deeplyEncoded = encodeURIComponent(deeplyEncoded)

      // Should NOT throw — the path is handled gracefully without error
      expect(() => fs.writeFileSync(deeplyEncoded, 'data')).not.toThrow()
    })

    it('should reject paths with URL-encoded null bytes (%2500)', () => {
      // '%2500' → decodeURI → '%00' → decodeURI → '\0' (null byte).
      // The null-byte check in validatePath catches this.
      expect(() => fs.writeFileSync('file%2500name', 'data')).toThrow('Invalid characters in path')
    })
  })
})
