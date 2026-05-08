import { describe, expect, it } from 'vitest'
import {
  getCleanHuggingFaceRepoId,
  getHuggingFaceEncodedModelFileUrl,
  getHuggingFaceEncodedModelUrl,
  getHuggingFaceModelUrl,
} from '../huggingface'

describe('getHuggingFaceModelUrl', () => {
  it('preserves owner/model path separators', () => {
    expect(getHuggingFaceModelUrl('mlx-community/Qwen3.5-35B-A3B-4bit')).toBe(
      'https://huggingface.co/mlx-community/Qwen3.5-35B-A3B-4bit'
    )
  })

  it('encodes special characters inside each path segment', () => {
    expect(getHuggingFaceModelUrl('org/model name')).toBe(
      'https://huggingface.co/org/model%20name'
    )
  })
})

describe('getHuggingFaceEncodedModelUrl', () => {
  it('preserves repo path separators for browser-facing model URLs', () => {
    expect(getHuggingFaceEncodedModelUrl('microsoft/DialoGPT-medium')).toBe(
      'https://huggingface.co/microsoft/DialoGPT-medium'
    )
  })
})

describe('getCleanHuggingFaceRepoId', () => {
  it('strips prefixes and trailing slash', () => {
    expect(
      getCleanHuggingFaceRepoId('https://huggingface.co/org/model/')
    ).toBe('org/model')
  })
})

describe('getHuggingFaceEncodedModelFileUrl', () => {
  it('builds a file URL with encoded repo and filename', () => {
    expect(
      getHuggingFaceEncodedModelFileUrl('microsoft/DialoGPT-medium', 'model-Q4_0 GGUF')
    ).toBe(
      'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-Q4_0%20GGUF'
    )
  })
})
