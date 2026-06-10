import { describe, it, expect, vi } from 'vitest'
import {
  getProviderLogo,
  getProviderTitle,
  formatMegaBytes,
  getModelDisplayName,
} from '..'

describe('getProviderLogo', () => {
  it('returns correct logo paths for known providers', () => {
    expect(getProviderLogo('anthropic')).toBe(
      '/images/model-provider/anthropic.svg'
    )
    expect(getProviderLogo('openai')).toBe('/images/model-provider/openai.svg')
    expect(getProviderLogo('gemini')).toBe('/images/model-provider/gemini.svg')
  })

  it('returns undefined for unknown providers', () => {
    expect(getProviderLogo('unknown')).toBeUndefined()
    expect(getProviderLogo('')).toBeUndefined()
  })
})

describe('getProviderTitle', () => {
  it('returns formatted titles for special providers', () => {
    expect(getProviderTitle('openai')).toBe('OpenAI')
    expect(getProviderTitle('openrouter')).toBe('OpenRouter')
    expect(getProviderTitle('gemini')).toBe('Gemini')
  })

  it('capitalizes first letter for unknown providers', () => {
    expect(getProviderTitle('anthropic')).toBe('Anthropic')
    expect(getProviderTitle('mistral')).toBe('Mistral')
    expect(getProviderTitle('test')).toBe('Test')
  })

  it('handles empty strings', () => {
    expect(getProviderTitle('')).toBe('')
  })
})

describe('formatMegaBytes', () => {
  it('formats values less than 1024 MB as GB', () => {
    expect(formatMegaBytes(512)).toBe('0.50 GB')
    expect(formatMegaBytes(1000)).toBe('0.98 GB')
    expect(formatMegaBytes(1023)).toBe('1.00 GB')
  })

  it('formats values 1024*1024 MB and above as TB', () => {
    expect(formatMegaBytes(1024 * 1024)).toBe('1.00 TB')
    expect(formatMegaBytes(1024 * 1024 * 2.5)).toBe('2.50 TB')
  })

  it('formats exactly 1024 MB as GB', () => {
    expect(formatMegaBytes(1024)).toBe('1.00 GB')
  })

  it('handles zero and small values', () => {
    expect(formatMegaBytes(0)).toBe('0.00 GB')
    expect(formatMegaBytes(1)).toBe('0.00 GB')
  })
})

describe('getModelDisplayName', () => {
  it('returns displayName when it exists', () => {
    const model = {
      id: 'llama-3.2-1b-instruct-q4_k_m.gguf',
      displayName: 'My Custom Model',
    } as Model
    expect(getModelDisplayName(model)).toBe('My Custom Model')
  })

  it('returns model.id when displayName is undefined', () => {
    const model = {
      id: 'llama-3.2-1b-instruct-q4_k_m.gguf',
    } as Model
    expect(getModelDisplayName(model)).toBe('llama-3.2-1b-instruct-q4_k_m.gguf')
  })

  it('returns model.id when displayName is empty string', () => {
    const model = {
      id: 'llama-3.2-1b-instruct-q4_k_m.gguf',
      displayName: '',
    } as Model
    expect(getModelDisplayName(model)).toBe('llama-3.2-1b-instruct-q4_k_m.gguf')
  })

  it('returns model.id when displayName is null', () => {
    const model = {
      id: 'llama-3.2-1b-instruct-q4_k_m.gguf',
      displayName: null as any,
    } as Model
    expect(getModelDisplayName(model)).toBe('llama-3.2-1b-instruct-q4_k_m.gguf')
  })

  it('handles models with complex display names', () => {
    const model = {
      id: 'very-long-model-file-name-with-lots-of-details.gguf',
      displayName: 'Short Name 🤖',
    } as Model
    expect(getModelDisplayName(model)).toBe('Short Name 🤖')
  })

  it('handles models with special characters in displayName', () => {
    const model = {
      id: 'model.gguf',
      displayName: 'Model (Version 2.0) - Fine-tuned',
    } as Model
    expect(getModelDisplayName(model)).toBe('Model (Version 2.0) - Fine-tuned')
  })
})
