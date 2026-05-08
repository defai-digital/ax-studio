import { describe, expect, it } from 'vitest'
import { getHuggingFaceModelUrl } from '../huggingface'

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
