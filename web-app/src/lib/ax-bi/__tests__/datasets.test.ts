import { describe, expect, it, vi } from 'vitest'
import {
  connectAxBiMcpServer,
  listAxBiDatasets,
  normalizeAxBiMcpUrl,
  parseAxBiDatasetList,
} from '../datasets'

describe('ax-bi datasets', () => {
  it('normalizes MCP URLs', () => {
    expect(normalizeAxBiMcpUrl('127.0.0.1:8088')).toBe(
      'http://127.0.0.1:8088/mcp'
    )
    expect(normalizeAxBiMcpUrl('http://localhost:8088/mcp/')).toBe(
      'http://localhost:8088/mcp'
    )
  })

  it('parses dataset records from nested MCP results', () => {
    const datasets = parseAxBiDatasetList({
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

    expect(datasets).toEqual([
      {
        id: 1,
        name: 'sales',
        schema: 'public',
        databaseName: 'warehouse',
        url: undefined,
      },
    ])
  })

  it('keeps dataset records that do not include an id', () => {
    const datasets = parseAxBiDatasetList({
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

    expect(datasets).toEqual([
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

  it('does not merge id-less datasets with the same name in different schemas', () => {
    const datasets = parseAxBiDatasetList({
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

    expect(datasets).toEqual([
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
    ).resolves.toBe('http://localhost:8088/mcp')

    expect(updateMCPConfig).toHaveBeenCalledWith(
      expect.stringContaining('"ax-bi"')
    )
    expect(activateMCPServer).toHaveBeenCalledWith(
      'ax-bi',
      expect.objectContaining({
        type: 'http',
        url: 'http://localhost:8088/mcp',
        active: true,
      })
    )
  })

  it('uses list_datasets when available', async () => {
    const callTool = vi.fn().mockResolvedValue({
      error: '',
      content: [{ text: JSON.stringify({ datasets: [{ id: 'd1', name: 'orders' }] }) }],
    })
    const serviceHub = {
      mcp: () => ({
        getTools: vi.fn().mockResolvedValue([
          { server: 'ax-bi', name: 'list_datasets' },
        ]),
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
})
