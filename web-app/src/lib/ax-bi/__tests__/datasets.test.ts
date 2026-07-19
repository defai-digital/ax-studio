import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectAxBiMcpServer,
  hasConfiguredAxBiMcpToken,
  listAxBiDatasets,
} from '../datasets'

const tokenStorageMocks = vi.hoisted(() => ({
  read: vi.fn(),
  store: vi.fn(),
}))

vi.mock('../token-storage', () => ({
  readStoredAxBiMcpToken: tokenStorageMocks.read,
  storeAxBiMcpToken: tokenStorageMocks.store,
}))

describe('ax-bi datasets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tokenStorageMocks.read.mockReturnValue('stored-ax-bi-token')
  })

  function makeDatasetServiceHub(result: unknown) {
    const callTool = vi.fn().mockResolvedValue(result)
    const serviceHub = {
      mcp: () => ({
        getTools: vi
          .fn()
          .mockResolvedValue([{ server: 'ax-bi', name: 'list_datasets' }]),
        callTool,
      }),
    }
    return { serviceHub, callTool }
  }

  it('parses dataset records from nested MCP results', async () => {
    const { serviceHub } = makeDatasetServiceHub({
      error: '',
      content: [
        {
          text: JSON.stringify({
            result: {
              data: [
                {
                  id: 1,
                  table_name: 'sales',
                  schema: 'public',
                  database_name: 'warehouse',
                },
              ],
            },
          }),
        },
      ],
    })

    await expect(
      listAxBiDatasets({ serviceHub: serviceHub as never })
    ).resolves.toEqual([
      {
        id: 1,
        name: 'sales',
        schema: 'public',
        databaseName: 'warehouse',
        url: undefined,
      },
    ])
  })

  it('keeps dataset records that do not include an id', async () => {
    const { serviceHub } = makeDatasetServiceHub({
      error: '',
      content: [
        {
          text: JSON.stringify({
            datasets: [
              {
                table_name: 'inventory',
                schema: 'ops',
              },
              {
                dataset_name: 'customers',
              },
            ],
          }),
        },
      ],
    })

    await expect(
      listAxBiDatasets({ serviceHub: serviceHub as never })
    ).resolves.toEqual([
      {
        id: undefined,
        name: 'inventory',
        schema: 'ops',
        databaseName: undefined,
        url: undefined,
      },
      {
        id: undefined,
        name: 'customers',
        schema: undefined,
        databaseName: undefined,
        url: undefined,
      },
    ])
  })

  it('does not merge id-less datasets with the same name in different schemas', async () => {
    const { serviceHub } = makeDatasetServiceHub({
      error: '',
      content: [
        {
          text: JSON.stringify({
            datasets: [
              { table_name: 'orders', schema: 'sales' },
              { table_name: 'orders', schema: 'finance' },
            ],
          }),
        },
      ],
    })

    await expect(
      listAxBiDatasets({ serviceHub: serviceHub as never })
    ).resolves.toEqual([
      {
        id: undefined,
        name: 'orders',
        schema: 'sales',
        databaseName: undefined,
        url: undefined,
      },
      {
        id: undefined,
        name: 'orders',
        schema: 'finance',
        databaseName: undefined,
        url: undefined,
      },
    ])
  })

  it('connects the ax-bi MCP server with the normalized URL', async () => {
    const updateMCPConfig = vi.fn().mockResolvedValue(undefined)
    const activateMCPServer = vi.fn().mockResolvedValue(undefined)
    const serviceHub = {
      mcp: () => ({
        getMCPConfig: vi.fn().mockResolvedValue({
          mcpServers: {
            exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' },
          },
          mcpSettings: { toolCallTimeoutSeconds: 30 },
        }),
        updateMCPConfig,
        activateMCPServer,
      }),
    }

    await expect(
      connectAxBiMcpServer({
        serviceHub: serviceHub as never,
        url: 'localhost:31423',
      })
    ).resolves.toBe('http://localhost:31421/mcp')

    expect(updateMCPConfig).toHaveBeenCalledWith(
      expect.stringContaining('"ax-bi"')
    )
    expect(activateMCPServer).toHaveBeenCalledWith(
      'ax-bi',
      expect.objectContaining({
        type: 'http',
        url: 'http://localhost:31421/mcp',
        active: true,
        headers: { Authorization: 'Bearer stored-ax-bi-token' },
      })
    )
  })

  it('stores a supplied token encrypted and keeps it out of MCP config', async () => {
    const updateMCPConfig = vi.fn().mockResolvedValue(undefined)
    const activateMCPServer = vi.fn().mockResolvedValue(undefined)
    const serviceHub = {
      mcp: () => ({
        getMCPConfig: vi.fn().mockResolvedValue({}),
        updateMCPConfig,
        activateMCPServer,
      }),
    }

    await connectAxBiMcpServer({
      serviceHub: serviceHub as never,
      url: 'http://127.0.0.1:31421/mcp',
      token: '  sst_full-secret-token  ',
    })

    expect(tokenStorageMocks.store).toHaveBeenCalledWith(
      'sst_full-secret-token'
    )
    const persistedConfig = updateMCPConfig.mock.calls[0][0]
    expect(persistedConfig).not.toContain('sst_full-secret-token')
    expect(JSON.parse(persistedConfig).mcpServers['ax-bi']).not.toHaveProperty(
      'headers.Authorization'
    )
    expect(activateMCPServer.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer sst_full-secret-token' },
    })
  })

  it('rejects unsafe token header material', async () => {
    const serviceHub = {
      mcp: () => ({
        getMCPConfig: vi.fn().mockResolvedValue({}),
        updateMCPConfig: vi.fn(),
        activateMCPServer: vi.fn(),
      }),
    }

    await expect(
      connectAxBiMcpServer({
        serviceHub: serviceHub as never,
        url: 'http://127.0.0.1:31421/mcp',
        token: 'bad\ntoken',
      })
    ).rejects.toThrow('contains invalid characters')
    expect(tokenStorageMocks.store).not.toHaveBeenCalled()
  })

  it('requires a token when none is stored locally', async () => {
    tokenStorageMocks.read.mockReturnValue(null)
    const serviceHub = {
      mcp: () => ({
        getMCPConfig: vi.fn().mockResolvedValue({}),
        updateMCPConfig: vi.fn(),
        activateMCPServer: vi.fn(),
      }),
    }

    await expect(
      connectAxBiMcpServer({
        serviceHub: serviceHub as never,
        url: 'http://127.0.0.1:31421/mcp',
      })
    ).rejects.toThrow('AX BI API key or JWT is required')
  })

  it('reports whether an encrypted AX BI token is stored locally', async () => {
    await expect(hasConfiguredAxBiMcpToken()).resolves.toBe(true)
    tokenStorageMocks.read.mockReturnValue(null)
    await expect(hasConfiguredAxBiMcpToken()).resolves.toBe(false)
  })

  it('preserves already normalized AX BI MCP URLs when connecting', async () => {
    const updateMCPConfig = vi.fn().mockResolvedValue(undefined)
    const activateMCPServer = vi.fn().mockResolvedValue(undefined)
    const serviceHub = {
      mcp: () => ({
        getMCPConfig: vi.fn().mockResolvedValue({}),
        updateMCPConfig,
        activateMCPServer,
      }),
    }

    await expect(
      connectAxBiMcpServer({
        serviceHub: serviceHub as never,
        url: 'http://localhost:31421/mcp/',
      })
    ).resolves.toBe('http://localhost:31421/mcp')
  })

  it('replaces plaintext AX BI authentication while preserving other settings', async () => {
    const updateMCPConfig = vi.fn().mockResolvedValue(undefined)
    const activateMCPServer = vi.fn().mockResolvedValue(undefined)
    const serviceHub = {
      mcp: () => ({
        getMCPConfig: vi.fn().mockResolvedValue({
          mcpServers: {
            'ax-bi': {
              type: 'http',
              url: 'https://old.example.com/mcp',
              headers: {
                Authorization: 'Bearer configured-token',
                'X-Tenant': 'north',
              },
              timeout: 45,
              managed: true,
            },
          },
        }),
        updateMCPConfig,
        activateMCPServer,
      }),
    }

    await connectAxBiMcpServer({
      serviceHub: serviceHub as never,
      url: 'https://bi.example.com/mcp',
    })

    const saved = JSON.parse(updateMCPConfig.mock.calls[0][0])
    expect(saved.mcpServers['ax-bi']).toMatchObject({
      url: 'https://bi.example.com/mcp',
      headers: { 'X-Tenant': 'north' },
      timeout: 45,
      managed: true,
      active: true,
    })
    expect(activateMCPServer).toHaveBeenCalledWith(
      'ax-bi',
      expect.objectContaining({
        headers: {
          'X-Tenant': 'north',
          Authorization: 'Bearer stored-ax-bi-token',
        },
        timeout: 45,
      })
    )
  })

  it('uses list_datasets when available', async () => {
    const callTool = vi.fn().mockResolvedValue({
      error: '',
      content: [
        { text: JSON.stringify({ datasets: [{ id: 'd1', name: 'orders' }] }) },
      ],
    })
    const serviceHub = {
      mcp: () => ({
        getTools: vi
          .fn()
          .mockResolvedValue([{ server: 'ax-bi', name: 'list_datasets' }]),
        callTool,
      }),
    }

    await expect(
      listAxBiDatasets({
        serviceHub: serviceHub as never,
        search: 'orders',
      })
    ).resolves.toEqual([{ id: 'd1', name: 'orders' }])

    expect(callTool).toHaveBeenCalledWith({
      serverName: 'ax-bi',
      toolName: 'list_datasets',
      arguments: expect.objectContaining({
        request: expect.objectContaining({ search: 'orders' }),
      }),
    })
  })

  it('throws when list_datasets returns isError without a top-level error string', async () => {
    const { serviceHub } = makeDatasetServiceHub({
      error: '',
      isError: true,
      content: [{ text: 'access denied' }],
    })

    await expect(
      listAxBiDatasets({ serviceHub: serviceHub as never })
    ).rejects.toThrow('access denied')
  })
})
