import type { ModelCatalog } from './types'

let cachedCatalog: ModelCatalog | null = null

export async function getBundledModelCatalog(): Promise<ModelCatalog> {
  if (cachedCatalog) return cachedCatalog

  const { default: catalog } = await import('@/data/model-catalog.json')
  cachedCatalog = catalog as ModelCatalog
  return cachedCatalog
}
