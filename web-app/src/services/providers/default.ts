/**
 * Default Providers Service - Generic implementation with minimal returns
 */

import type { ProvidersService } from './types'

export class DefaultProvidersService implements ProvidersService {
  async getProviders(): Promise<ModelProvider[]> {
    return []
  }

  async fetchModelsFromProvider(_provider: ModelProvider): Promise<string[]> {
    return []
  }

  async updateSettings(_providerName: string, _settings: ProviderSetting[]): Promise<void> {
    // No-op - not implemented in default service
  }

  fetch(): typeof fetch {
    return fetch
  }
}
