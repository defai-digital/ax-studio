import { describe, expect, it } from 'vitest'
import {
  detectModelFormatFromFiles,
  isDirectoryFormat,
  sanitizeImportFilename,
} from './model-format'

describe('detectModelFormatFromFiles', () => {
  it('detects AX Engine native artifacts via model-manifest.json', () => {
    expect(
      detectModelFormatFromFiles(['model-manifest.json', 'tokenizer.json'])
    ).toBe('ax-native')
  })

  it('prefers ax-native over mlx when both markers are present', () => {
    expect(
      detectModelFormatFromFiles([
        'model-manifest.json',
        'config.json',
        'model.safetensors',
      ])
    ).toBe('ax-native')
  })

  it('detects MLX directories via config.json', () => {
    expect(
      detectModelFormatFromFiles([
        'config.json',
        'model.safetensors',
        'tokenizer.json',
      ])
    ).toBe('mlx')
  })

  it('detects MLX via safetensors shards without config.json', () => {
    expect(
      detectModelFormatFromFiles(['model-00001-of-00002.safetensors'])
    ).toBe('mlx')
  })

  it('is case-insensitive', () => {
    expect(detectModelFormatFromFiles(['Config.JSON'])).toBe('mlx')
  })

  it('falls back to gguf otherwise', () => {
    expect(detectModelFormatFromFiles(['model.gguf'])).toBe('gguf')
    expect(detectModelFormatFromFiles([])).toBe('gguf')
  })
})

describe('isDirectoryFormat', () => {
  it('treats mlx and ax-native as directories, gguf as a file', () => {
    expect(isDirectoryFormat('mlx')).toBe(true)
    expect(isDirectoryFormat('ax-native')).toBe(true)
    expect(isDirectoryFormat('gguf')).toBe(false)
  })
})

describe('sanitizeImportFilename', () => {
  it('accepts flat file names', () => {
    expect(sanitizeImportFilename('model-00001-of-00002.safetensors')).toBe(
      'model-00001-of-00002.safetensors'
    )
    expect(sanitizeImportFilename('config.json')).toBe('config.json')
  })

  it('rejects traversal and nested paths', () => {
    expect(() => sanitizeImportFilename('../evil.bin')).toThrow()
    expect(() => sanitizeImportFilename('..')).toThrow()
    expect(() => sanitizeImportFilename('sub/dir.bin')).toThrow()
    expect(() => sanitizeImportFilename('sub\\dir.bin')).toThrow()
    expect(() => sanitizeImportFilename('/abs/path.bin')).toThrow()
    expect(() => sanitizeImportFilename('C:autorun.inf')).toThrow()
    expect(() => sanitizeImportFilename('')).toThrow()
  })
})
