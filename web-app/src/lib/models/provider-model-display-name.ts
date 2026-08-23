import { isAxEngineProvider } from '@/constants/providers'
import { getModelDisplayName } from '@/lib/utils'

export function getProviderModelDisplayName(
  model: Model,
  providerId: string
): string {
  const displayName = getModelDisplayName(model)
  if (!isAxEngineProvider(providerId)) return displayName

  const separatorIndex = displayName.lastIndexOf('/')
  return separatorIndex >= 0 ? displayName.slice(separatorIndex + 1) : displayName
}
