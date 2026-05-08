import { LOCAL_PROVIDER_IDS } from '@/constants/providers'
import { sanitizeModelId } from '@/lib/utils'
import type { CatalogModel } from '@/services/models/types'

type DownloadMatch = {
  modelId: string
  providerId: string
}

const getLocalProviders = (providers: ModelProvider[] = []): ModelProvider[] =>
  providers.filter((provider) => LOCAL_PROVIDER_IDS.has(provider.provider))

const getModelIdCandidates = (
  modelId: string,
  developer?: string
): string[] => {
  const parts = modelId.split('/').filter(Boolean)
  const basename = parts.at(-1) ?? modelId
  const author = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
  const sanitizedBasename = sanitizeModelId(basename)

  return [
    modelId,
    sanitizeModelId(modelId),
    basename,
    sanitizedBasename,
    author ? `${author}/${basename}` : '',
    author ? `${author}/${sanitizedBasename}` : '',
    developer ? `${developer}/${basename}` : '',
    developer ? `${developer}/${sanitizedBasename}` : '',
  ].filter(Boolean)
}

export const findDownloadedLocalModel = (
  providers: ModelProvider[] = [],
  modelId: string,
  developer?: string
): DownloadMatch | undefined => {
  const candidates = new Set(getModelIdCandidates(modelId, developer))

  for (const provider of getLocalProviders(providers)) {
    const matchedModel = provider.models?.find((model) =>
      candidates.has(model.id)
    )

    if (matchedModel) {
      return {
        modelId: matchedModel.id,
        providerId: provider.provider,
      }
    }
  }

  return undefined
}

export const findDownloadedCatalogModel = (
  providers: ModelProvider[] = [],
  model: CatalogModel
): DownloadMatch | undefined => {
  for (const quant of model.quants ?? []) {
    const match = findDownloadedLocalModel(
      providers,
      quant.model_id,
      model.developer
    )
    if (match) return match
  }

  return findDownloadedLocalModel(providers, model.model_name, model.developer)
}
