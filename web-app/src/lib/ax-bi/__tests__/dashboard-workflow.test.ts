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

  it('preserves aggregate function column names in existing-dataset chart prompts', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
          {
            server: 'ax-bi',
            name: 'get_dataset_info',
            description: '',
            inputSchema: {},
          },
          { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                      { name: 'day', type: 'TEXT' },
                      { name: 'total_bill', type: 'FLOAT' },
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
                  chart_id: 118,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=118',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Use AX-BI MCP. Create a saved bar chart from upload_restaurant_tips_f0d2d2 showing SUM(total_bill) by day. Name it Tips - Total Bill by Day.',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({ handled: true })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          config: {
            kind: 'bar',
            x: { name: 'day' },
            y: [
              {
                name: 'total_bill',
                aggregate: 'SUM',
                label: 'SUM(total_bill)',
              },
            ],
          },
        },
      },
    })
  })

  it('maps requested pie, line, and horizontal bar chart types to AX-BI configs', async () => {
    const prompts = [
      {
        prompt:
          'Use AX-BI MCP. Create a saved pie chart from restaurant_tips showing count of records by smoker. Name it Tips - Smoker Split.',
        expectedConfig: {
          chart_type: 'pie',
          dimension: { name: 'smoker' },
          metric: { sql_expression: 'COUNT(*)', label: 'Count' },
        },
      },
      {
        prompt:
          'Use AX-BI MCP. Create a saved line chart from restaurant_tips showing average total bill by table size. Name it Tips - Avg Bill by Party Size.',
        expectedConfig: {
          chart_type: 'xy',
          kind: 'line',
          x: { name: 'size' },
          y: [{ name: 'total_bill', aggregate: 'AVG', label: 'AVG(total_bill)' }],
        },
      },
      {
        prompt:
          'Use AX-BI MCP. Create a saved horizontal bar chart from restaurant_tips showing average tip by time. Name it Tips - Average Tip by Meal Time.',
        expectedConfig: {
          chart_type: 'xy',
          kind: 'bar',
          orientation: 'horizontal',
          x: { name: 'time' },
          y: [{ name: 'tip', aggregate: 'AVG', label: 'AVG(tip)' }],
        },
      },
    ]

    for (const { prompt, expectedConfig } of prompts) {
      const calls: Array<{ toolName: string; arguments: object }> = []
      const serviceHub = {
        mcp: () => ({
          getTools: async () => [
            { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
            {
              server: 'ax-bi',
              name: 'get_dataset_info',
              description: '',
              inputSchema: {},
            },
            { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
          ],
          callTool: async (args: { toolName: string; arguments: object }) => {
            calls.push(args)
            if (args.toolName === 'list_datasets') {
              return {
                error: '',
                content: [
                  {
                    text: JSON.stringify({
                      datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                        { name: 'total_bill', type: 'FLOAT' },
                        { name: 'tip', type: 'FLOAT' },
                        { name: 'smoker', type: 'TEXT' },
                        { name: 'time', type: 'TEXT' },
                        { name: 'size', type: 'BIGINT' },
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
                    chart_id: 119,
                    chart_url: 'http://127.0.0.1:8080/explore/?slice_id=119',
                  }),
                },
              ],
            }
          },
        }),
      }

      const result = await runAxBiExistingDatasetChartWorkflow({
        prompt,
        serviceHub: serviceHub as never,
      })

      expect(result).toMatchObject({ handled: true })
      expect(calls[2]).toMatchObject({
        toolName: 'generate_chart',
        arguments: {
          request: {
            config: expectedConfig,
          },
        },
      })
    }
  })

  it('creates a saved table from selected dataset columns', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
          {
            server: 'ax-bi',
            name: 'get_dataset_info',
            description: '',
            inputSchema: {},
          },
          { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                      { name: 'day', type: 'TEXT' },
                      { name: 'time', type: 'TEXT' },
                      { name: 'smoker', type: 'TEXT' },
                      { name: 'total_bill', type: 'FLOAT' },
                      { name: 'tip', type: 'FLOAT' },
                      { name: 'size', type: 'BIGINT' },
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
                  chart_id: 181,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=181',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Create a saved table from restaurant_tips showing day, time, smoker, total bill, tip, and size. Name it Tips - Detail Table.',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({ handled: true })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          chart_name: 'Tips - Detail Table',
          config: {
            chart_type: 'table',
            query_mode: 'raw',
            columns: [
              { name: 'day' },
              { name: 'time' },
              { name: 'smoker' },
              { name: 'total_bill' },
              { name: 'tip' },
              { name: 'size' },
            ],
            all_columns: [
              { name: 'day' },
              { name: 'time' },
              { name: 'smoker' },
              { name: 'total_bill' },
              { name: 'tip' },
              { name: 'size' },
            ],
            groupby: [],
          },
        },
      },
    })
  })

  it('creates a saved pivot table from row, column, and metric prompts', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'get_dataset_info', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                      { name: 'day', type: 'TEXT' },
                      { name: 'smoker', type: 'TEXT' },
                      { name: 'total_bill', type: 'FLOAT' },
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
                  chart_id: 190,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=190',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Create a saved pivot table from restaurant_tips showing SUM(total_bill) by day and smoker. Name it Tips - Bill Pivot by Day and Smoker.',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({ handled: true })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          chart_name: 'Tips - Bill Pivot by Day and Smoker',
          config: {
            chart_type: 'pivot_table',
            rows: [{ name: 'day' }],
            columns: [{ name: 'smoker' }],
            metrics: [
              {
                name: 'total_bill',
                aggregate: 'SUM',
                label: 'SUM(total_bill)',
              },
            ],
          },
        },
      },
    })
  })

  it('creates a saved mixed time-series chart from two metrics', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'get_dataset_info', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [{ id: 300, table_name: 'sales_daily' }],
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
                      { name: 'order_date', type: 'DATE', is_dttm: true },
                      { name: 'revenue', type: 'FLOAT' },
                      { name: 'profit', type: 'FLOAT' },
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
                  chart_id: 191,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=191',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Create a saved mixed time series chart from sales_daily showing SUM(revenue) and AVG(profit) by order_date. Name it Sales - Revenue and Profit.',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({ handled: true })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          chart_name: 'Sales - Revenue and Profit',
          config: {
            chart_type: 'mixed_timeseries',
            x: { name: 'order_date' },
            y: [{ name: 'revenue', aggregate: 'SUM', label: 'SUM(revenue)' }],
            primary_kind: 'line',
            y_secondary: [
              { name: 'profit', aggregate: 'AVG', label: 'AVG(profit)' },
            ],
            secondary_kind: 'bar',
          },
        },
      },
    })
  })

  it('creates a saved handlebars chart from an aggregate prompt', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'get_dataset_info', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                      { name: 'day', type: 'TEXT' },
                      { name: 'total_bill', type: 'FLOAT' },
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
                  chart_id: 192,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=192',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Create a saved handlebars chart from restaurant_tips showing SUM(total_bill) by day. Name it Tips - Day Summary.',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({ handled: true })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          chart_name: 'Tips - Day Summary',
          config: {
            chart_type: 'handlebars',
            query_mode: 'aggregate',
            groupby: [{ name: 'day' }],
            metrics: [
              {
                name: 'total_bill',
                aggregate: 'SUM',
                label: 'SUM(total_bill)',
              },
            ],
          },
        },
      },
    })
  })

  it('handles short natural chart prompts and common column aliases', async () => {
    const prompts = [
      {
        prompt:
          'Create a bar chart from restaurant_tips showing total bill by day. Call it Tips - Total Bill by Day.',
        expectedChartName: 'Tips - Total Bill by Day',
        expectedConfig: {
          chart_type: 'xy',
          kind: 'bar',
          x: { name: 'day' },
          y: [{ name: 'total_bill', aggregate: 'SUM', label: 'SUM(total_bill)' }],
        },
      },
      {
        prompt:
          'Create a line chart from restaurant_tips showing mean total bill by party size. Title it Tips - Avg Bill by Party Size.',
        expectedChartName: 'Tips - Avg Bill by Party Size',
        expectedConfig: {
          chart_type: 'xy',
          kind: 'line',
          x: { name: 'size' },
          y: [{ name: 'total_bill', aggregate: 'AVG', label: 'AVG(total_bill)' }],
        },
      },
      {
        prompt:
          'Create a horizontal bar chart from restaurant_tips showing average tip by meal time. Named Tips - Average Tip by Meal Time.',
        expectedChartName: 'Tips - Average Tip by Meal Time',
        expectedConfig: {
          chart_type: 'xy',
          kind: 'bar',
          orientation: 'horizontal',
          x: { name: 'time' },
          y: [{ name: 'tip', aggregate: 'AVG', label: 'AVG(tip)' }],
        },
      },
    ]

    for (const { prompt, expectedChartName, expectedConfig } of prompts) {
      const calls: Array<{ toolName: string; arguments: object }> = []
      const serviceHub = {
        mcp: () => ({
          getTools: async () => [
            { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
            {
              server: 'ax-bi',
              name: 'get_dataset_info',
              description: '',
              inputSchema: {},
            },
            { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
          ],
          callTool: async (args: { toolName: string; arguments: object }) => {
            calls.push(args)
            if (args.toolName === 'list_datasets') {
              return {
                error: '',
                content: [
                  {
                    text: JSON.stringify({
                      datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                        { name: 'day', type: 'TEXT' },
                        { name: 'total_bill', type: 'FLOAT' },
                        { name: 'tip', type: 'FLOAT' },
                        { name: 'time', type: 'TEXT' },
                        { name: 'size', type: 'BIGINT' },
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
                    chart_id: 182,
                    chart_url: 'http://127.0.0.1:8080/explore/?slice_id=182',
                  }),
                },
              ],
            }
          },
        }),
      }

      const result = await runAxBiExistingDatasetChartWorkflow({
        prompt,
        serviceHub: serviceHub as never,
      })

      expect(result).toMatchObject({ handled: true })
      expect(calls[2]).toMatchObject({
        toolName: 'generate_chart',
        arguments: {
          request: {
            chart_name: expectedChartName,
            config: expectedConfig,
          },
        },
      })
    }
  })

  it('handles area, donut, and big-number KPI prompt variants', async () => {
    const prompts = [
      {
        prompt:
          'Make an area chart from restaurant_tips showing total bill by day. Call it Tips - Total Bill Area by Day.',
        expectedChartName: 'Tips - Total Bill Area by Day',
        expectedConfig: {
          chart_type: 'xy',
          kind: 'area',
          x: { name: 'day' },
          y: [{ name: 'total_bill', aggregate: 'SUM', label: 'SUM(total_bill)' }],
        },
      },
      {
        prompt:
          'Build a donut chart from restaurant_tips showing count of records by smoker. Title it Tips - Smoker Donut.',
        expectedChartName: 'Tips - Smoker Donut',
        expectedConfig: {
          chart_type: 'pie',
          donut: true,
          dimension: { name: 'smoker' },
          metric: { sql_expression: 'COUNT(*)', label: 'Count' },
        },
      },
      {
        prompt:
          'Generate a big number from restaurant_tips showing total tip. Name it Tips - Total Tip KPI.',
        expectedChartName: 'Tips - Total Tip KPI',
        expectedConfig: {
          chart_type: 'big_number',
          metric: { name: 'tip', aggregate: 'SUM', label: 'SUM(tip)' },
          subheader: 'SUM(tip)',
        },
      },
      {
        prompt:
          'Save a KPI from restaurant_tips showing record count. Call it Tips - Record Count.',
        expectedChartName: 'Tips - Record Count',
        expectedConfig: {
          chart_type: 'big_number',
          metric: { sql_expression: 'COUNT(*)', label: 'Count' },
          subheader: 'COUNT(*)',
        },
      },
    ]

    for (const { prompt, expectedChartName, expectedConfig } of prompts) {
      const calls: Array<{ toolName: string; arguments: object }> = []
      const serviceHub = {
        mcp: () => ({
          getTools: async () => [
            { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
            {
              server: 'ax-bi',
              name: 'get_dataset_info',
              description: '',
              inputSchema: {},
            },
            { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
          ],
          callTool: async (args: { toolName: string; arguments: object }) => {
            calls.push(args)
            if (args.toolName === 'list_datasets') {
              return {
                error: '',
                content: [
                  {
                    text: JSON.stringify({
                      datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                        { name: 'day', type: 'TEXT' },
                        { name: 'total_bill', type: 'FLOAT' },
                        { name: 'tip', type: 'FLOAT' },
                        { name: 'smoker', type: 'TEXT' },
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
                    chart_id: 183,
                    chart_url: 'http://127.0.0.1:8080/explore/?slice_id=183',
                  }),
                },
              ],
            }
          },
        }),
      }

      const result = await runAxBiExistingDatasetChartWorkflow({
        prompt,
        serviceHub: serviceHub as never,
      })

      expect(result).toMatchObject({ handled: true })
      expect(calls[2]).toMatchObject({
        toolName: 'generate_chart',
        arguments: {
          request: {
            chart_name: expectedChartName,
            config: expectedConfig,
          },
        },
      })
    }
  })

  it('stops group-by parsing before natural chart naming phrases without punctuation', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
          {
            server: 'ax-bi',
            name: 'get_dataset_info',
            description: '',
            inputSchema: {},
          },
          { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                      { name: 'day', type: 'TEXT' },
                      { name: 'total_bill', type: 'FLOAT' },
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
                  chart_id: 186,
                  chart_url: 'http://127.0.0.1:8080/explore/?slice_id=186',
                }),
              },
            ],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Make a bar chart from restaurant_tips showing total bill by day call it Tips - Total Bill by Day',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({ handled: true })
    expect(calls[2]).toMatchObject({
      toolName: 'generate_chart',
      arguments: {
        request: {
          chart_name: 'Tips - Total Bill by Day',
          config: {
            chart_type: 'xy',
            kind: 'bar',
            x: { name: 'day' },
            y: [{ name: 'total_bill', aggregate: 'SUM', label: 'SUM(total_bill)' }],
          },
        },
      },
    })
  })

  it('maps common prompt options to supported AX-BI chart config fields', async () => {
    const prompts = [
      {
        prompt:
          'Create a bar chart from restaurant_tips showing total bill by day with Lyft colors, show value labels, top 5. Name it Tips - Styled Bill by Day.',
        expectedChartName: 'Tips - Styled Bill by Day',
        expectedConfig: {
          chart_type: 'xy',
          kind: 'bar',
          x: { name: 'day' },
          y: [{ name: 'total_bill', aggregate: 'SUM', label: 'SUM(total_bill)' }],
          color_scheme: 'lyftColors',
          row_limit: 5,
          show_value: true,
        },
      },
      {
        prompt:
          'Create a donut chart from restaurant_tips showing count of records by smoker using Google colours limit 3. Name it Tips - Styled Smoker Donut.',
        expectedChartName: 'Tips - Styled Smoker Donut',
        expectedConfig: {
          chart_type: 'pie',
          dimension: { name: 'smoker' },
          metric: { sql_expression: 'COUNT(*)', label: 'Count' },
          donut: true,
          color_scheme: 'googleCategory10c',
          row_limit: 3,
        },
      },
      {
        prompt:
          'Create a saved table from restaurant_tips showing day, time, smoker, total bill, tip, and size with D3 colors first 25 rows. Name it Tips - Styled Detail Table.',
        expectedChartName: 'Tips - Styled Detail Table',
        expectedConfig: {
          chart_type: 'table',
          query_mode: 'raw',
          color_scheme: 'd3Category10',
          row_limit: 25,
        },
      },
    ]

    for (const { prompt, expectedChartName, expectedConfig } of prompts) {
      const calls: Array<{ toolName: string; arguments: object }> = []
      const serviceHub = {
        mcp: () => ({
          getTools: async () => [
            { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
            {
              server: 'ax-bi',
              name: 'get_dataset_info',
              description: '',
              inputSchema: {},
            },
            { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
          ],
          callTool: async (args: { toolName: string; arguments: object }) => {
            calls.push(args)
            if (args.toolName === 'list_datasets') {
              return {
                error: '',
                content: [
                  {
                    text: JSON.stringify({
                      datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                        { name: 'day', type: 'TEXT' },
                        { name: 'time', type: 'TEXT' },
                        { name: 'smoker', type: 'TEXT' },
                        { name: 'total_bill', type: 'FLOAT' },
                        { name: 'tip', type: 'FLOAT' },
                        { name: 'size', type: 'BIGINT' },
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
                    chart_id: 187,
                    chart_url: 'http://127.0.0.1:8080/explore/?slice_id=187',
                  }),
                },
              ],
            }
          },
        }),
      }

      const result = await runAxBiExistingDatasetChartWorkflow({
        prompt,
        serviceHub: serviceHub as never,
      })

      expect(result).toMatchObject({ handled: true })
      expect(calls[2]).toMatchObject({
        toolName: 'generate_chart',
        arguments: {
          request: {
            chart_name: expectedChartName,
            config: expectedConfig,
          },
        },
      })
    }
  })

  it('maps simple filter phrases to AX-BI structured chart filters', async () => {
    const prompts = [
      {
        prompt:
          'Create a bar chart from restaurant_tips showing total bill by day where smoker is Yes. Name it Tips - Smoker Bill by Day.',
        expectedChartName: 'Tips - Smoker Bill by Day',
        expectedConfig: {
          chart_type: 'xy',
          kind: 'bar',
          x: { name: 'day' },
          y: [{ name: 'total_bill', aggregate: 'SUM', label: 'SUM(total_bill)' }],
          filters: [{ column: 'smoker', op: '=', value: 'Yes' }],
        },
      },
      {
        prompt:
          'Create a horizontal bar chart from restaurant_tips showing average tip by day filter meal time equals Dinner. Name it Tips - Dinner Tip by Day.',
        expectedChartName: 'Tips - Dinner Tip by Day',
        expectedConfig: {
          chart_type: 'xy',
          kind: 'bar',
          orientation: 'horizontal',
          x: { name: 'day' },
          y: [{ name: 'tip', aggregate: 'AVG', label: 'AVG(tip)' }],
          filters: [{ column: 'time', op: '=', value: 'Dinner' }],
        },
      },
    ]

    for (const { prompt, expectedChartName, expectedConfig } of prompts) {
      const calls: Array<{ toolName: string; arguments: object }> = []
      const serviceHub = {
        mcp: () => ({
          getTools: async () => [
            { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
            {
              server: 'ax-bi',
              name: 'get_dataset_info',
              description: '',
              inputSchema: {},
            },
            { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
          ],
          callTool: async (args: { toolName: string; arguments: object }) => {
            calls.push(args)
            if (args.toolName === 'list_datasets') {
              return {
                error: '',
                content: [
                  {
                    text: JSON.stringify({
                      datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                        { name: 'day', type: 'TEXT' },
                        { name: 'time', type: 'TEXT' },
                        { name: 'smoker', type: 'TEXT' },
                        { name: 'total_bill', type: 'FLOAT' },
                        { name: 'tip', type: 'FLOAT' },
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
                    chart_id: 188,
                    chart_url: 'http://127.0.0.1:8080/explore/?slice_id=188',
                  }),
                },
              ],
            }
          },
        }),
      }

      const result = await runAxBiExistingDatasetChartWorkflow({
        prompt,
        serviceHub: serviceHub as never,
      })

      expect(result).toMatchObject({ handled: true })
      expect(calls[2]).toMatchObject({
        toolName: 'generate_chart',
        arguments: {
          request: {
            chart_name: expectedChartName,
            config: expectedConfig,
          },
        },
      })
    }
  })

  it('creates a dashboard from an existing AX-BI dataset prompt', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    let nextChartId = 210
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
          {
            server: 'ax-bi',
            name: 'get_dataset_info',
            description: '',
            inputSchema: {},
          },
          { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'update_chart', description: '', inputSchema: {} },
          {
            server: 'ax-bi',
            name: 'generate_dashboard',
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
                    datasets: [{ id: 103, table_name: 'upload_restaurant_tips_f0d2d2' }],
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
                      { name: 'day', type: 'TEXT' },
                      { name: 'smoker', type: 'TEXT' },
                      { name: 'total_bill', type: 'FLOAT' },
                      { name: 'tip', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'generate_chart') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    chart_id: nextChartId++,
                    chart_url: 'http://127.0.0.1:8080/explore/?slice_id=210',
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'generate_dashboard') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    dashboard_url: 'http://127.0.0.1:8080/dashboard/55/',
                  }),
                },
              ],
            }
          }
          return { error: '', content: [{ text: 'Chart updated' }] }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Create an AX-BI dashboard from restaurant_tips. Name it Tips Overview Dashboard.',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/dashboard/55/',
    })
    expect(
      calls.filter((call) => call.toolName === 'generate_chart')
    ).toHaveLength(3)
    expect(calls.at(-1)).toMatchObject({
      toolName: 'generate_dashboard',
      arguments: {
        request: {
          chart_ids: [210, 211, 212],
          dashboard_title: 'Tips Overview Dashboard',
          published: true,
        },
      },
    })
  })

  it('creates an existing-dataset dashboard from matching saved charts', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'get_dataset_info', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'list_charts', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'generate_dashboard', description: '', inputSchema: {} },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [
                      { id: 205, table_name: 'upload_california_housing_b074e1' },
                    ],
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
                      { name: 'longitude', type: 'FLOAT' },
                      { name: 'latitude', type: 'FLOAT' },
                      { name: 'housing_median_age', type: 'FLOAT' },
                      { name: 'median_income', type: 'FLOAT' },
                      { name: 'median_house_value', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'list_charts') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    charts: [
                      {
                        id: 301,
                        slice_name: 'Housing - Record Count KPI',
                        datasource_name: 'upload_california_housing_b074e1',
                      },
                      {
                        id: 302,
                        slice_name: 'Housing - Avg Income by Age',
                        datasource_name: 'upload_california_housing_b074e1',
                      },
                      {
                        id: 303,
                        slice_name: 'Housing - Location by Value',
                        datasource_name: 'upload_california_housing_b074e1',
                      },
                      {
                        id: 304,
                        slice_name: 'Housing - Income vs Value',
                        datasource_name: 'upload_california_housing_b074e1',
                      },
                      {
                        id: 305,
                        slice_name: 'Housing - Detail Table',
                        datasource_name: 'upload_california_housing_b074e1',
                      },
                    ],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'generate_dashboard') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    dashboard_url: 'http://127.0.0.1:8080/ax-bi/dashboard/70/',
                  }),
                },
              ],
            }
          }
          return {
            error: '',
            content: [{ text: JSON.stringify({ chart_id: 999 }) }],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Create an AX-BI dashboard from california_housing. Name it Housing Overview Dashboard. which includes all the charts regarding housing which we created',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/ax-bi/dashboard/70/',
    })
    expect(
      calls.filter((call) => call.toolName === 'generate_chart')
    ).toHaveLength(0)
    expect(calls.at(-1)).toMatchObject({
      toolName: 'generate_dashboard',
      arguments: {
        request: {
          chart_ids: [301, 302, 303, 304, 305],
          dashboard_title: 'Housing Overview Dashboard',
          published: true,
        },
      },
    })
  })

  it('creates an existing-dataset dashboard from an unquoted pasted chart list', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'get_dataset_info', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'list_charts', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'generate_dashboard', description: '', inputSchema: {} },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [
                      { id: 205, table_name: 'upload_california_housing_b074e1' },
                    ],
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
                      { name: 'longitude', type: 'FLOAT' },
                      { name: 'latitude', type: 'FLOAT' },
                      { name: 'median_income', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'list_charts') {
            const search =
              ((args.arguments as { request?: { search?: string } }).request
                ?.search as string | undefined) ?? ''
            const charts = [
              {
                id: 321,
                slice_name: 'Housing - Record Count KPI',
                datasource_name: 'upload_california_housing_b074e1',
              },
              {
                id: 322,
                slice_name: 'Housing - Avg Income by Age',
                datasource_name: 'upload_california_housing_b074e1',
              },
              {
                id: 323,
                slice_name: 'Housing - Location by Value',
                datasource_name: 'upload_california_housing_b074e1',
              },
              {
                id: 324,
                slice_name: 'Housing - Income vs Value',
                datasource_name: 'upload_california_housing_b074e1',
              },
              {
                id: 325,
                slice_name: 'Housing - Detail Table',
                datasource_name: 'upload_california_housing_b074e1',
              },
            ].filter((chart) =>
              chart.slice_name.toLowerCase().includes(search.toLowerCase())
            )
            return {
              error: '',
              content: [{ text: JSON.stringify({ charts }) }],
            }
          }
          if (args.toolName === 'generate_dashboard') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    dashboard_url: 'http://127.0.0.1:8080/ax-bi/dashboard/72/',
                  }),
                },
              ],
            }
          }
          return {
            error: '',
            content: [{ text: JSON.stringify({ chart_id: 999 }) }],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Use AX-BI MCP with dataset upload_california_housing_b074e1. Create dashboard named house dash using these charts Housing - Record Count KPI Housing - Avg Income by Age Housing - Location by Value Housing - Income vs Value Housing - Detail Table',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/ax-bi/dashboard/72/',
    })
    expect(
      calls.filter((call) => call.toolName === 'generate_chart')
    ).toHaveLength(0)
    expect(calls.at(-1)).toMatchObject({
      toolName: 'generate_dashboard',
      arguments: {
        request: {
          chart_ids: [321, 322, 323, 324, 325],
          dashboard_title: 'house dash',
          published: true,
        },
      },
    })
  })

  it('creates an existing-dataset dashboard from explicitly named saved charts', async () => {
    const calls: Array<{ toolName: string; arguments: object }> = []
    const serviceHub = {
      mcp: () => ({
        getTools: async () => [
          { server: 'ax-bi', name: 'list_datasets', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'get_dataset_info', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'list_charts', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'generate_chart', description: '', inputSchema: {} },
          { server: 'ax-bi', name: 'generate_dashboard', description: '', inputSchema: {} },
        ],
        callTool: async (args: { toolName: string; arguments: object }) => {
          calls.push(args)
          if (args.toolName === 'list_datasets') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    datasets: [
                      { id: 205, table_name: 'upload_california_housing_b074e1' },
                    ],
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
                      { name: 'longitude', type: 'FLOAT' },
                      { name: 'latitude', type: 'FLOAT' },
                      { name: 'median_income', type: 'FLOAT' },
                    ],
                  }),
                },
              ],
            }
          }
          if (args.toolName === 'list_charts') {
            const search =
              ((args.arguments as { request?: { search?: string } }).request
                ?.search as string | undefined) ?? ''
            const charts = [
              {
                id: 311,
                slice_name: 'Housing - Detail Table',
                datasource_name: 'upload_california_housing_b074e1',
              },
              {
                id: 312,
                slice_name: 'Housing - Income vs Value',
                datasource_name: 'upload_california_housing_b074e1',
              },
            ].filter((chart) =>
              chart.slice_name.toLowerCase().includes(search.toLowerCase())
            )
            return {
              error: '',
              content: [{ text: JSON.stringify({ charts }) }],
            }
          }
          if (args.toolName === 'generate_dashboard') {
            return {
              error: '',
              content: [
                {
                  text: JSON.stringify({
                    dashboard_url: 'http://127.0.0.1:8080/ax-bi/dashboard/71/',
                  }),
                },
              ],
            }
          }
          return {
            error: '',
            content: [{ text: JSON.stringify({ chart_id: 999 }) }],
          }
        },
      }),
    }

    const result = await runAxBiExistingDatasetChartWorkflow({
      prompt:
        'Create an AX-BI dashboard from california_housing. Name it Housing Custom Dashboard. Include "Housing - Detail Table" and "Housing - Income vs Value".',
      serviceHub: serviceHub as never,
    })

    expect(result).toMatchObject({
      handled: true,
      chartUrl: 'http://127.0.0.1:8080/ax-bi/dashboard/71/',
    })
    expect(
      calls.filter((call) => call.toolName === 'generate_chart')
    ).toHaveLength(0)
    expect(calls.at(-1)).toMatchObject({
      toolName: 'generate_dashboard',
      arguments: {
        request: {
          chart_ids: [311, 312],
          dashboard_title: 'Housing Custom Dashboard',
          published: true,
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
