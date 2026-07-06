import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'

interface FavoriteModelState {
  favoriteModels: Model[]
  addFavorite: (model: Model) => void
  removeFavorite: (modelId: string) => void
  isFavorite: (modelId: string) => boolean
  toggleFavorite: (model: Model) => void
}

const MAX_FAVORITE_MODELS = 200

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeFavoriteModel(value: unknown): Model | undefined {
  if (!isPlainRecord(value)) return undefined

  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!id) return undefined

  const model: Model = { id }
  const modelName = normalizeOptionalString(value.model)
  const name = normalizeOptionalString(value.name)
  const displayName = normalizeOptionalString(value.displayName)
  const description = normalizeOptionalString(value.description)
  const format = normalizeOptionalString(value.format)

  if (modelName !== undefined) model.model = modelName
  if (name !== undefined) model.name = name
  if (displayName !== undefined) model.displayName = displayName
  if (typeof value.version === 'string' || typeof value.version === 'number') {
    model.version = value.version
  }
  if (description !== undefined) model.description = description
  if (format !== undefined) model.format = format
  if (Array.isArray(value.capabilities)) {
    model.capabilities = value.capabilities.filter(
      (capability): capability is string => typeof capability === 'string'
    )
  }
  if (isPlainRecord(value.settings)) {
    model.settings = value.settings as Record<string, ProviderSetting>
  }
  if (typeof value.embedding === 'boolean') model.embedding = value.embedding

  return model
}

function normalizeFavoriteModels(value: unknown): Model[] {
  if (!Array.isArray(value)) return []

  const normalized = new Map<string, Model>()
  for (const item of value) {
    const model = normalizeFavoriteModel(item)
    if (model) normalized.set(model.id, model)
  }

  return Array.from(normalized.values()).slice(-MAX_FAVORITE_MODELS)
}

function sanitizePersistedFavoriteModels(
  persisted: unknown,
  current: FavoriteModelState
): FavoriteModelState {
  if (!isPlainRecord(persisted)) return current

  return {
    ...current,
    favoriteModels: normalizeFavoriteModels(persisted.favoriteModels),
  }
}

export const useFavoriteModel = create<FavoriteModelState>()(
  persist(
    (set, get) => ({
      favoriteModels: [],

      addFavorite: (model: Model) => {
        const normalizedModel = normalizeFavoriteModel(model)
        if (!normalizedModel) return

        set((state) => {
          if (
            !state.favoriteModels.some((fav) => fav.id === normalizedModel.id)
          ) {
            return {
              favoriteModels: [
                ...state.favoriteModels,
                normalizedModel,
              ].slice(-MAX_FAVORITE_MODELS),
            }
          }
          return state
        })
      },

      removeFavorite: (modelId: string) => {
        if (typeof modelId !== 'string' || modelId.trim() === '') return

        set((state) => ({
          favoriteModels: state.favoriteModels.filter(
            (model) => model.id !== modelId.trim()
          ),
        }))
      },

      isFavorite: (modelId: string) => {
        if (typeof modelId !== 'string' || modelId.trim() === '') return false
        return get().favoriteModels.some((model) => model.id === modelId.trim())
      },

      toggleFavorite: (model: Model) => {
        const normalizedModel = normalizeFavoriteModel(model)
        if (!normalizedModel) return

        const { isFavorite, addFavorite, removeFavorite } = get()
        if (isFavorite(normalizedModel.id)) {
          removeFavorite(normalizedModel.id)
        } else {
          addFavorite(normalizedModel)
        }
      },
    }),
    {
      name: localStorageKey.favoriteModels,
      storage: createSafeJSONStorage(() => localStorage, 'useFavoriteModel'),
      merge: (persisted, current) =>
        sanitizePersistedFavoriteModels(persisted, current),
      partialize: (state) => ({
        favoriteModels: normalizeFavoriteModels(state.favoriteModels),
      }),
    }
  )
)
