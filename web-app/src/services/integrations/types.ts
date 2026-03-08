export interface IntegrationService {
  saveToken(integration: string, credentials: Record<string, string>): Promise<void>
  deleteToken(integration: string): Promise<void>
  getStatus(integration: string): Promise<boolean>
  getAllStatuses(): Promise<Record<string, boolean>>
  validateToken(
    integration: string,
    credentials: Record<string, string>
  ): Promise<string>
  startOAuthFlow(
    integration: string,
    credentials: Record<string, string>
  ): Promise<string>
}
