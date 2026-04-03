import { describe, it, expect } from 'vitest'
import { groupModelsByPrefix, formatPrefixName } from '../model-group-utils'

describe('formatPrefixName', () => {
  it('formats hyphenated prefixes into title case', () => {
    expect(formatPrefixName('workers-ai')).toBe('Workers AI')
    expect(formatPrefixName('google-vertex-ai')).toBe('Google Vertex AI')
    expect(formatPrefixName('azure-openai')).toBe('Azure Openai')
  })

  it('keeps known abbreviations uppercase', () => {
    expect(formatPrefixName('workers-ai')).toBe('Workers AI')
    expect(formatPrefixName('some-api')).toBe('Some API')
    expect(formatPrefixName('custom-ml')).toBe('Custom ML')
  })

  it('returns "Other" for empty prefix', () => {
    expect(formatPrefixName('')).toBe('Other')
  })

  it('handles single-word prefixes', () => {
    expect(formatPrefixName('openrouter')).toBe('Openrouter')
  })
})

describe('groupModelsByPrefix', () => {
  it('groups models by their first path segment', () => {
    const models = [
      'workers-ai/@cf/qwen/qwen3-30b',
      'workers-ai/@cf/meta/llama-4-scout',
      'openrouter/qwen/qwen3.5-flash',
      'openrouter/google/gemini-3.1-flash',
      'google-ai-studio/gemini-pro',
    ]

    const groups = groupModelsByPrefix(models)
    expect(groups).toHaveLength(3)

    const workersGroup = groups.find((g) => g.prefix === 'workers-ai')
    expect(workersGroup?.modelIds).toEqual([
      'workers-ai/@cf/qwen/qwen3-30b',
      'workers-ai/@cf/meta/llama-4-scout',
    ])
    expect(workersGroup?.displayName).toBe('Workers AI')

    const openrouterGroup = groups.find((g) => g.prefix === 'openrouter')
    expect(openrouterGroup?.modelIds).toEqual([
      'openrouter/qwen/qwen3.5-flash',
      'openrouter/google/gemini-3.1-flash',
    ])
  })

  it('groups models without slashes under empty prefix', () => {
    const models = ['gpt-4o', 'claude-3-sonnet', 'gemini-pro']
    const groups = groupModelsByPrefix(models)

    expect(groups).toHaveLength(1)
    expect(groups[0].prefix).toBe('')
    expect(groups[0].displayName).toBe('Other')
    expect(groups[0].modelIds).toEqual(models)
  })

  it('handles mixed prefixed and non-prefixed models', () => {
    const models = ['gpt-4o', 'openrouter/deepseek-r1', 'claude-3']
    const groups = groupModelsByPrefix(models)

    expect(groups).toHaveLength(2)
    const noPrefixGroup = groups.find((g) => g.prefix === '')
    expect(noPrefixGroup?.modelIds).toEqual(['gpt-4o', 'claude-3'])
  })

  it('returns empty array for empty input', () => {
    expect(groupModelsByPrefix([])).toEqual([])
  })

  it('sorts groups by size (largest first)', () => {
    const models = [
      'a/model-1',
      'b/model-2',
      'b/model-3',
      'b/model-4',
      'a/model-5',
      'c/model-6',
    ]
    const groups = groupModelsByPrefix(models)

    expect(groups[0].prefix).toBe('b') // 3 models
    expect(groups[1].prefix).toBe('a') // 2 models
    expect(groups[2].prefix).toBe('c') // 1 model
  })
})
