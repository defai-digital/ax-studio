import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { persist } from 'zustand/middleware'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'
import { isMlxCatalogModel } from '@/lib/models'
import { sanitizeModelId } from '@/lib/utils'
import { createSafeJSONStorage } from '@/lib/storage/storage'

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
            .then((catalogs) => catalogs.map(normalizeCatalogModel))

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
        const persistedState = persisted as Partial<ModelSourcesState>

        return {
          ...current,
          ...persistedState,
          sources:
            persistedState.sources?.map(normalizeCatalogModel) ??
            current.sources,
          loading: false,
          error: null,
        }
      },
    }
  )
)
