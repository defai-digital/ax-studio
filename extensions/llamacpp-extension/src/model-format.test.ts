import { describe, expect, it } from 'vitest'
import {
  detectModelFormatFromFiles,
  isDirectoryFormat,
  axServingBackendHint,
  buildAxServingLoadBody,
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

describe('axServingBackendHint', () => {
  it('maps formats to ax-serving backend hints', () => {
    expect(axServingBackendHint('mlx')).toBe('mlx')
    expect(axServingBackendHint('ax-native')).toBe('native')
    expect(axServingBackendHint('gguf')).toBeUndefined()
  })
})

describe('buildAxServingLoadBody', () => {
  it('builds a gguf body with llama.cpp options and no backend hint', () => {
    expect(
      buildAxServingLoadBody({
        modelId: 'm1',
        modelPath: '/models/m1/model.gguf',
        format: 'gguf',
        mmprojPath: '/models/m1/mmproj.gguf',
        nGpuLayers: 50,
        ctxSize: 8192,
      })
    ).toEqual({
      model_id: 'm1',
      path: '/models/m1/model.gguf',
      mmproj_path: '/models/m1/mmproj.gguf',
      n_gpu_layers: 50,
      context_length: 8192,
    })
  })

  it('omits n_gpu_layers when negative or the 100 default', () => {
    const base = {
      modelId: 'm1',
      modelPath: '/p',
      format: 'gguf' as const,
    }
    expect(
      buildAxServingLoadBody({ ...base, nGpuLayers: -1 })
    ).not.toHaveProperty('n_gpu_layers')
    expect(
      buildAxServingLoadBody({ ...base, nGpuLayers: 100 })
    ).not.toHaveProperty('n_gpu_layers')
    expect(
      buildAxServingLoadBody({ ...base, nGpuLayers: NaN })
    ).not.toHaveProperty('n_gpu_layers')
  })

  it('sends the mlx backend hint and drops llama.cpp-only options', () => {
    expect(
      buildAxServingLoadBody({
        modelId: 'mlx-model',
        modelPath: '/models/mlx-model/model',
        format: 'mlx',
        mmprojPath: '/models/mlx-model/mmproj.gguf',
        nGpuLayers: 50,
        ctxSize: 4096,
      })
    ).toEqual({
      model_id: 'mlx-model',
      path: '/models/mlx-model/model',
      backend: 'mlx',
      context_length: 4096,
    })
  })

  it('sends the native backend hint for AX Engine artifacts', () => {
    expect(
      buildAxServingLoadBody({
        modelId: 'ax-model',
        modelPath: '/models/ax-model/model',
        format: 'ax-native',
      })
    ).toEqual({
      model_id: 'ax-model',
      path: '/models/ax-model/model',
      backend: 'native',
    })
  })

  it('omits context_length when zero or unset', () => {
    expect(
      buildAxServingLoadBody({
        modelId: 'm1',
        modelPath: '/p',
        format: 'mlx',
        ctxSize: 0,
      })
    ).not.toHaveProperty('context_length')
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
