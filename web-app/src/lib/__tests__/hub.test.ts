import { describe, expect, it } from 'vitest'
import {
  buildHuggingFaceRepoUrl,
  decodeHubRouteParam,
  encodeHubRouteParam,
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
    expect(buildHuggingFaceRepoUrl('https://huggingface.co/microsoft/DialoGPT-medium/')).toBe(
      'https://huggingface.co/microsoft/DialoGPT-medium'
    )
  })
})

describe('encodeHubRouteParam', () => {
  it('round-trips with decodeHubRouteParam', () => {
    const source = 'microsoft/DialoGPT-medium'
    expect(decodeHubRouteParam(encodeHubRouteParam(source))).toBe(source)
  })
})
