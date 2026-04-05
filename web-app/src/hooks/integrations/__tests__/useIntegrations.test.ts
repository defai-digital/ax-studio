import { describe, it, expect, vi, beforeEach } from 'vitest'

// These mock functions must be declared with vi.hoisted so they're available
// inside vi.mock factories (which are hoisted above imports)
const {
  mockSaveToken,
  mockDeleteToken,
  mockGetAllStatuses,
  mockValidateToken,
  mockStartOAuthFlow,
  mockActivateMCPServer,
  mockDeactivateMCPServer,
  mockGetMCPConfig,
  mockUpdateMCPConfig,
  mockGetConnectedServers,
} = vi.hoisted(() => ({
  mockSaveToken: vi.fn(),
  mockDeleteToken: vi.fn(),
  mockGetAllStatuses: vi.fn(),
  mockValidateToken: vi.fn(),
  mockStartOAuthFlow: vi.fn(),
  mockActivateMCPServer: vi.fn().mockResolvedValue(undefined),
  mockDeactivateMCPServer: vi.fn().mockResolvedValue(undefined),
  mockGetMCPConfig: vi.fn().mockResolvedValue({ mcpServers: {}, mcpSettings: {} }),
  mockUpdateMCPConfig: vi.fn().mockResolvedValue(undefined),
  mockGetConnectedServers: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/integrations/default', () => ({
  DefaultIntegrationsService: vi.fn().mockImplementation(() => ({
    saveToken: mockSaveToken,
    deleteToken: mockDeleteToken,
    getAllStatuses: mockGetAllStatuses,
    validateToken: mockValidateToken,
    startOAuthFlow: mockStartOAuthFlow,
  })),
}))

vi.mock('@/lib/integrations-registry', () => ({
  INTEGRATIONS: [
    {
      id: 'linear',
      name: 'Linear',
      mcpCommand: 'npx',
      mcpArgs: ['-y', 'linear-mcp-server'],
    },
    {
      id: 'postgres',
      name: 'PostgreSQL',
      mcpCommand: 'npx',
      mcpArgs: ['-y', '@modelcontextprotocol/server-postgres'],
    },
    {
      id: 'google-workspace',
      name: 'Google Workspace',
      mcpCommand: 'npx',
      mcpArgs: ['-y', 'google-workspace-mcp', 'serve'],
      authType: 'oauth2',
    },
  ],
  getIntegration: vi.fn((id: string) => {
    const integrations: Record<string, unknown> = {
      linear: {
        id: 'linear',
        name: 'Linear',
        mcpCommand: 'npx',
        mcpArgs: ['-y', 'linear-mcp-server'],
      },
      postgres: {
        id: 'postgres',
        name: 'PostgreSQL',
        mcpCommand: 'npx',
        mcpArgs: ['-y', '@modelcontextprotocol/server-postgres'],
      },
      'google-workspace': {
        id: 'google-workspace',
        name: 'Google Workspace',
        mcpCommand: 'npx',
        mcpArgs: ['-y', 'google-workspace-mcp', 'serve'],
        authType: 'oauth2',
      },
    }
    return integrations[id]
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    mcp: () => ({
      activateMCPServer: mockActivateMCPServer,
      deactivateMCPServer: mockDeactivateMCPServer,
      getMCPConfig: mockGetMCPConfig,
      updateMCPConfig: mockUpdateMCPConfig,
      getConnectedServers: mockGetConnectedServers,
    }),
  }),
  useServiceHub: vi.fn(),
}))

import { useIntegrations } from '../useIntegrations'

describe('useIntegrations store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store
    useIntegrations.setState({
      statuses: {
        linear: 'idle',
        postgres: 'idle',
        'google-workspace': 'idle',
      },
      errors: {},
    })
  })

  it('should initialize with idle statuses for all integrations', () => {
    const state = useIntegrations.getState()

    expect(state.statuses.linear).toBe('idle')
    expect(state.statuses.postgres).toBe('idle')
    expect(state.statuses['google-workspace']).toBe('idle')
  })

  describe('refreshStatuses', () => {
    it('should set connected status when credentials and MCP server are connected', async () => {
      mockGetAllStatuses.mockResolvedValue({ linear: true, postgres: false })
      mockGetConnectedServers.mockResolvedValue(['integration-linear'])

      await useIntegrations.getState().refreshStatuses()

      const state = useIntegrations.getState()
      expect(state.statuses.linear).toBe('connected')
      expect(state.statuses.postgres).toBe('idle')
    })

    it('should set connecting status when credentials exist but server not connected', async () => {
      mockGetAllStatuses.mockResolvedValue({ linear: true })
      mockGetConnectedServers.mockResolvedValue([])

      await useIntegrations.getState().refreshStatuses()

      expect(useIntegrations.getState().statuses.linear).toBe('connecting')
    })

    it('should handle MCP service unavailability gracefully', async () => {
      mockGetAllStatuses.mockResolvedValue({ linear: true })
      mockGetConnectedServers.mockRejectedValue(new Error('MCP unavailable'))

      await useIntegrations.getState().refreshStatuses()

      // Should still work, treating all as not connected
      expect(useIntegrations.getState().statuses.linear).toBe('connecting')
    })

    it('should handle getAllStatuses failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockGetAllStatuses.mockRejectedValue(new Error('Service error'))

      await useIntegrations.getState().refreshStatuses()

      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('connect', () => {
    it('should save credentials, activate MCP server, and persist config', async () => {
      mockSaveToken.mockResolvedValue(undefined)
      mockGetMCPConfig.mockResolvedValue({ mcpServers: {}, mcpSettings: {} })

      await useIntegrations.getState().connect('linear', {
        LINEAR_API_KEY: 'lin_api_test123',
      })

      expect(mockSaveToken).toHaveBeenCalledWith('linear', {
        LINEAR_API_KEY: 'lin_api_test123',
      })
      expect(mockActivateMCPServer).toHaveBeenCalledWith(
        'integration-linear',
        expect.objectContaining({
          command: 'npx',
          args: ['-y', 'linear-mcp-server'],
          active: true,
          managed: true,
          integration: 'linear',
        })
      )
      expect(mockUpdateMCPConfig).toHaveBeenCalled()
      expect(useIntegrations.getState().statuses.linear).toBe('connected')
    })

    it('should append postgres connection string to args', async () => {
      mockSaveToken.mockResolvedValue(undefined)
      mockGetMCPConfig.mockResolvedValue({ mcpServers: {}, mcpSettings: {} })

      await useIntegrations.getState().connect('postgres', {
        POSTGRES_CONNECTION_STRING: 'postgresql://user:pass@host:5432/db',
      })

      expect(mockActivateMCPServer).toHaveBeenCalledWith(
        'integration-postgres',
        expect.objectContaining({
          args: [
            '-y',
            '@modelcontextprotocol/server-postgres',
            'postgresql://user:pass@host:5432/db',
          ],
        })
      )
    })

    it('should set error status on failure', async () => {
      mockSaveToken.mockRejectedValue(new Error('Stronghold locked'))

      await expect(
        useIntegrations.getState().connect('linear', { LINEAR_API_KEY: 'key' })
      ).rejects.toThrow('Stronghold locked')

      const state = useIntegrations.getState()
      expect(state.statuses.linear).toBe('error')
      expect(state.errors.linear).toBe('Stronghold locked')
    })

    it('should throw on unknown integration', async () => {
      await expect(
        useIntegrations.getState().connect('unknown', {})
      ).rejects.toThrow('Unknown integration: unknown')
    })

    it('should set connecting status before attempting connection', async () => {
      let capturedStatus: string | undefined
      mockSaveToken.mockImplementation(async () => {
        capturedStatus = useIntegrations.getState().statuses.linear
      })
      mockGetMCPConfig.mockResolvedValue({ mcpServers: {}, mcpSettings: {} })

      await useIntegrations.getState().connect('linear', {
        LINEAR_API_KEY: 'key',
      })

      expect(capturedStatus).toBe('connecting')
    })
  })

  describe('connectOAuth', () => {
    it('should run OAuth flow, activate server, and persist config', async () => {
      mockStartOAuthFlow.mockResolvedValue('auth-token')
      mockGetMCPConfig.mockResolvedValue({ mcpServers: {}, mcpSettings: {} })

      await useIntegrations.getState().connectOAuth('google-workspace', {
        client_id: 'id',
        client_secret: 'secret',
      })

      expect(mockStartOAuthFlow).toHaveBeenCalledWith('google-workspace', {
        client_id: 'id',
        client_secret: 'secret',
      })
      expect(mockActivateMCPServer).toHaveBeenCalledWith(
        'integration-google-workspace',
        expect.objectContaining({
          command: 'npx',
          args: ['-y', 'google-workspace-mcp', 'serve'],
          integration: 'google-workspace',
        })
      )
      expect(useIntegrations.getState().statuses['google-workspace']).toBe(
        'connected'
      )
    })

    it('should set error status on OAuth failure', async () => {
      mockStartOAuthFlow.mockRejectedValue(new Error('OAuth cancelled'))

      await expect(
        useIntegrations.getState().connectOAuth('google-workspace', {
          client_id: 'id',
          client_secret: 'secret',
        })
      ).rejects.toThrow('OAuth cancelled')

      expect(useIntegrations.getState().statuses['google-workspace']).toBe(
        'error'
      )
      expect(useIntegrations.getState().errors['google-workspace']).toBe(
        'OAuth cancelled'
      )
    })

    it('should throw on unknown integration', async () => {
      await expect(
        useIntegrations.getState().connectOAuth('unknown', {})
      ).rejects.toThrow('Unknown integration: unknown')
    })
  })

  describe('disconnect', () => {
    it('should deactivate server, remove config, and delete credentials', async () => {
      mockGetMCPConfig.mockResolvedValue({
        mcpServers: { 'integration-linear': { command: 'npx' } },
        mcpSettings: {},
      })

      await useIntegrations.getState().disconnect('linear')

      expect(mockDeactivateMCPServer).toHaveBeenCalledWith('integration-linear')
      expect(mockUpdateMCPConfig).toHaveBeenCalled()
      expect(mockDeleteToken).toHaveBeenCalledWith('linear')
      expect(useIntegrations.getState().statuses.linear).toBe('idle')
      expect(useIntegrations.getState().errors.linear).toBe('')
    })

    it('should set error on disconnect failure', async () => {
      mockDeactivateMCPServer.mockRejectedValue(new Error('Server busy'))

      await expect(
        useIntegrations.getState().disconnect('linear')
      ).rejects.toThrow('Server busy')

      expect(useIntegrations.getState().errors.linear).toBe('Server busy')
    })
  })

  describe('testConnection', () => {
    it('should validate token and return result', async () => {
      mockValidateToken.mockResolvedValue('valid')

      const result = await useIntegrations
        .getState()
        .testConnection('linear', { LINEAR_API_KEY: 'key' })

      expect(result).toBe('valid')
      expect(mockValidateToken).toHaveBeenCalledWith('linear', {
        LINEAR_API_KEY: 'key',
      })
    })
  })
})
