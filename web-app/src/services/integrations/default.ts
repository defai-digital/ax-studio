import { invoke } from '@tauri-apps/api/core'
import type { IntegrationService } from './types'

export class DefaultIntegrationsService implements IntegrationService {
  async saveToken(integration: string, credentials: Record<string, string>): Promise<void> {
    await invoke('save_integration_token', { integration, credentials })
  }

  async deleteToken(integration: string): Promise<void> {
    await invoke('delete_integration_token', { integration })
  }

  async getStatus(integration: string): Promise<boolean> {
    return await invoke('get_integration_status', { integration })
  }

  async getAllStatuses(): Promise<Record<string, boolean>> {
    return await invoke('get_all_integration_statuses')
  }

  async validateToken(
    integration: string,
    credentials: Record<string, string>
  ): Promise<string> {
    return await invoke('validate_integration_token', { integration, credentials })
  }

  async startOAuthFlow(
    integration: string,
    credentials: Record<string, string>
  ): Promise<string> {
    return await invoke('start_oauth_flow', { integration, credentials })
  }
}
