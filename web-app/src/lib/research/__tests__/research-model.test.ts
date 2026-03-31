import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: vi.fn(),
  },
}))

vi.mock('@/lib/model-factory', () => ({
  ModelFactory: {
    createModel: vi.fn().mockReturnValue({ id: 'mock-model' }),
  },
}))

// @ts-ignore
import { useModelProvider } from '@/hooks/useModelProvider'
// @ts-ignore
import { ModelFactory } from '@/lib/model-factory'
import { buildResearchModel } from '../research-model'

describe('buildResearchModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should throw when no model is selected', async () => {
    vi.mocked(useModelProvider.getState).mockReturnValue({
      selectedModel: null,
      selectedProvider: 'openai',
      providers: [{ provider: 'openai' }],
    } as ReturnType<typeof useModelProvider.getState>)

    await expect(buildResearchModel()).rejects.toThrow(
      'No model selected. Please select a model in Settings',
    )
  })

  it('should throw when provider is not found', async () => {
    vi.mocked(useModelProvider.getState).mockReturnValue({
      selectedModel: { id: 'gpt-4' },
      selectedProvider: 'openai',
      providers: [],
    } as unknown as ReturnType<typeof useModelProvider.getState>)

    await expect(buildResearchModel()).rejects.toThrow(
      'No model selected. Please select a model in Settings',
    )
  })

  it('should call ModelFactory.createModel with correct args', async () => {
    const mockProvider = { provider: 'openai', apiKey: 'key', base_url: 'https://api.openai.com' }
    vi.mocked(useModelProvider.getState).mockReturnValue({
      selectedModel: { id: 'gpt-4' },
      selectedProvider: 'openai',
      providers: [mockProvider],
    } as unknown as ReturnType<typeof useModelProvider.getState>)

    const result = await buildResearchModel()
    expect(ModelFactory.createModel).toHaveBeenCalledWith(
      'gpt-4',
      mockProvider,
      {},
    )
    expect(result).toEqual({ id: 'mock-model' })
  })
})
