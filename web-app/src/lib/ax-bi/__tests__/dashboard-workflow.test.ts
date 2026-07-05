import { describe, expect, it, vi } from 'vitest'
import {
  runAxBiDashboardWorkflow,
  runAxBiExistingDatasetChartWorkflow,
  runAxBiSdkPromptWorkflow,
} from '../dashboard-workflow'
import type { Attachment } from '@/types/attachment'

const csvAttachment: Attachment = {
  type: 'document',
  name: 'sales.csv',
  fileType: 'csv',
  path: '/tmp/sales.csv',
  processed: true,
  id: 'file-1',
}

describe('AX-BI dashboard workflow', () => {
  it('handles dashboard requests with supported data attachments', async () => {
    const result = await runAxBiDashboardWorkflow({
      prompt: 'Can you create a dashboard from this file?',
      attachments: [csvAttachment],
      serviceHub: {
        mcp: () => ({
          getTools: async () => [],
        }),
      } as never,
    })

    expect(result).toMatchObject({
      handled: true,
      message: expect.stringContaining('required tool "upload_file"'),
    })
  })

  it('does not intercept ordinary attachment questions', async () => {
    const result = await runAxBiDashboardWorkflow({
      prompt: 'Summarize this file for me',
      attachments: [csvAttachment],
      serviceHub: {} as never,
    })

    expect(result).toEqual({ handled: false })
  })

  it('does not intercept dashboard requests without data attachments', async () => {
    const result = await runAxBiDashboardWorkflow({
      prompt: 'Create a dashboard',
      attachments: [],
      serviceHub: {} as never,
    })

    expect(result).toEqual({ handled: false })
  })

  it('does not intercept existing AX-BI dataset chart requests', async () => {
    const result = await runAxBiDashboardWorkflow({
      prompt:
        'Use AX-BI MCP. Create a saved bar chart from palmer_penguins showing count of records by species.',
      attachments: [csvAttachment],
      serviceHub: {} as never,
    })

    expect(result).toEqual({ handled: false })
  })

  it('plans an AX-BI dashboard through the SDK client', async () => {
    const planDashboard = vi.fn().mockResolvedValue({
      title: 'Revenue Dashboard',
      description: 'Revenue and region performance.',
      sections: [
        {
          title: 'Revenue',
          chart_intents: [
            {
              metric: 'revenue',
              dimension: 'region',
              chart_type: 'bar',
            },
          ],
        },
      ],
      assumptions: ['Using certified datasets first.'],
      clarifying_questions: ['Which fiscal period should be used?'],
      confidence_score: 0.82,
    })

    const result = await runAxBiSdkPromptWorkflow({
      prompt: 'Prompt AX-BI to plan a revenue dashboard by region',
      serviceHub: {} as never,
      client: {
        ai: { planDashboard },
      },
    })

    expect(planDashboard).toHaveBeenCalledWith({
      prompt: 'Prompt AX-BI to plan a revenue dashboard by region',
    })
    expect(result).toMatchObject({
      handled: true,
      message: expect.stringContaining('Revenue Dashboard'),
    })
    if (result.handled) {
      expect(result.message).toContain('bar: revenue by region')
      expect(result.message).toContain('Confidence: 82%')
    }
  })

  it('does not intercept ordinary prompts through the SDK workflow', async () => {
    const planDashboard = vi.fn()

    const result = await runAxBiSdkPromptWorkflow({
      prompt: 'Summarize this note',
      serviceHub: {} as never,
      client: {
        ai: { planDashboard },
      },
    })

    expect(result).toEqual({ handled: false })
    expect(planDashboard).not.toHaveBeenCalled()
  })

  it('creates an existing-dataset count bar chart through AX-BI MCP directly', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          {
            server: 'ax-bi',
            name: 'list_datasets',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'get_dataset_info',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'generate_chart',
            description: '',
            inputSchema: {},
          },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    result: [{ id: 12, table_name: 'palmer_penguins' }],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'get_dataset_info') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    columns: [
                      { name: 'species', type: 'TEXT' },
                      { name: 'body_mass_g', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          return {
            error: '',
            content: [
              {
                text: JSON.stringify({
                  chart_id: 99,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=99',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Use AX-BI MCP only. Find dataset palmer_penguins. Create a saved bar chart showing COUNT(*) by species. Name it Test - Penguins Count by Species.',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/explore/?slice_id=99',
    })
    expect(calls[0]).toMatchObject({
      toolName: 'list_datasets',
      arguments: { request: { search: 'palmer_penguins' } },
    })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          dataset_id: 12,
          chart_name: 'Test - Penguins Count by Species',
          save_chart: true,
          config: {
            chart_type: 'xy',
            x: { name: 'species' },
            y: [{ sql_expression: 'COUNT(*)', label: 'Count' }],
            kind: 'bar',
          },
        },
      },
    })
  })

  it('creates an existing-dataset average bar chart through AX-BI MCP directly', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          {
            server: 'ax-bi',
            name: 'list_datasets',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'get_dataset_info',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'generate_chart',
            description: '',
            inputSchema: {},
          },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [{ id: 22, table_name: 'palmer_penguins' }],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'get_dataset_info') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    columns: [
                      { name: 'species', type: 'TEXT' },
                      { name: 'body_mass_g', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          return {
            error: '',
            content: [
              {
                text: JSON.stringify({
                  chart_id: 114,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=114',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Use AX-BI MCP. Create a saved bar chart from palmer_penguins showing average body_mass_g by species. Name it Test - Avg Body Mass by Species.',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/explore/?slice_id=114',
    })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          dataset_id: 22,
          chart_name: 'Test - Avg Body Mass by Species',
          save_chart: true,
          config: {
            chart_type: 'xy',
            x: { name: 'species' },
            y: [
              {
                name: 'body_mass_g',
                aggregate: 'AVG',
                label: 'AVG(body_mass_g)',
              },
            ],
            kind: 'bar',
          },
        },
      },
    })
  })

  it('creates an existing-dataset chart from model-extracted intent', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const intentExtractor = vi.fn(async () => ({
      datasetName: 'palmer_penguins',
      chartName: 'Test - Mean Body Mass by Species',
      groupBy: 'species',
      chartKind: 'bar' as const,
      metric: {
        type: 'aggregate' as const,
        aggregate: 'AVG' as const,
        column: 'body_mass_g',
      },
    }))
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          {
            server: 'ax-bi',
            name: 'list_datasets',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'get_dataset_info',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'generate_chart',
            description: '',
            inputSchema: {},
          },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [{ id: 22, table_name: 'palmer_penguins' }],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'get_dataset_info') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    columns: [
                      { name: 'species', type: 'TEXT' },
                      { name: 'body_mass_g', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          return {
            error: '',
            content: [
              {
                text: JSON.stringify({
                  chart_id: 115,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=115',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Use AX-BI MCP. Build me a saved chart for palmer_penguins with mean body mass grouped per species and call it Test - Mean Body Mass by Species.',
      serviceHub: serviceHub as never,
      intentExtractor,
    })

    expect(intentExtractor).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/explore/?slice_id=115',
    })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          dataset_id: 22,
          chart_name: 'Test - Mean Body Mass by Species',
          config: {
            x: { name: 'species' },
            y: [
              {
                name: 'body_mass_g',
                aggregate: 'AVG',
                label: 'AVG(body_mass_g)',
              },
            ],
          },
        },
      },
    })
  })

  it('creates an existing-dataset scatter chart from model-extracted intent', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const intentExtractor = vi.fn(async () => ({
      datasetName: 'palmer_penguins',
      chartName: 'Test - Bill vs Flipper by Species',
      chartKind: 'scatter' as const,
      xColumn: 'bill_length_mm',
      yColumn: 'flipper_length_mm',
      groupBy: 'species',
    }))
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          {
            server: 'ax-bi',
            name: 'list_datasets',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'get_dataset_info',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'generate_chart',
            description: '',
            inputSchema: {},
          },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [{ id: 22, table_name: 'palmer_penguins' }],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'get_dataset_info') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    columns: [
                      { name: 'species', type: 'TEXT' },
                      { name: 'bill_length_mm', type: 'FLOAT' },
                      { name: 'flipper_length_mm', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          return {
            error: '',
            content: [
              {
                text: JSON.stringify({
                  chart_id: 116,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=116',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Use AX-BI MCP. Create a saved scatter chart from palmer_penguins with bill_length_mm on x-axis and flipper_length_mm on y-axis, grouped by species. Name it Test - Bill vs Flipper by Species.',
      serviceHub: serviceHub as never,
      intentExtractor,
    })

    expect(intentExtractor).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/explore/?slice_id=116',
    })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          dataset_id: 22,
          chart_name: 'Test - Bill vs Flipper by Species',
          config: {
            chart_type: 'xy',
            x: { name: 'bill_length_mm' },
            y: [{ name: 'flipper_length_mm', label: 'Flipper Length Mm' }],
            kind: 'scatter',
            group_by: [{ name: 'species' }],
          },
        },
      },
    })
  })

  it('falls back to deterministic scatter parsing when model intent extraction fails', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const intentExtractor = vi.fn(async () => null)
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          {
            server: 'ax-bi',
            name: 'list_datasets',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'get_dataset_info',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'generate_chart',
            description: '',
            inputSchema: {},
          },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [{ id: 22, table_name: 'palmer_penguins' }],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'get_dataset_info') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    columns: [
                      { name: 'species', type: 'TEXT' },
                      { name: 'bill_length_mm', type: 'FLOAT' },
                      { name: 'flipper_length_mm', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          return {
            error: '',
            content: [
              {
                text: JSON.stringify({
                  chart_id: 117,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=117',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Use AX-BI MCP. Create a saved scatter chart from palmer_penguins with bill_length_mm on x-axis and flipper_length_mm on y-axis, grouped by species. Name it Test - Bill vs Flipper by Species.',
      serviceHub: serviceHub as never,
      intentExtractor,
    })

    expect(intentExtractor).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/explore/?slice_id=117',
    })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          dataset_id: 22,
          chart_name: 'Test - Bill vs Flipper by Species',
          config: {
            chart_type: 'xy',
            x: { name: 'bill_length_mm' },
            y: [{ name: 'flipper_length_mm', label: 'Flipper Length Mm' }],
            kind: 'scatter',
            group_by: [{ name: 'species' }],
          },
        },
      },
    })
  })

  it('creates an existing-dataset chart through the AX-BI call_tool proxy', async () => {
    const calls: Array<{
      toolName: string
      arguments: Record<string, unknown>
    }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          {
            server: 'ax-bi',
            name: 'search_tools',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'call_tool',
            description: '',
            inputSchema: {},
          },
        ],
        callTool: async (args: {
          toolName: string
          arguments: Record<string, unknown>
        }) => {
          calls.push(args)
          if (args.toolName !== 'call_tool')
            throw new Error('Expected call_tool proxy')
          if (args.arguments.name === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    result: [{ id: 12, table_name: 'palmer_penguins' }],
                  }),
                },
              ],
            }
          }
          if (args.arguments.name === 'get_dataset_info') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    columns: [
                      { name: 'species', type: 'TEXT' },
                      { name: 'body_mass_g', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          return {
            error: '',
            content: [
              {
                text: JSON.stringify({
                  chart: { id: 99 },
                  explore_url: 'http://127.0.0.1:8080/explore/?slice_id=99',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Use AX-BI MCP only. Find dataset palmer_penguins. Create a saved bar chart showing COUNT(*) by species. Name it Test - Penguins Count by Species.',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/explore/?slice_id=99',
    })
    expect(calls[0]).toMatchObject({
      toolName: 'call_tool',
      arguments: {
        name: 'list_datasets',
        arguments: { request: { search: 'palmer_penguins' } },
      },
    })
    expect(calls[1]).toMatchObject({
      toolName: 'call_tool',
      arguments: {
        name: 'get_dataset_info',
        arguments: { request: { identifier: 12 } },
      },
    })
    expect(calls[2]).toMatchObject({
      toolName: 'call_tool',
      arguments: {
        name: 'generate_chart',
        arguments: {
          request: {
            dataset_id: 12,
            chart_name: 'Test - Penguins Count by Species',
          },
        },
      },
    })
  })

  it('parses structured-only AX-BI chart responses', async () => {
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          {
            server: 'ax-bi',
            name: 'list_datasets',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'get_dataset_info',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'generate_chart',
            description: '',
            inputSchema: {},
          },
        ],
        callTool: async (args: { toolName: string }) => {
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [],
              structuredContent: {
                result: [{ id: 12, table_name: 'palmer_penguins' }],
              },
            }
          }
          if (args.toolName === 'get_dataset_info') {
            return {
              error: '',
              content: [],
              structuredContent: {
                columns: [
                  { name: 'species', type: 'TEXT' },
                  { name: 'body_mass_g', type: 'FLOAT' },
                ],
              },
            }
          }
          return {
            error: '',
            content: [],
            structuredContent: {
              chart: { id: 99 },
              explore_url: 'http://127.0.0.1:8080/explore/?slice_id=99',
            },
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Use AX-BI MCP only. Find dataset palmer_penguins. Create a saved bar chart showing COUNT(*) by species. Name it Test - Penguins Count by Species.',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/explore/?slice_id=99',
    })
  })

  it('falls back to direct AX-BI tool calls when the proxy returns empty content', async () => {
    const calls: string[] = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          {
            server: 'ax-bi',
            name: 'search_tools',
            description: '',
            inputSchema: {},
          },
          {
            server: 'ax-bi',
            name: 'call_tool',
            description: '',
            inputSchema: {},
          },
        ],
        callTool: async (args: { toolName: string }) => {
          calls.push(args.toolName)
          if (args.toolName === 'call_tool') {
            return { error: '', content: [] }
          }
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    result: [{ id: 12, table_name: 'palmer_penguins' }],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'get_dataset_info') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    columns: [
                      { name: 'species', type: 'TEXT' },
                      { name: 'body_mass_g', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          return {
            error: '',
            content: [
              {
                text: JSON.stringify({
                  explore_url: 'http://127.0.0.1:8080/explore/?slice_id=99',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Use AX-BI MCP only. Find dataset palmer_penguins. Create a saved bar chart showing COUNT(*) by species. Name it Test - Penguins Count by Species.',
      serviceHub: serviceHub as never,
    })

    expect(calls).toEqual([
      'call_tool',
      'list_datasets',
      'call_tool',
      'get_dataset_info',
      'call_tool',
      'generate_chart',
    ])
    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/explore/?slice_id=99',
    })
  })
})
