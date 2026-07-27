import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AX_BI_MCP_URL,
  getConfiguredAxBiMcpUrl,
  hasConfiguredAxBiMcpToken,
  listAxBiDatasets,
  normalizeAxBiToken,
} from '../datasets'
import { getDirectAxBiClient } from '../direct-client'

const tokenStorageMocks = vi.hoisted(() => ({
  has: vi.fn(),
}))

vi.mock('../token-storage', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../token-storage')>()
  return {
    ...actual,
    hasStoredAxBiMcpToken: tokenStorageMocks.has,
  }
})

vi.mock('../direct-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../direct-client')>()
  return {
    ...actual,
    getDirectAxBiClient: vi.fn(),
  }
})

function makeDirectClient(result: unknown) {
  const callTool = vi.fn().mockResolvedValue(result)
  vi.mocked(getDirectAxBiClient).mockResolvedValue({
    ai: { callTool },
  } as never)
  return callTool
}

describe('ax-bi datasets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tokenStorageMocks.has.mockResolvedValue(true)
  })

  it('parses dataset records from nested MCP results', async () => {
    makeDirectClient({
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

    await expect(listAxBiDatasets()).resolves.toEqual([
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
    makeDirectClient({
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

    await expect(listAxBiDatasets()).resolves.toEqual([
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
    makeDirectClient({
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

    await expect(listAxBiDatasets()).resolves.toEqual([
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

  it('calls list_datasets on the direct client with the search request', async () => {
    const callTool = makeDirectClient({
      error: '',
      content: [
        { text: JSON.stringify({ datasets: [{ id: 'd1', name: 'orders' }] }) },
      ],
    })

    await expect(listAxBiDatasets({ search: 'orders' })).resolves.toEqual([
      {
        id: 'd1',
        name: 'orders',
        schema: undefined,
        databaseName: undefined,
        url: undefined,
      },
    ])

    expect(getDirectAxBiClient).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledWith('list_datasets', {
      request: expect.objectContaining({
        search: 'orders',
        page: 1,
        page_size: 50,
      }),
    })
  })

  it('throws when list_datasets returns isError without a top-level error string', async () => {
    makeDirectClient({
      error: '',
      isError: true,
      content: [{ text: 'access denied' }],
    })

    await expect(listAxBiDatasets()).rejects.toThrow('access denied')
  })

  it('reports whether an AX BI token is stored locally', async () => {
    await expect(hasConfiguredAxBiMcpToken()).resolves.toBe(true)
    tokenStorageMocks.has.mockResolvedValue(false)
    await expect(hasConfiguredAxBiMcpToken()).resolves.toBe(false)
  })

  it('exposes the configured MCP URL synchronously', () => {
    // Zero-config: no arguments, defaults to the hidden local AX BI stack.
    expect(getConfiguredAxBiMcpUrl()).toBe(DEFAULT_AX_BI_MCP_URL)
  })

  it('strips optional Bearer prefix from tokens (case-insensitive)', () => {
    expect(normalizeAxBiToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(normalizeAxBiToken('bearer  tok ')).toBe('tok')
    expect(normalizeAxBiToken('BEARER sst_secret')).toBe('sst_secret')
    expect(normalizeAxBiToken('  plain-token  ')).toBe('plain-token')
  })
})
