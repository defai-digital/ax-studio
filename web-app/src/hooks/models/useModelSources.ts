import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { persist } from 'zustand/middleware'
import { getServiceHub } from '@/hooks/useServiceHub'
import type {
  CatalogModel,
  MMProjModel,
  ModelQuant,
  SafetensorsFile,
} from '@/services/models/types'
import { isMlxCatalogModel } from '@/lib/models'
import { sanitizeModelId } from '@/lib/utils'
import { createSafeJSONStorage } from '@/lib/storage/storage'

const MAX_PERSISTED_MODEL_SOURCES = 2000

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeOptionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : undefined
}

function normalizeModelQuant(value: unknown): ModelQuant | undefined {
  if (!isPlainRecord(value)) return undefined

  const modelId = normalizeString(value.model_id).trim()
  const path = normalizeString(value.path).trim()
  if (!modelId || !path) return undefined

  const quant: ModelQuant = {
    model_id: modelId,
    path,
    file_size: normalizeString(value.file_size),
  }

  if (typeof value.supports_in_app_download === 'boolean') {
    quant.supports_in_app_download = value.supports_in_app_download
  }

  return quant
}

function normalizeModelQuants(value: unknown): ModelQuant[] | undefined {
  if (!Array.isArray(value)) return undefined

  return value
    .map(normalizeModelQuant)
    .filter((quant): quant is ModelQuant => quant !== undefined)
}

function normalizeMMProjModel(value: unknown): MMProjModel | undefined {
  if (!isPlainRecord(value)) return undefined

  const modelId = normalizeString(value.model_id).trim()
  const path = normalizeString(value.path).trim()
  if (!modelId || !path) return undefined

  return {
    model_id: modelId,
    path,
    file_size: normalizeString(value.file_size),
  }
}

function normalizeMMProjModels(value: unknown): MMProjModel[] | undefined {
  if (!Array.isArray(value)) return undefined

  return value
    .map(normalizeMMProjModel)
    .filter((model): model is MMProjModel => model !== undefined)
}

function normalizeSafetensorsFile(value: unknown): SafetensorsFile | undefined {
  if (!isPlainRecord(value)) return undefined

  const modelId = normalizeString(value.model_id).trim()
  const path = normalizeString(value.path).trim()
  if (!modelId || !path) return undefined

  const file: SafetensorsFile = {
    model_id: modelId,
    path,
    file_size: normalizeString(value.file_size),
  }

  const sha256 = normalizeOptionalString(value.sha256)
  if (sha256 !== undefined) file.sha256 = sha256

  return file
}

function normalizeSafetensorsFiles(
  value: unknown
): SafetensorsFile[] | undefined {
  if (!Array.isArray(value)) return undefined

  return value
    .map(normalizeSafetensorsFile)
    .filter((file): file is SafetensorsFile => file !== undefined)
}

function normalizeCatalogInput(value: unknown): CatalogModel | undefined {
  if (!isPlainRecord(value)) return undefined

  const modelName = normalizeString(value.model_name).trim()
  if (!modelName) return undefined

  const quants = normalizeModelQuants(value.quants)
  const mmprojModels = normalizeMMProjModels(value.mmproj_models)
  const safetensorsFiles = normalizeSafetensorsFiles(value.safetensors_files)

  const catalog: CatalogModel = {
    model_name: modelName,
    description: normalizeString(value.description),
    downloads: normalizeFiniteNumber(value.downloads),
  }

  const libraryName = normalizeOptionalString(value.library_name)
  const developer = normalizeOptionalString(value.developer)
  const numQuants = normalizeOptionalCount(value.num_quants)
  const numMmproj = normalizeOptionalCount(value.num_mmproj)
  const numSafetensors = normalizeOptionalCount(value.num_safetensors)
  const createdAt = normalizeOptionalString(value.created_at)
  const readme = normalizeOptionalString(value.readme)

  if (libraryName !== undefined) catalog.library_name = libraryName
  if (developer !== undefined) catalog.developer = developer
  if (numQuants !== undefined) catalog.num_quants = numQuants
  if (quants !== undefined) catalog.quants = quants
  if (mmprojModels !== undefined) catalog.mmproj_models = mmprojModels
  if (numMmproj !== undefined) catalog.num_mmproj = numMmproj
  if (safetensorsFiles !== undefined) {
    catalog.safetensors_files = safetensorsFiles
  }
  if (numSafetensors !== undefined) catalog.num_safetensors = numSafetensors
  if (createdAt !== undefined) catalog.created_at = createdAt
  if (readme !== undefined) catalog.readme = readme
  if (typeof value.tools === 'boolean') catalog.tools = value.tools
  if (typeof value.is_mlx === 'boolean') catalog.is_mlx = value.is_mlx

  return catalog
}

const normalizeCatalogModel = (catalog: CatalogModel): CatalogModel => {
  const isMlx = isMlxCatalogModel(catalog)
  const normalizedQuants = catalog.quants?.map((quant) => {
    if (quant.path.startsWith('hf://')) return quant

    const parts = quant.model_id.split('/')
    const author = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
    const name = parts.length > 1 ? parts[parts.length - 1] : parts[0]
    const sanitizedName = sanitizeModelId(name)
    const newId = author ? `${author}/${sanitizedName}` : sanitizedName
    return {
      ...quant,
      model_id: newId,
    }
  })

  if ((normalizedQuants?.length ?? 0) > 0) {
    return {
      ...catalog,
      quants: normalizedQuants,
      num_quants: normalizedQuants?.length,
    }
  }

  if (!isMlx) {
    return {
      ...catalog,
      quants: normalizedQuants,
      num_quants: normalizedQuants?.length ?? catalog.num_quants,
    }
  }

  const repoId = catalog.model_name.includes('/')
    ? catalog.model_name
    : catalog.developer
      ? `${catalog.developer}/${catalog.model_name}`
      : catalog.model_name

  return {
    ...catalog,
    is_mlx: true,
    quants: [
      {
        model_id: repoId,
        path: `hf://${repoId}`,
        file_size: '',
        supports_in_app_download: true,
      },
    ],
    num_quants: 1,
  }
}

function normalizeCatalogModels(value: unknown): CatalogModel[] {
  if (!Array.isArray(value)) return []

  return value
    .map(normalizeCatalogInput)
    .filter((catalog): catalog is CatalogModel => catalog !== undefined)
    .map(normalizeCatalogModel)
}

function normalizeRecentCatalogModels(
  value: unknown,
  maxItems: number
): CatalogModel[] {
  if (!Array.isArray(value)) return []

  const normalized: CatalogModel[] = []
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const catalog = normalizeCatalogInput(value[index])
    if (!catalog) continue

    normalized.push(normalizeCatalogModel(catalog))
    if (normalized.length >= maxItems) break
  }

  normalized.reverse()
  return normalized
}

let fetchSourcesRequestId = 0

// Zustand store for model sources
type ModelSourcesState = {
  sources: CatalogModel[]
  error: Error | null
  loading: boolean
  fetchSources: () => Promise<void>
}

export const useModelSources = create<ModelSourcesState>()(
  persist(
    (set, get) => ({
      sources: [],
      error: null,
      loading: false,
      fetchSources: async () => {
        const requestId = ++fetchSourcesRequestId
        set({ loading: true, error: null })
        try {
          const newSources = await getServiceHub()
            .models()
            .fetchModelCatalog()
            .then(normalizeCatalogModels)

          if (requestId !== fetchSourcesRequestId) return

          set({
            sources: newSources.length ? newSources : get().sources,
            loading: false,
          })
        } catch (error) {
          if (requestId !== fetchSourcesRequestId) return

          set({ error: error as Error, loading: false })
        }
      },
    }),
    {
      name: localStorageKey.modelSources,
      storage: createSafeJSONStorage(() => localStorage, 'useModelSources'),
      merge: (persisted, current) => {
        if (!isPlainRecord(persisted)) {
          return {
            ...current,
            loading: false,
            error: null,
          }
        }

        const sources = normalizeRecentCatalogModels(
          persisted.sources,
          MAX_PERSISTED_MODEL_SOURCES
        )

        return {
          ...current,
          sources,
          loading: false,
          error: null,
        }
      },
      partialize: (state) => ({
        sources: normalizeRecentCatalogModels(
          state.sources,
          MAX_PERSISTED_MODEL_SOURCES
        ),
      }),
    }
  )
)
