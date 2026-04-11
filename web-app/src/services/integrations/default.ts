import { invoke } from '@tauri-apps/api/core'
import { isPlatformTauri } from '@/lib/platform/utils'
import type { IntegrationService } from './types'

/**
 * Desktop Tauri implementation. All methods:
 *  - Short-circuit to safe defaults on non-Tauri platforms (the previous
 *    implementation imported `invoke` and would crash on web / mobile when
 *    integrations were touched).
 *  - Wrap `invoke` calls in try/catch and log errors, matching the error
 *    handling pattern used by every other Tauri service in the codebase.
 */
export class DefaultIntegrationsService implements IntegrationService {
  async saveToken(
    integration: string,
    credentials: Record<string, string>
  ): Promise<void> {
    if (!isPlatformTauri()) return
    try {
      await invoke('save_integration_token', { integration, credentials })
    } catch (error) {
      console.error(
        `[IntegrationsService] save_integration_token(${integration}) failed:`,
        error
      )
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  async deleteToken(integration: string): Promise<void> {
    if (!isPlatformTauri()) return
    try {
      await invoke('delete_integration_token', { integration })
    } catch (error) {
      console.error(
        `[IntegrationsService] delete_integration_token(${integration}) failed:`,
        error
      )
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  async getStatus(integration: string): Promise<boolean> {
    if (!isPlatformTauri()) return false
    try {
      return (
        (await invoke<boolean>('get_integration_status', { integration })) ?? false
      )
    } catch (error) {
      console.error(
        `[IntegrationsService] get_integration_status(${integration}) failed:`,
        error
      )
      return false
    }
  }

  async getAllStatuses(): Promise<Record<string, boolean>> {
    if (!isPlatformTauri()) return {}
    try {
      return (
        (await invoke<Record<string, boolean>>('get_all_integration_statuses')) ?? {}
      )
    } catch (error) {
      console.error(
        '[IntegrationsService] get_all_integration_statuses failed:',
        error
      )
      return {}
    }
  }

  async validateToken(
    integration: string,
    credentials: Record<string, string>
  ): Promise<string> {
    if (!isPlatformTauri()) {
      throw new Error('Integrations are only available on desktop (Tauri).')
    }
    try {
      return await invoke<string>('validate_integration_token', {
        integration,
        credentials,
      })
    } catch (error) {
      console.error(
        `[IntegrationsService] validate_integration_token(${integration}) failed:`,
        error
      )
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  async startOAuthFlow(
    integration: string,
    credentials: Record<string, string>
  ): Promise<string> {
    if (!isPlatformTauri()) {
      throw new Error('OAuth flows are only available on desktop (Tauri).')
    }
    try {
      return await invoke<string>('start_oauth_flow', {
        integration,
        credentials,
      })
    } catch (error) {
      console.error(
        `[IntegrationsService] start_oauth_flow(${integration}) failed:`,
        error
      )
      throw error instanceof Error ? error : new Error(String(error))
    }
  }
}
