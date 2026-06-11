import { describe, expect, it } from 'vitest'
import type { CatalogModel } from '@/services/models/types'
import { isMlxCatalogModel } from '../-hubFilters'

const model = (overrides: Partial<CatalogModel>): CatalogModel => ({
  model_name: 'test/model',
  description: '',
  downloads: 0,
  ...overrides,
})

describe('hub model filters', () => {
  it('matches catalog models explicitly marked as MLX', () => {
    expect(isMlxCatalogModel(model({ is_mlx: true }))).toBe(true)
  })

  it('matches Hugging Face repos with MLX library metadata', () => {
    expect(isMlxCatalogModel(model({ library_name: 'MLX' }))).toBe(true)
  })

  it('matches safetensors-backed model entries used by MLX repos', () => {
    expect(isMlxCatalogModel(model({ num_safetensors: 1 }))).toBe(true)
    expect(
      isMlxCatalogModel(
        model({
          safetensors_files: [
            {
              model_id: 'model',
              path: 'model.safetensors',
              file_size: '1 GB',
            },
          ],
        })
      )
    ).toBe(true)
  })

  it('matches mlx-community repos even when optional metadata is missing', () => {
    expect(
      isMlxCatalogModel(model({ model_name: 'mlx-community/Qwen3-4B-4bit' }))
    ).toBe(true)
  })

  it('does not match GGUF-only catalog models', () => {
    expect(
      isMlxCatalogModel(
        model({
          num_quants: 1,
          quants: [
            {
              model_id: 'Qwen/Qwen3-4B-Instruct-GGUF',
              path: 'qwen3-4b-instruct-q4_k_m.gguf',
              file_size: '2.4 GB',
            },
          ],
        })
      )
    ).toBe(false)
  })
})
