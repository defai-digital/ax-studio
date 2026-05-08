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
  it('encodes slashes for API-safe or legacy model URL usage', () => {
    expect(getHuggingFaceEncodedModelUrl('microsoft/DialoGPT-medium')).toBe(
      'https://huggingface.co/microsoft%2FDialoGPT-medium'
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
      'https://huggingface.co/microsoft%2FDialoGPT-medium/resolve/main/model-Q4_0%20GGUF'
    )
  })
})
