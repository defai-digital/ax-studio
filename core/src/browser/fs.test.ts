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
        unlinkSync: vi.fn(),
        appendFileSync: vi.fn(),
        copyFile: vi.fn(),
        getGgufFiles: vi.fn(),
        fileStat: vi.fn(),
      },
    }
  })

  it('should call writeFileSync with correct arguments', () => {
    const args = ['path/to/file', 'data']
    fs.writeFileSync(...args)
    expect(globalThis.core.api.writeFileSync).toHaveBeenCalledWith({ args })
  })

  it('should call writeBlob with correct arguments', async () => {
    const path = 'path/to/file'
    const data = 'blob data'
    await fs.writeBlob(path, data)
    expect(globalThis.core.api.writeBlob).toHaveBeenCalledWith(path, data)
  })

  it('should call readFileSync with correct arguments', () => {
    const args = ['path/to/file']
    fs.readFileSync(...args)
    expect(globalThis.core.api.readFileSync).toHaveBeenCalledWith({ args })
  })

  it('should call existsSync with correct arguments', () => {
    const args = ['path/to/file']
    fs.existsSync(...args)
    expect(globalThis.core.api.existsSync).toHaveBeenCalledWith({ args })
  })

  it('should call readdirSync with correct arguments', () => {
    const args = ['path/to/directory']
    fs.readdirSync(...args)
    expect(globalThis.core.api.readdirSync).toHaveBeenCalledWith({ args })
  })

  it('should call mkdir with correct arguments', () => {
    const args = ['path/to/directory']
    fs.mkdir(...args)
    expect(globalThis.core.api.mkdir).toHaveBeenCalledWith({ args })
  })

  it('should call rm with correct arguments', () => {
    const args = ['path/to/directory']
    fs.rm(...args)
    expect(globalThis.core.api.rm).toHaveBeenCalledWith({ args })
  })

  it('should call unlinkSync with correct arguments', () => {
    const args = ['path/to/file']
    fs.unlinkSync(...args)
    expect(globalThis.core.api.unlinkSync).toHaveBeenCalledWith(...args)
  })

  it('should call appendFileSync with correct arguments', () => {
    const args = ['path/to/file', 'data']
    fs.appendFileSync(...args)
    expect(globalThis.core.api.appendFileSync).toHaveBeenCalledWith(...args)
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
