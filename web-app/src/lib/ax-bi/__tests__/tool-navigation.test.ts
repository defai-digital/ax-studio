import { describe, expect, it } from 'vitest'
import type { MCPTool } from '@/types/mcp'
import {
  didAxBiQueueLiveUpdate,
  getAxBiResultUrl,
  parseAxBiToolResult,
  withAxBiAutoNavigate,
} from '../tool-navigation'

function makeTool(inputSchema: Record<string, unknown>): MCPTool {
  return {
    server: 'ax-bi',
    name: 'generate_explore_link',
    inputSchema,
  }
}

describe('AX-BI tool navigation helpers', () => {
  it('injects auto_navigate under request when the tool schema supports it', () => {
    const tools = [
      makeTool({
        type: 'object',
        properties: {
          request: {
            type: 'object',
            properties: {
              dataset_id: { type: 'number' },
              auto_navigate: { type: 'boolean' },
            },
          },
        },
      }),
    ]

    expect(
      withAxBiAutoNavigate(tools, 'generate_explore_link', {
        request: {
          dataset_id: 20,
          auto_navigate: false,
          config: { chart_type: 'xy' },
        },
      })
    ).toEqual({
      request: {
        dataset_id: 20,
        auto_navigate: true,
        config: { chart_type: 'xy' },
      },
    })
  })

  it('does not inject auto_navigate for non-AX-BI tools', () => {
    const tools: MCPTool[] = [
      {
        server: 'other',
        name: 'generate_explore_link',
        inputSchema: {
          properties: {
            request: {
              properties: {
                auto_navigate: { type: 'boolean' },
              },
            },
          },
        },
      },
    ]

    const input = { request: { dataset_id: 20 } }
    expect(withAxBiAutoNavigate(tools, 'generate_explore_link', input)).toBe(input)
  })

  it('parses structured AX-BI JSON results from MCP text content', () => {
    const parsed = parseAxBiToolResult({
      content: [
        {
          text: JSON.stringify({
            success: true,
            explore_url: 'http://127.0.0.1:8088/explore/p/abc/',
            remote_navigation_queued: false,
          }),
        },
      ],
    })

    expect(parsed).toEqual({
      success: true,
      explore_url: 'http://127.0.0.1:8088/explore/p/abc/',
      remote_navigation_queued: false,
    })
    expect(getAxBiResultUrl('generate_chart', parsed!)).toBe(
      'http://127.0.0.1:8088/explore/p/abc/'
    )
  })

  it('does not auto-open discovery tool URLs', () => {
    expect(
      getAxBiResultUrl('get_dataset_info', {
        success: true,
        url: 'http://127.0.0.1:8088/explore/?datasource_type=table&datasource_id=20',
      })
    ).toBeUndefined()
  })

  it('uses dashboard URLs for dashboard-producing tools', () => {
    expect(
      getAxBiResultUrl('generate_dashboard', {
        success: true,
        dashboard_url: 'http://127.0.0.1:8088/superset/dashboard/12/',
      })
    ).toBe('http://127.0.0.1:8088/superset/dashboard/12/')
  })

  it('detects queued live updates from new response metadata', () => {
    expect(
      didAxBiQueueLiveUpdate({
        success: true,
        live_update_attempted: true,
        live_update_command_id: 'abc123',
        live_update_url: '/superset/explore/p/abc/',
      })
    ).toBe(true)
  })
})
