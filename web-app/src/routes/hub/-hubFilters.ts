import type { CatalogModel } from '@/services/models/types'

export function isMlxCatalogModel(model: CatalogModel): boolean {
  return (
    model.is_mlx === true ||
    model.library_name?.toLowerCase() === 'mlx' ||
    (model.num_safetensors ?? 0) > 0 ||
    (model.safetensors_files?.length ?? 0) > 0 ||
    model.model_name.toLowerCase().startsWith('mlx-community/')
  )
}
