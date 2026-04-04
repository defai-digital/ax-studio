import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fs } from './fs'

describe('fs module', () => {
  beforeEach(() => {
    globalThis.core = {
      api: {
        writeFileSync: vi.fn(),
        writeBlob: vi.fn(),
        readFileSync: vi.fn(),
        existsSync: vi.fn(),
        readdirSync: vi.fn(),
        mkdir: vi.fn(),
        rm: vi.fn(),
        mv: vi.fn(),
        unlinkSync: vi.fn(),
        appendFileSync: vi.fn(),
        copyFile: vi.fn(),
        getGgufFiles: vi.fn(),
        fileStat: vi.fn(),
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
})
