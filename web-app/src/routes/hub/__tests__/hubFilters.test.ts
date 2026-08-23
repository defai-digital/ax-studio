import { describe, expect, it } from 'vitest'
import type { CatalogModel } from '@/services/models/types'
import { isMlxCatalogModel } from '@/lib/models'
import {
  isAutomatosXCatalogModel,
  mergeCatalogModels,
} from '../-hubFilters'

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
    expect(isMlxCatalogModel(model({ developer: 'mlx-community' }))).toBe(true)
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

  it('matches AutomatosX models by developer or namespaced repository ID', () => {
    expect(
      isAutomatosXCatalogModel(
        model({ model_name: 'AX-Qwen', developer: 'AutomatosX' })
      )
    ).toBe(true)
    expect(
      isAutomatosXCatalogModel(
        model({ model_name: 'automatosx/AX-Qwen', developer: undefined })
      )
    ).toBe(true)
    expect(
      isAutomatosXCatalogModel(
        model({ model_name: 'community/AX-Qwen', developer: 'community' })
      )
    ).toBe(false)
  })

  it('merges live organization models without duplicating bundled entries', () => {
    const bundled = model({
      model_name: 'AX-Qwen',
      developer: 'AutomatosX',
      description: 'bundled metadata',
    })
    const liveDuplicate = model({
      model_name: 'AutomatosX/AX-Qwen',
      developer: 'AutomatosX',
      description: 'live metadata',
    })
    const liveNew = model({
      model_name: 'AutomatosX/AX-Gemma',
      developer: 'AutomatosX',
    })

    expect(mergeCatalogModels([bundled], [liveDuplicate, liveNew])).toEqual([
      bundled,
      liveNew,
    ])
  })
})
