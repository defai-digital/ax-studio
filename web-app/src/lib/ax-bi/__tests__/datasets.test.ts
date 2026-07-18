import { describe, expect, it, vi } from 'vitest'
import { connectAxBiMcpServer, listAxBiDatasets } from '../datasets'

describe('ax-bi datasets', () => {
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
        url: 'localhost:8088',
      })
    ).resolves.toBe('http://localhost:5008/mcp')

    expect(updateMCPConfig).toHaveBeenCalledWith(
      expect.stringContaining('"ax-bi"')
    )
    expect(activateMCPServer).toHaveBeenCalledWith(
      'ax-bi',
      expect.objectContaining({
        type: 'http',
        url: 'http://localhost:5008/mcp',
        active: true,
      })
    )
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
        url: 'http://localhost:5008/mcp/',
      })
    ).resolves.toBe('http://localhost:5008/mcp')
  })

  it('preserves existing AX BI authentication and timeout settings', async () => {
    const updateMCPConfig = vi.fn().mockResolvedValue(undefined)
    const activateMCPServer = vi.fn().mockResolvedValue(undefined)
    const serviceHub = {
      mcp: () => ({
        getMCPConfig: vi.fn().mockResolvedValue({
          mcpServers: {
            'ax-bi': {
              type: 'http',
              url: 'https://old.example.com/mcp',
              headers: { Authorization: 'Bearer configured-token' },
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
      headers: { Authorization: 'Bearer configured-token' },
      timeout: 45,
      managed: true,
      active: true,
    })
    expect(activateMCPServer).toHaveBeenCalledWith(
      'ax-bi',
      expect.objectContaining({
        headers: { Authorization: 'Bearer configured-token' },
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
