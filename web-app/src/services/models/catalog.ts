import bundledModelCatalog from '@/data/model-catalog.json'
import type { ModelCatalog } from './types'

export function getBundledModelCatalog(): ModelCatalog {
  return bundledModelCatalog as ModelCatalog
}

