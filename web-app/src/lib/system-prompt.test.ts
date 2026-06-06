import { describe, expect, it } from 'vitest'
import {
  buildChatPromptInjection,
  fallbackDefaultPrompt,
  getOptimizedModelConfig,
  resolveSystemPrompt,
} from '@/lib/system-prompt'

describe('resolveSystemPrompt', () => {
  it('uses thread prompt over project/global/fallback', () => {
    const result = resolveSystemPrompt(
      'Thread prompt',
      'Project prompt',
      { globalDefaultPrompt: 'Global prompt' },
      'Fallback prompt'
    )
    expect(result).toEqual({
      resolvedPrompt: 'Thread prompt',
      source: 'thread',
    })
  })

  it('uses project prompt when thread prompt is empty', () => {
    const result = resolveSystemPrompt('   ', 'Project prompt', {
      globalDefaultPrompt: 'Global prompt',
    })
    expect(result).toEqual({
      resolvedPrompt: 'Project prompt',
      source: 'project',
    })
  })

  it('uses global prompt when thread/project prompt are inherit values', () => {
    const result = resolveSystemPrompt(null, '', {
      globalDefaultPrompt: 'Global prompt',
    })
    expect(result).toEqual({
      resolvedPrompt: 'Global prompt',
      source: 'global',
    })
  })

  it('uses fallback prompt when all layers inherit', () => {
    const result = resolveSystemPrompt(undefined, ' ', {
      globalDefaultPrompt: '',
    })
    expect(result).toEqual({
      resolvedPrompt: fallbackDefaultPrompt,
      source: 'fallback',
    })
  })
})

describe('getOptimizedModelConfig', () => {
  it('changes only model parameters and keeps prompt resolution separate', () => {
    const resolved = resolveSystemPrompt('Thread prompt', null, {
      globalDefaultPrompt: 'Global prompt',
    })
    const tuned = getOptimizedModelConfig(
      { promptLength: 1500, messageCount: 20, hasAttachments: true },
      { temperature: 0.9, top_p: 0.95, max_output_tokens: 4096 }
    )

    expect(resolved.resolvedPrompt).toBe('Thread prompt')
    expect(tuned.temperature).toBe(0.4)
    expect(tuned.top_p).toBe(0.8)
    expect(tuned.max_output_tokens).toBe(4096)
  })

  it('injects resolved prompt into chat payload unchanged', () => {
    const resolved = resolveSystemPrompt('Thread prompt', 'Project prompt', {
      globalDefaultPrompt: 'Global prompt',
    })
    const injection = buildChatPromptInjection(resolved)

    expect(injection.systemMessage).toContain('Thread prompt')
  })

  it('preserves base values when no tuning trigger exists', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 20, messageCount: 2, hasAttachments: false },
      { temperature: 0.4, top_p: 0.9, max_output_tokens: 1000 }
    )

    expect(tuned).toEqual({
      temperature: 0.4,
      top_p: 0.9,
      max_output_tokens: 1000,
    })
  })

  it('sets concrete defaults for all three params with empty base config', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 50, messageCount: 0 },
      {}
    )

    expect(tuned.temperature).toBe(0.7)
    expect(tuned.top_p).toBe(0.9)
    expect(tuned.max_output_tokens).toBe(4096)
  })

  it('applies 8+ message tier', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 50, messageCount: 10 },
      {}
    )

    expect(tuned.temperature).toBe(0.5)
    expect(tuned.top_p).toBe(0.85)
    expect(tuned.max_output_tokens).toBe(4096)
  })

  it('applies 20+ message tier', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 50, messageCount: 25 },
      {}
    )

    expect(tuned.temperature).toBe(0.4)
    expect(tuned.top_p).toBe(0.8)
    expect(tuned.max_output_tokens).toBe(4096)
  })

  it('applies 800+ char prompt tier', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 1000, messageCount: 0 },
      {}
    )

    expect(tuned.temperature).toBe(0.7)
    expect(tuned.top_p).toBe(0.9)
    expect(tuned.max_output_tokens).toBe(4096)
  })

  it('applies 2000+ char prompt tier', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 2500, messageCount: 0 },
      {}
    )

    expect(tuned.max_output_tokens).toBe(6144)
  })

  it('applies attachment tier', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 50, messageCount: 0, hasAttachments: true },
      {}
    )

    expect(tuned.max_output_tokens).toBe(6144)
  })

  it('uses reasoning model settings', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 50, messageCount: 0, modelCapabilities: ['reasoning'] },
      {}
    )

    expect(tuned.temperature).toBe(0.3)
    expect(tuned.top_p).toBe(0.8)
    expect(tuned.max_output_tokens).toBe(8192)
  })

  it('reasoning model overrides conversation tier', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 50, messageCount: 25, modelCapabilities: ['reasoning'] },
      {}
    )

    expect(tuned.temperature).toBe(0.3)
    expect(tuned.top_p).toBe(0.8)
    expect(tuned.max_output_tokens).toBe(8192)
  })

  it('does not override user-set values for short chats', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 50, messageCount: 2 },
      { temperature: 0.9, top_p: 0.95, max_output_tokens: 500 }
    )

    expect(tuned.temperature).toBe(0.9)
    expect(tuned.top_p).toBe(0.95)
    expect(tuned.max_output_tokens).toBe(500)
  })

  it('clamps user-set values downward for long conversations', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 50, messageCount: 25 },
      { temperature: 0.9, top_p: 0.95, max_output_tokens: 500 }
    )

    expect(tuned.temperature).toBe(0.4)
    expect(tuned.top_p).toBe(0.8)
    // max_output_tokens not clamped since prompt is short
    expect(tuned.max_output_tokens).toBe(500)
  })

  it('never raises user-set values for non-reasoning models', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 2500, messageCount: 25 },
      { temperature: 0.2, top_p: 0.5, max_output_tokens: 800 }
    )

    expect(tuned.temperature).toBe(0.2)
    expect(tuned.top_p).toBe(0.5)
    expect(tuned.max_output_tokens).toBe(800)
  })

  it('reasoning model raises max_output_tokens when user set lower', () => {
    const tuned = getOptimizedModelConfig(
      { promptLength: 50, messageCount: 0, modelCapabilities: ['reasoning'] },
      { max_output_tokens: 500 }
    )

    expect(tuned.max_output_tokens).toBe(8192)
  })
})
