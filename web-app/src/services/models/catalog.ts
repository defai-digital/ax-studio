import type { CatalogModel, ModelCatalog, ModelQuant } from './types'

let cachedCatalog: ModelCatalog | null = null

type AxEngineModelProfile = {
  modelName: string
  description: string
  downloads: number
  createdAt: string
  quants: ModelQuant[]
  tools?: boolean
}

const axEngineNativeMlxModels: AxEngineModelProfile[] = [
  {
    modelName: 'AX Engine Gemma 4 E2B',
    description:
      'AX Engine native MLX Gemma 4 E2B targets for gemma4-e2b, gemma4-e2b-5bit, gemma4-e2b-6bit, and gemma4-e2b-8bit.',
    downloads: 56561,
    createdAt: '2026-06-17T00:00:00.000Z',
    quants: [
      {
        model_id: 'mlx-community/gemma-4-e2b-it-4bit',
        path: 'hf://mlx-community/gemma-4-e2b-it-4bit',
        file_size: '3.3 GB',
        supports_in_app_download: true,
      },
      {
        model_id: 'mlx-community/gemma-4-e2b-it-5bit',
        path: 'hf://mlx-community/gemma-4-e2b-it-5bit',
        file_size: '3.9 GB',
        supports_in_app_download: true,
      },
      {
        model_id: 'mlx-community/gemma-4-e2b-it-6bit',
        path: 'hf://mlx-community/gemma-4-e2b-it-6bit',
        file_size: '4.4 GB',
        supports_in_app_download: true,
      },
      {
        model_id: 'mlx-community/gemma-4-e2b-it-8bit',
        path: 'hf://mlx-community/gemma-4-e2b-it-8bit',
        file_size: '5.5 GB',
        supports_in_app_download: true,
      },
    ],
  },
  {
    modelName: 'AX Engine Gemma 4 12B',
    description:
      'AX Engine native MLX Gemma 4 12B targets for gemma4-12b and gemma4-12b-6bit. Use these instead of Gemma 3 for the supported native Ax Engine path.',
    downloads: 18376,
    createdAt: '2026-06-17T00:00:00.000Z',
    quants: [
      {
        model_id: 'mlx-community/gemma-4-12B-it-4bit',
        path: 'hf://mlx-community/gemma-4-12B-it-4bit',
        file_size: '6.3 GB',
        supports_in_app_download: true,
      },
      {
        model_id: 'mlx-community/gemma-4-12B-it-6bit',
        path: 'hf://mlx-community/gemma-4-12B-it-6bit',
        file_size: '9.1 GB',
        supports_in_app_download: true,
      },
    ],
  },
  {
    modelName: 'AX Engine Gemma 4 26B',
    description:
      'AX Engine native MLX Gemma 4 26B target, matching the gemma4-26b download alias.',
    downloads: 23202,
    createdAt: '2026-06-17T00:00:00.000Z',
    quants: [
      {
        model_id: 'mlx-community/gemma-4-26b-a4b-it-4bit',
        path: 'hf://mlx-community/gemma-4-26b-a4b-it-4bit',
        file_size: '14.5 GB',
        supports_in_app_download: true,
      },
    ],
  },
  {
    modelName: 'AX Engine Gemma 4 31B',
    description:
      'AX Engine native MLX Gemma 4 31B target, matching the gemma4-31b download alias.',
    downloads: 15289,
    createdAt: '2026-06-17T00:00:00.000Z',
    quants: [
      {
        model_id: 'mlx-community/gemma-4-31b-it-4bit',
        path: 'hf://mlx-community/gemma-4-31b-it-4bit',
        file_size: '17.1 GB',
        supports_in_app_download: true,
      },
    ],
  },
  {
    modelName: 'AX Engine DiffusionGemma 26B A4B',
    description:
      'AX Engine native MLX DiffusionGemma 26B A4B target. This uses AX Engine direct block-diffusion decode, not ordinary autoregressive decode.',
    downloads: 20733,
    createdAt: '2026-06-10T16:39:43.000Z',
    quants: [
      {
        model_id: 'mlx-community/diffusiongemma-26B-A4B-it-4bit',
        path: 'hf://mlx-community/diffusiongemma-26B-A4B-it-4bit',
        file_size: '16.5 GB',
        supports_in_app_download: true,
      },
    ],
  },
  {
    modelName: 'AX Engine Qwen 3.6 27B',
    description:
      'AX Engine native MLX Qwen 3.6 27B targets for qwen3.6-27b, qwen3.6-27b-5bit, qwen3.6-27b-6bit, and qwen3.6-27b-8bit.',
    downloads: 28508,
    createdAt: '2026-06-17T00:00:00.000Z',
    quants: [
      {
        model_id: 'mlx-community/Qwen3.6-27B-4bit',
        path: 'hf://mlx-community/Qwen3.6-27B-4bit',
        file_size: '15.0 GB',
        supports_in_app_download: true,
      },
      {
        model_id: 'mlx-community/Qwen3.6-27B-5bit',
        path: 'hf://mlx-community/Qwen3.6-27B-5bit',
        file_size: '18.1 GB',
        supports_in_app_download: true,
      },
      {
        model_id: 'mlx-community/Qwen3.6-27B-6bit',
        path: 'hf://mlx-community/Qwen3.6-27B-6bit',
        file_size: '21.2 GB',
        supports_in_app_download: true,
      },
      {
        model_id: 'mlx-community/Qwen3.6-27B-8bit',
        path: 'hf://mlx-community/Qwen3.6-27B-8bit',
        file_size: '27.5 GB',
        supports_in_app_download: true,
      },
    ],
  },
  {
    modelName: 'AX Engine Qwen 3.6 35B A3B',
    description:
      'AX Engine native MLX Qwen 3.6 35B A3B target, matching the qwen3.6-35b download alias.',
    downloads: 53741,
    createdAt: '2026-06-17T00:00:00.000Z',
    tools: true,
    quants: [
      {
        model_id: 'mlx-community/Qwen3.6-35B-A3B-4bit',
        path: 'hf://mlx-community/Qwen3.6-35B-A3B-4bit',
        file_size: '19.0 GB',
        supports_in_app_download: true,
      },
    ],
  },
]

function toCatalogModel(profile: AxEngineModelProfile): CatalogModel {
  return {
    model_name: profile.modelName,
    developer: 'AX Engine',
    downloads: profile.downloads,
    created_at: profile.createdAt,
    library_name: 'mlx',
    is_mlx: true,
    tools: profile.tools ?? false,
    num_quants: profile.quants.length,
    quants: profile.quants,
    num_mmproj: 0,
    mmproj_models: [],
    num_safetensors: 0,
    safetensors_files: [],
    description: profile.description,
  }
}

function quantRepoIds(model: CatalogModel): Set<string> {
  return new Set(
    (model.quants ?? [])
      .map((quant) =>
        quant.path.startsWith('hf://')
          ? quant.path.slice('hf://'.length)
          : quant.model_id
      )
      .filter(Boolean)
  )
}

function withAxEngineNativeMlxModels(catalog: ModelCatalog): ModelCatalog {
  const existingRepoIds = new Set(
    catalog.flatMap((model) => [...quantRepoIds(model)])
  )
  const axModels = axEngineNativeMlxModels
    .map(toCatalogModel)
    .map((model) => ({
      ...model,
      quants: (model.quants ?? []).filter(
        (quant) => !existingRepoIds.has(quant.model_id)
      ),
    }))
    .filter((model) => (model.quants?.length ?? 0) > 0)
    .map((model) => ({
      ...model,
      num_quants: model.quants?.length ?? 0,
    }))

  return [...axModels, ...catalog]
}

export async function getBundledModelCatalog(): Promise<ModelCatalog> {
  if (cachedCatalog) return cachedCatalog

  const { default: catalog } = await import('@/data/model-catalog.json')
  cachedCatalog = withAxEngineNativeMlxModels(catalog as ModelCatalog)
  return cachedCatalog
}
