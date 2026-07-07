import { describe, expect, it } from 'vitest'
import { runAxBiExistingDatasetChartWorkflow } from '../dashboard-workflow'

type JsonRpcResult = {
  content?: Array<{ type?: string; text?: string }>
  isError?: boolean
}

class LiveMcpClient {
  private requestId = 0
  private sessionId: string | null = null
  private initialized = false

  constructor(private readonly endpoint = 'http://127.0.0.1:5008/mcp') {}

  async tools() {
    return [
      { server: 'ax-bi', name: 'search_tools', description: '', inputSchema: {} },
      { server: 'ax-bi', name: 'call_tool', description: '', inputSchema: {} },
    ]
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<JsonRpcResult> {
    await this.initialize()
    return this.send('tools/call', { name, arguments: args })
  }

  private async initialize() {
    if (this.initialized) return
    await this.send('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'ax-studio-live-smoke', version: '1.0.0' },
    })
    await this.notify('notifications/initialized')
    this.initialized = true
  }

  private async notify(method: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method }),
    }).catch(() => undefined)
  }

  private async send(method: string, params: Record<string, unknown>) {
    const id = String(++this.requestId)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    const sessionId = response.headers.get('mcp-session-id')
    if (sessionId) this.sessionId = sessionId
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`MCP ${method} failed (${response.status}): ${text}`)
    }
    const event = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5).trim()))
      .findLast((payload) => payload.id === id)
    if (!event) throw new Error(`MCP ${method} returned no JSON-RPC response`)
    if (event.error) throw new Error(event.error.message)
    return event.result
  }
}

function makeServiceHub(client: LiveMcpClient) {
  return {
    mcp: () => ({
      getTools: () => client.tools(),
      callTool: async (args: {
        toolName: string
        arguments: Record<string, unknown>
      }) => client.callTool(args.toolName, args.arguments),
    }),
  }
}

describe.skipIf(process.env.AX_BI_LIVE_SMOKE !== 'true')(
  'AX-BI live chart workflow smoke',
  () => {
    it(
      'creates every supported chart family and a named dashboard through the AX-Studio workflow',
      async () => {
        const client = new LiveMcpClient()
        const serviceHub = makeServiceHub(client)
        const prompts = [
          'Create a saved bar chart from restaurant_tips showing COUNT(*) by day. Name it Smoke - Tips Count by Day.',
          'Create a saved bar chart from restaurant_tips showing SUM(total_bill) by day grouped by smoker with lyft colors and show value labels. Name it Smoke - Grouped Bill by Day and Smoker.',
          'Create a saved bar chart from restaurant_tips showing AVG(tip) by day where smoker is Yes top 3. Name it Smoke - Smoker Tip Top Days.',
          'Create a saved horizontal bar chart from restaurant_tips showing AVG(tip) by time. Name it Smoke - Avg Tip by Time.',
          'Create a saved line chart from supermarket_sales showing SUM(Total) by Date. Name it Smoke - Sales Total by Date.',
          'Create a saved area chart from supermarket_sales showing AVG(Rating) by Date. Name it Smoke - Rating by Date.',
          'Create a saved scatter chart from california_housing with median_income on x-axis and median_house_value on y-axis. Name it Smoke - Housing Income vs Value.',
          'Create a saved pie chart from restaurant_tips showing COUNT(*) by smoker. Name it Smoke - Smoker Split.',
          'Create a saved donut chart from restaurant_tips showing COUNT(*) by sex. Name it Smoke - Sex Split.',
          'Create a saved table from restaurant_tips showing day, time, smoker, total_bill, tip, and size. Name it Smoke - Tips Detail Table.',
          'Create a saved interactive table from restaurant_tips showing day, time, smoker, total_bill, tip, and size. Name it Smoke - Tips Interactive Table.',
          'Create a saved table from restaurant_tips showing SUM(total_bill) by day. Name it Smoke - Tips Bill Summary Table.',
          'Create a saved big number from california_housing showing COUNT(*). Name it Smoke - Housing Record Count.',
          'Create a saved big number from supermarket_sales showing SUM(Total) with trendline by Date. Name it Smoke - Sales Total KPI Trend.',
          'Create a saved stacked bar chart from restaurant_tips showing SUM(total_bill) by day stacked by smoker. Name it Smoke - Bill by Day and Smoker.',
          'Create a saved pivot table from restaurant_tips showing SUM(total_bill) by day and smoker. Name it Smoke - Bill Pivot by Day and Smoker.',
          'Create a saved mixed time series chart from supermarket_sales showing SUM(Total) and AVG(Rating) by Date. Name it Smoke - Sales and Rating by Date.',
          'Create a saved handlebars chart from restaurant_tips showing SUM(total_bill) by day. Name it Smoke - Tips Day Summary.',
        ]

        const messages: string[] = []
        for (const prompt of prompts) {
          const result = await runAxBiExistingDatasetChartWorkflow({
            prompt,
            serviceHub: serviceHub as never,
          })
          messages.push(result.handled ? result.message : `Unhandled: ${prompt}`)
          expect(result.handled, prompt).toBe(true)
          expect(result.handled && result.chartUrl, prompt).toMatch(
            /127\.0\.0\.1:8080/
          )
        }

        const dashboard = await runAxBiExistingDatasetChartWorkflow({
          prompt:
            'Create dashboard named Smoke Tips Dashboard using these charts Smoke - Tips Count by Day Smoke - Grouped Bill by Day and Smoker Smoke - Smoker Tip Top Days Smoke - Avg Tip by Time Smoke - Smoker Split Smoke - Sex Split Smoke - Tips Detail Table Smoke - Tips Bill Summary Table Smoke - Bill Pivot by Day and Smoker Smoke - Tips Day Summary',
          serviceHub: serviceHub as never,
        })
        messages.push(dashboard.handled ? dashboard.message : 'Dashboard unhandled')
        expect(dashboard.handled).toBe(true)
        expect(dashboard.handled && dashboard.chartUrl).toMatch(
          /127\.0\.0\.1:8080/
        )

        console.info(messages.join('\n'))
      },
      180_000
    )
  }
)
