import type { CatalogModel } from '@/services/models/types'

export const AUTOMATOSX_HUGGING_FACE_ORG = 'AutomatosX'

function catalogModelRepoId(model: CatalogModel): string {
  const modelName = model.model_name.trim()
  if (modelName.includes('/')) return modelName.toLowerCase()

  const developer = model.developer?.trim()
  return (developer ? `${developer}/${modelName}` : modelName).toLowerCase()
}

export function isAutomatosXCatalogModel(model: CatalogModel): boolean {
  const organization = AUTOMATOSX_HUGGING_FACE_ORG.toLowerCase()
  if (model.developer?.trim().toLowerCase() === organization) return true

  return catalogModelRepoId(model).startsWith(`${organization}/`)
}

export function mergeCatalogModels(
  bundledModels: CatalogModel[],
  additionalModels: CatalogModel[]
): CatalogModel[] {
  const seen = new Set<string>()
  return [...bundledModels, ...additionalModels].filter((model) => {
    const repoId = catalogModelRepoId(model)
    if (seen.has(repoId)) return false
    seen.add(repoId)
    return true
  })
}
