import { describe, expect, it } from 'vitest'
import {
  buildHuggingFaceRepoUrl,
  decodeHubRouteParam,
  encodeHubRouteParam,
  extractModelSizeTags,
  normalizeHuggingFaceRepoId,
} from '../hub'

describe('normalizeHuggingFaceRepoId', () => {
  it('extracts org/repo from a full huggingface URL', () => {
    expect(
      normalizeHuggingFaceRepoId(
        'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-Q4_0.gguf'
      )
    ).toBe('microsoft/DialoGPT-medium')
  })

  it('handles encoded route params', () => {
    expect(normalizeHuggingFaceRepoId('microsoft%2FDialoGPT-medium')).toBe(
      'microsoft/DialoGPT-medium'
    )
  })

  it('returns undefined for invalid repo identifiers', () => {
    expect(normalizeHuggingFaceRepoId('invalid_repo_id')).toBeUndefined()
  })
})

describe('buildHuggingFaceRepoUrl', () => {
  it('builds a stable repository URL', () => {
    expect(
      buildHuggingFaceRepoUrl(
        'https://huggingface.co/microsoft/DialoGPT-medium/'
      )
    ).toBe('https://huggingface.co/microsoft/DialoGPT-medium')
  })
})

describe('encodeHubRouteParam', () => {
  it('round-trips with decodeHubRouteParam', () => {
    const source = 'microsoft/DialoGPT-medium'
    expect(decodeHubRouteParam(encodeHubRouteParam(source))).toBe(source)
  })
})

describe('extractModelSizeTags', () => {
  it('extracts sorted model size tags from complete model-id tokens', () => {
    expect(
      extractModelSizeTags([
        { model_id: 'org/model-13B-Q4_K_M' },
        { model_id: 'org/model-7b-Q8_0' },
        { model_id: 'org/model-0.5B-Q4_K_M' },
        { model_id: 'org/model-7B-Q5_K_M' },
      ])
    ).toEqual(['0.5b', '7b', '13b'])
  })

  it('ignores partial model size text that is not a complete token', () => {
    expect(
      extractModelSizeTags([
        { model_id: 'org/model-7billion-Q4_K_M' },
        { model_id: 'org/model-alpha13beta-Q4_K_M' },
        { model_id: 'org/model-0b-Q4_K_M' },
        { model_id: 'org/model-8b-Q4_K_M' },
      ])
    ).toEqual(['8b'])
  })
})
