import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useThreadConfig } from '../use-thread-config'

// Mock system-prompt to isolate the hook logic
vi.mock('@/lib/system-prompt', () => ({
  resolveSystemPrompt: vi.fn(
    (threadPrompt: unknown, projectPrompt: unknown, settings: { globalDefaultPrompt: string }) => {
      if (typeof threadPrompt === 'string' && threadPrompt.trim()) {
        return { resolvedPrompt: threadPrompt, source: 'thread' }
      }
      if (typeof projectPrompt === 'string' && projectPrompt.trim()) {
        return { resolvedPrompt: projectPrompt, source: 'project' }
      }
      if (settings.globalDefaultPrompt.trim()) {
        return { resolvedPrompt: settings.globalDefaultPrompt, source: 'global' }
      }
      return { resolvedPrompt: 'You are a helpful assistant.', source: 'fallback' }
    }
  ),
  getOptimizedModelConfig: vi.fn(
    (_context: unknown, baseConfig: Record<string, unknown>) => ({
      ...baseConfig,
      temperature: 0.5,
      top_p: 0.85,
    })
  ),
}))

const makeThread = (overrides: Record<string, unknown> = {}): Thread =>
  ({
    id: 'thread-1',
    title: 'Test',
    updated: Date.now() / 1000,
    assistants: [
      {
        id: 'a1',
        name: 'Test',
        parameters: { temperature: 0.7, top_p: 0.9, max_output_tokens: 4096 },
      },
    ],
    metadata: {},
    ...overrides,
  }) as unknown as Thread

const makeModel = (overrides: Record<string, unknown> = {}): Model =>
  ({
    id: 'model-1',
    capabilities: [],
    ...overrides,
  }) as unknown as Model

describe('useThreadConfig', () => {
  describe('promptResolution', () => {
    it('resolves to thread prompt when present', () => {
      const { result } = renderHook(() =>
        useThreadConfig({
          thread: makeThread({
            metadata: { threadPrompt: 'Custom thread prompt' },
          }),
          selectedModel: makeModel(),
          globalDefaultPrompt: 'global',
          autoTuningEnabled: false,
          threadMessageCount: 0,
        })
      )

      expect(result.current.promptResolution.resolvedPrompt).toBe('Custom thread prompt')
      expect(result.current.promptResolution.source).toBe('thread')
    })

    it('falls back to project prompt when thread prompt is absent', () => {
      const { result } = renderHook(() =>
        useThreadConfig({
          thread: makeThread({
            metadata: { project: { projectPrompt: 'Project prompt' } },
          }),
          selectedModel: makeModel(),
          globalDefaultPrompt: '',
          autoTuningEnabled: false,
          threadMessageCount: 0,
        })
      )

      expect(result.current.promptResolution.resolvedPrompt).toBe('Project prompt')
      expect(result.current.promptResolution.source).toBe('project')
    })

    it('falls back to global default prompt', () => {
      const { result } = renderHook(() =>
        useThreadConfig({
          thread: makeThread(),
          selectedModel: makeModel(),
          globalDefaultPrompt: 'Global prompt',
          autoTuningEnabled: false,
          threadMessageCount: 0,
        })
      )

      expect(result.current.promptResolution.resolvedPrompt).toBe('Global prompt')
      expect(result.current.promptResolution.source).toBe('global')
    })

    it('falls back to fallback prompt when nothing is set', () => {
      const { result } = renderHook(() =>
        useThreadConfig({
          thread: undefined,
          selectedModel: undefined,
          globalDefaultPrompt: '',
          autoTuningEnabled: false,
          threadMessageCount: 0,
        })
      )

      expect(result.current.promptResolution.resolvedPrompt).toBe(
        'You are a helpful assistant.'
      )
      expect(result.current.promptResolution.source).toBe('fallback')
    })
  })

  describe('optimizedModelConfig', () => {
    it('returns base config when autoTuning is disabled', () => {
      const { result } = renderHook(() =>
        useThreadConfig({
          thread: makeThread(),
          selectedModel: makeModel(),
          globalDefaultPrompt: 'prompt',
          autoTuningEnabled: false,
          threadMessageCount: 5,
        })
      )

      expect(result.current.optimizedModelConfig.temperature).toBe(0.7)
      expect(result.current.optimizedModelConfig.top_p).toBe(0.9)
      expect(result.current.optimizedModelConfig.max_output_tokens).toBe(4096)
      expect(result.current.optimizedModelConfig.modelId).toBe('model-1')
    })

    it('applies optimization when autoTuning is enabled', () => {
      const { result } = renderHook(() =>
        useThreadConfig({
          thread: makeThread(),
          selectedModel: makeModel(),
          globalDefaultPrompt: 'prompt',
          autoTuningEnabled: true,
          threadMessageCount: 10,
        })
      )

      // getOptimizedModelConfig mock returns temperature: 0.5, top_p: 0.85
      expect(result.current.optimizedModelConfig.temperature).toBe(0.5)
      expect(result.current.optimizedModelConfig.top_p).toBe(0.85)
    })

    it('handles undefined thread gracefully', () => {
      const { result } = renderHook(() =>
        useThreadConfig({
          thread: undefined,
          selectedModel: undefined,
          globalDefaultPrompt: '',
          autoTuningEnabled: false,
          threadMessageCount: 0,
        })
      )

      expect(result.current.optimizedModelConfig.temperature).toBeUndefined()
      expect(result.current.optimizedModelConfig.modelId).toBeUndefined()
    })

    it('passes modelId from selectedModel', () => {
      const { result } = renderHook(() =>
        useThreadConfig({
          thread: makeThread(),
          selectedModel: makeModel({ id: 'gpt-4o' }),
          globalDefaultPrompt: 'prompt',
          autoTuningEnabled: false,
          threadMessageCount: 0,
        })
      )

      expect(result.current.optimizedModelConfig.modelId).toBe('gpt-4o')
    })
  })
})
