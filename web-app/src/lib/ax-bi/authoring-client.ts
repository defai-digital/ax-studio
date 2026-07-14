import type { ServiceHub } from '@/services'
import { callAxBiMcpTool } from './datasets'
import {
  getMcpToolFailureMessage,
  parseJsonMcpResult,
  type AxBiMcpResult,
} from './mcp-result'
import type { AxBI } from './sdk'

export type AxBiAuthoringClient = {
  ai: Pick<
    AxBI['ai'],
    | 'createChartFromIntent'
    | 'getAuthoringCapabilities'
    | 'planDashboard'
    | 'promptToDashboard'
    | 'uploadAndPlan'
  >
}

async function callAuthoringTool<T extends Record<string, unknown>>({
  serviceHub,
  toolName,
  arguments: toolArguments,
}: {
  serviceHub: ServiceHub
  toolName: string
  arguments: Record<string, unknown>
}): Promise<T> {
  const result = (await callAxBiMcpTool({
    serviceHub,
    toolName,
    arguments: toolArguments,
    retryOnTransportFailure: false,
  })) as AxBiMcpResult
  const failure = getMcpToolFailureMessage(result)
  if (failure) throw new Error(failure)

  const parsed = parseJsonMcpResult<T>(result)
  if (!parsed) {
    throw new Error(`AX BI MCP tool ${toolName} returned no structured result.`)
  }
  return parsed
}

export function createServiceHubAxBiAuthoringClient(
  serviceHub: ServiceHub
): AxBiAuthoringClient {
  return {
    ai: {
      getAuthoringCapabilities: () =>
        callAuthoringTool({
          serviceHub,
          toolName: 'get_authoring_capabilities',
          arguments: {},
        }),
      createChartFromIntent: (request) =>
        callAuthoringTool({
          serviceHub,
          toolName: 'create_chart_from_intent',
          arguments: { request },
        }),
      planDashboard: (request) =>
        callAuthoringTool({
          serviceHub,
          toolName: 'plan_dashboard',
          arguments: { request },
        }),
      promptToDashboard: (request) =>
        callAuthoringTool({
          serviceHub,
          toolName: 'prompt_to_dashboard',
          arguments: { request },
        }),
      uploadAndPlan: (request) =>
        callAuthoringTool({
          serviceHub,
          toolName: 'upload_and_plan',
          arguments: { request },
        }),
    },
  }
}
