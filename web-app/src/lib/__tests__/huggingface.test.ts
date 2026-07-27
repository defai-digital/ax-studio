import { describe, expect, it } from 'vitest'
import {
  getCleanHuggingFaceRepoId,
  getHuggingFaceApiAuthorModelsUrl,
  getHuggingFaceApiModelUrl,
  getHuggingFaceModelFileUrl,
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

describe('getCleanHuggingFaceRepoId', () => {
  it('strips prefixes and trailing slash', () => {
    expect(getCleanHuggingFaceRepoId('https://huggingface.co/org/model/')).toBe(
      'org/model'
    )
  })
})

describe('getHuggingFaceApiModelUrl', () => {
  it('preserves owner/model separators for the Hugging Face API route', () => {
    expect(getHuggingFaceApiModelUrl('mlx-community/Qwen3.5-9B-4bit')).toBe(
      'https://huggingface.co/api/models/mlx-community/Qwen3.5-9B-4bit?blobs=true&files_metadata=true'
    )
  })
})

describe('getHuggingFaceApiAuthorModelsUrl', () => {
  it('builds a bounded full-catalog query for an organization', () => {
    expect(getHuggingFaceApiAuthorModelsUrl(' AutomatosX ')).toBe(
      'https://huggingface.co/api/models?author=AutomatosX&limit=100&full=true'
    )
  })
})

describe('getHuggingFaceModelFileUrl', () => {
  it('preserves nested file path separators', () => {
    expect(
      getHuggingFaceModelFileUrl('org/model', 'tokenizer/tokenizer.json')
    ).toBe(
      'https://huggingface.co/org/model/resolve/main/tokenizer/tokenizer.json'
    )
  })

  it('resolves parent-directory segments so paths cannot escape /resolve/main/', () => {
    expect(getHuggingFaceModelFileUrl('org/model', '../../evil.bin')).toBe(
      'https://huggingface.co/org/model/resolve/main/evil.bin'
    )
    expect(
      getHuggingFaceModelFileUrl('org/model', 'folder/../weights.gguf')
    ).toBe('https://huggingface.co/org/model/resolve/main/weights.gguf')
  })
})
