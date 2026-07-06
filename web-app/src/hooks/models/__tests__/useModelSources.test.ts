import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useModelSources } from '../useModelSources'
import type { CatalogModel } from '@/services/models/types'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    modelSources: 'model-sources-settings',
  },
}))

// Mock the ServiceHub
const mockFetchModelCatalog = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    models: () => ({
      fetchModelCatalog: mockFetchModelCatalog,
    }),
  }),
}))

// Mock the sanitizeModelId function
vi.mock('@/lib/utils', () => ({
  sanitizeModelId: vi.fn((id: string) => id),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe('useModelSources', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset store state to defaults
    useModelSources.setState({
      sources: [],
      error: null,
      loading: false,
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useModelSources())

    expect(result.current.sources).toEqual([])
    expect(result.current.error).toBe(null)
    expect(result.current.loading).toBe(false)
    expect(typeof result.current.fetchSources).toBe('function')
  })

  describe('fetchSources', () => {
    it('should fetch sources successfully', async () => {
      const mockSources: CatalogModel[] = [
        {
          model_name: 'model-1',
          description: 'First model',
          developer: 'provider-1',
          downloads: 100,
          num_quants: 1,
          quants: [
            { model_id: 'model-1-q4', path: '/path/1', file_size: '1GB' },
          ],
          is_mlx: false,
        },
        {
          model_name: 'model-2',
          description: 'Second model',
          developer: 'provider-2',
          downloads: 200,
          num_quants: 1,
          quants: [
            { model_id: 'model-2-q4', path: '/path/2', file_size: '2GB' },
          ],
          is_mlx: false,
        },
      ]

      mockFetchModelCatalog.mockResolvedValueOnce(mockSources)

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(mockFetchModelCatalog).toHaveBeenCalledOnce()
      expect(result.current.sources).toEqual(mockSources)
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(null)
    })

    it('should synthesize downloadable MLX Hugging Face repo entries', async () => {
      const mockSources: CatalogModel[] = [
        {
          model_name: 'Qwen3.5-9B-MLX-4bit',
          description: 'MLX model',
          developer: 'mlx-community',
          downloads: 100,
          num_quants: 0,
          quants: [],
          is_mlx: true,
        },
      ]

      mockFetchModelCatalog.mockResolvedValueOnce(mockSources)

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources[0]).toMatchObject({
        is_mlx: true,
        num_quants: 1,
        quants: [
          {
            model_id: 'mlx-community/Qwen3.5-9B-MLX-4bit',
            path: 'hf://mlx-community/Qwen3.5-9B-MLX-4bit',
            supports_in_app_download: true,
          },
        ],
      })
    })

    it('should preserve existing MLX Hugging Face repo downloads', async () => {
      const mockSources: CatalogModel[] = [
        {
          model_name: 'mlx-community/gemma-4-12B-it-4bit',
          description: 'MLX model',
          developer: 'mlx-community',
          downloads: 100,
          num_quants: 1,
          quants: [
            {
              model_id: 'mlx-community/gemma-4-12B-it-4bit',
              path: 'hf://mlx-community/gemma-4-12B-it-4bit',
              file_size: '11GB',
              supports_in_app_download: true,
            },
          ],
          is_mlx: true,
        },
      ]

      mockFetchModelCatalog.mockResolvedValueOnce(mockSources)

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources[0]).toMatchObject({
        is_mlx: true,
        num_quants: 1,
        quants: [
          {
            model_id: 'mlx-community/gemma-4-12B-it-4bit',
            path: 'hf://mlx-community/gemma-4-12B-it-4bit',
            supports_in_app_download: true,
          },
        ],
      })
    })

    it('should handle fetch errors', async () => {
      const mockError = new Error('Network error')
      mockFetchModelCatalog.mockRejectedValueOnce(mockError)

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(mockError)
      expect(result.current.sources).toEqual([])
    })

    it('should not merge new sources with existing ones', async () => {
      const existingSources: CatalogModel[] = [
        {
          model_name: 'existing-model',
          description: 'Existing model',
          developer: 'existing-provider',
          downloads: 50,
          num_quants: 1,
          quants: [
            {
              model_id: 'existing-model-q4',
              path: '/path/existing',
              file_size: '1GB',
            },
          ],
          is_mlx: false,
        },
      ]

      const newSources: CatalogModel[] = [
        {
          model_name: 'new-model',
          description: 'New model',
          developer: 'new-provider',
          downloads: 150,
          num_quants: 1,
          quants: [
            { model_id: 'new-model-q4', path: '/path/new', file_size: '2GB' },
          ],
          is_mlx: false,
        },
      ]

      // Set initial state with existing sources
      useModelSources.setState({
        sources: existingSources,
        error: null,
        loading: false,
      })

      mockFetchModelCatalog.mockResolvedValueOnce(newSources)

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual(newSources)
    })

    it('should not duplicate models with same model_name', async () => {
      const existingSources: CatalogModel[] = [
        {
          model_name: 'duplicate-model',
          description: 'Old version',
          developer: 'old-provider',
          downloads: 100,
          num_quants: 1,
          quants: [
            {
              model_id: 'duplicate-model-q4',
              path: '/path/old',
              file_size: '1GB',
            },
          ],
          is_mlx: false,
        },
        {
          model_name: 'unique-model',
          description: 'Unique model',
          developer: 'provider',
          downloads: 75,
          num_quants: 1,
          quants: [
            {
              model_id: 'unique-model-q4',
              path: '/path/unique',
              file_size: '1GB',
            },
          ],
          is_mlx: false,
        },
      ]

      const newSources: CatalogModel[] = [
        {
          model_name: 'duplicate-model',
          description: 'New version',
          developer: 'new-provider',
          downloads: 200,
          num_quants: 1,
          quants: [
            {
              model_id: 'duplicate-model-q4-new',
              path: '/path/new',
              file_size: '2GB',
            },
          ],
          is_mlx: false,
        },
      ]

      // Set initial state with existing sources
      useModelSources.setState({
        sources: existingSources,
        error: null,
        loading: false,
      })

      mockFetchModelCatalog.mockResolvedValueOnce(newSources)

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual(newSources)
    })

    it('should handle empty sources response', async () => {
      mockFetchModelCatalog.mockResolvedValueOnce([])

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual([])
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(null)
    })

    it('should sanitize malformed catalog responses', async () => {
      mockFetchModelCatalog.mockResolvedValueOnce([
        null,
        {
          model_name: '',
          description: 'Missing name',
          downloads: 100,
        },
        {
          model_name: 'valid-model',
          description: 42,
          developer: 'provider',
          downloads: Number.NaN,
          quants: [
            null,
            {
              model_id: ' valid-model-q4 ',
              path: ' /path/model.gguf ',
              file_size: 123,
            },
            {
              model_id: '',
              path: '/missing-id',
              file_size: '1GB',
            },
          ],
          is_mlx: false,
        },
      ])

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual([
        {
          model_name: 'valid-model',
          description: '',
          developer: 'provider',
          downloads: 0,
          quants: [
            {
              model_id: 'valid-model-q4',
              path: '/path/model.gguf',
              file_size: '',
            },
          ],
          num_quants: 1,
          is_mlx: false,
        },
      ])
      expect(result.current.error).toBe(null)
    })

    it('should clear previous error on successful fetch', async () => {
      const { result } = renderHook(() => useModelSources())

      // First request fails
      mockFetchModelCatalog.mockRejectedValueOnce(new Error('First error'))

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.error).toBeInstanceOf(Error)

      // Second request succeeds
      const mockSources: CatalogModel[] = [
        {
          model_name: 'model-1',
          description: 'Model 1',
          developer: 'provider-1',
          downloads: 100,
          num_quants: 1,
          quants: [
            { model_id: 'model-1-q4', path: '/path/1', file_size: '1GB' },
          ],
          is_mlx: false,
        },
      ]

      mockFetchModelCatalog.mockResolvedValueOnce(mockSources)

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.error).toBe(null)
      expect(result.current.sources).toEqual(mockSources)
    })

    it('should ignore stale catalog results when a newer fetch finishes first', async () => {
      const staleRequest = deferred<CatalogModel[]>()
      const freshRequest = deferred<CatalogModel[]>()
      const staleSources: CatalogModel[] = [
        {
          model_name: 'stale-model',
          description: 'Older catalog response',
          developer: 'provider-1',
          downloads: 100,
          num_quants: 1,
          quants: [
            {
              model_id: 'stale-model-q4',
              path: '/path/stale',
              file_size: '1GB',
            },
          ],
          is_mlx: false,
        },
      ]
      const freshSources: CatalogModel[] = [
        {
          model_name: 'fresh-model',
          description: 'Newer catalog response',
          developer: 'provider-2',
          downloads: 200,
          num_quants: 1,
          quants: [
            {
              model_id: 'fresh-model-q4',
              path: '/path/fresh',
              file_size: '2GB',
            },
          ],
          is_mlx: false,
        },
      ]

      mockFetchModelCatalog
        .mockReturnValueOnce(staleRequest.promise)
        .mockReturnValueOnce(freshRequest.promise)

      const { result } = renderHook(() => useModelSources())

      let staleFetch!: Promise<void>
      let freshFetch!: Promise<void>
      act(() => {
        staleFetch = result.current.fetchSources()
        freshFetch = result.current.fetchSources()
      })

      await act(async () => {
        freshRequest.resolve(freshSources)
        await freshFetch
      })

      expect(result.current.sources).toEqual(freshSources)
      expect(result.current.loading).toBe(false)

      await act(async () => {
        staleRequest.resolve(staleSources)
        await staleFetch
      })

      expect(result.current.sources).toEqual(freshSources)
      expect(result.current.error).toBe(null)
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useModelSources())
      const { result: result2 } = renderHook(() => useModelSources())

      expect(result1.current.sources).toBe(result2.current.sources)
      expect(result1.current.loading).toBe(result2.current.loading)
      expect(result1.current.error).toBe(result2.current.error)
    })

    it('should update state across multiple hook instances', async () => {
      const mockSources: CatalogModel[] = [
        {
          model_name: 'shared-model',
          description: 'Shared model',
          developer: 'shared-provider',
          downloads: 100,
          num_quants: 1,
          quants: [
            {
              model_id: 'shared-model-q4',
              path: '/path/shared',
              file_size: '1GB',
            },
          ],
          is_mlx: false,
        },
      ]

      mockFetchModelCatalog.mockResolvedValueOnce(mockSources)

      const { result: result1 } = renderHook(() => useModelSources())
      const { result: result2 } = renderHook(() => useModelSources())

      await act(async () => {
        await result1.current.fetchSources()
      })

      expect(result2.current.sources).toEqual(mockSources)
    })
  })

  describe('persistence', () => {
    it('sanitizes malformed persisted sources during merge', () => {
      const merge = useModelSources.persist.getOptions().merge
      const current = useModelSources.getState()
      const replacementFetch = 'not-a-function'

      const merged = merge?.(
        {
          loading: true,
          error: { message: 'persisted error' },
          fetchSources: replacementFetch,
          sources: [
            null,
            {
              model_name: '',
              description: 'Missing model name',
              downloads: 1,
            },
            {
              model_name: ' persisted-model ',
              description: 'Persisted model',
              developer: 42,
              downloads: Number.POSITIVE_INFINITY,
              quants: [
                {
                  model_id: ' persisted-model-q4 ',
                  path: ' /models/persisted.gguf ',
                  file_size: '4GB',
                },
                {
                  model_id: 'missing-path',
                  path: '',
                  file_size: '1GB',
                },
              ],
              mmproj_models: [
                {
                  model_id: ' projector ',
                  path: ' /models/projector.gguf ',
                  file_size: 12,
                },
              ],
              safetensors_files: [
                {
                  model_id: ' st-model ',
                  path: ' /models/model.safetensors ',
                  file_size: '8GB',
                  sha256: 123,
                },
              ],
              tools: true,
              is_mlx: false,
            },
          ],
        },
        current
      )

      expect(typeof merged?.fetchSources).toBe('function')
      expect(merged?.loading).toBe(false)
      expect(merged?.error).toBe(null)
      expect(merged?.sources).toEqual([
        {
          model_name: 'persisted-model',
          description: 'Persisted model',
          downloads: 0,
          quants: [
            {
              model_id: 'persisted-model-q4',
              path: '/models/persisted.gguf',
              file_size: '4GB',
            },
          ],
          num_quants: 1,
          mmproj_models: [
            {
              model_id: 'projector',
              path: '/models/projector.gguf',
              file_size: '',
            },
          ],
          safetensors_files: [
            {
              model_id: 'st-model',
              path: '/models/model.safetensors',
              file_size: '8GB',
            },
          ],
          tools: true,
          is_mlx: false,
        },
      ])
    })

    it('caps persisted sources to the most recent 2000 valid entries', () => {
      const merge = useModelSources.persist.getOptions().merge
      const current = useModelSources.getState()
      const sources = Array.from({ length: 2005 }, (_, index) => ({
        model_name: `model-${index}`,
        description: `Model ${index}`,
        downloads: index,
        quants: [],
        is_mlx: false,
      }))

      const merged = merge?.({ sources }, current)

      expect(merged?.sources).toHaveLength(2000)
      expect(merged?.sources[0]?.model_name).toBe('model-5')
      expect(merged?.sources[1999]?.model_name).toBe('model-2004')
    })
  })

  describe('error handling', () => {
    it('should handle different error types', async () => {
      const errors = [
        new Error('Network error'),
        new TypeError('Type error'),
        new ReferenceError('Reference error'),
      ]

      const { result } = renderHook(() => useModelSources())

      for (const error of errors) {
        mockFetchModelCatalog.mockRejectedValueOnce(error)

        await act(async () => {
          await result.current.fetchSources()
        })

        expect(result.current.error).toBe(error)
        expect(result.current.loading).toBe(false)
        expect(result.current.sources).toEqual([])
      }
    })
  })

  describe('complex scenarios', () => {
    it('should handle multiple fetch operations', async () => {
      const { result } = renderHook(() => useModelSources())

      const sources1: CatalogModel[] = [
        {
          model_name: 'model-1',
          description: 'First batch',
          developer: 'provider-1',
          downloads: 100,
          num_quants: 1,
          quants: [
            { model_id: 'model-1-q4', path: '/path/1', file_size: '1GB' },
          ],
          is_mlx: false,
        },
      ]

      const sources2: CatalogModel[] = [
        {
          model_name: 'model-2',
          description: 'Second batch',
          developer: 'provider-2',
          downloads: 200,
          num_quants: 1,
          quants: [
            { model_id: 'model-2-q4', path: '/path/2', file_size: '2GB' },
          ],
          is_mlx: false,
        },
      ]

      // First fetch
      mockFetchModelCatalog.mockResolvedValueOnce(sources1)

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual(sources1)

      // Second fetch
      mockFetchModelCatalog.mockResolvedValueOnce(sources2)

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual(sources2)
    })

    it('should handle fetch after error', async () => {
      const { result } = renderHook(() => useModelSources())

      // First request fails
      mockFetchModelCatalog.mockRejectedValueOnce(new Error('Network error'))

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.error).toBeInstanceOf(Error)

      // Second request succeeds
      const mockSources: CatalogModel[] = [
        {
          model_name: 'recovery-model',
          description: 'Recovery model',
          developer: 'recovery-provider',
          downloads: 100,
          num_quants: 1,
          quants: [
            {
              model_id: 'recovery-model-q4',
              path: '/path/recovery',
              file_size: '1GB',
            },
          ],
          is_mlx: false,
        },
      ]

      mockFetchModelCatalog.mockResolvedValueOnce(mockSources)

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.error).toBe(null)
      expect(result.current.sources).toEqual(mockSources)
    })
  })
})
