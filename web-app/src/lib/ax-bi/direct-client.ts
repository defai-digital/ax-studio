/**
 * Electron AX BI runtime path (migration matrix §4).
 *
 * Under Electron there is no Rust MCP layer, so AX BI talks directly to the
 * user's external AX BI stack. MCP protocol state remains in the renderer,
 * while HTTP and Bearer authorization run through a constrained Electron
 * main-process command. This avoids browser CORS and keeps saved credentials
 * out of renderer memory.
 *
 * Zero-config: the MCP URL defaults to `http://127.0.0.1:31421/mcp` and is
 * hidden from the UI; a localStorage override exists only as a dev/smoke seam.
 */
import { localStorageKey } from '@/constants/localStorage'
import { invoke } from '@/lib/tauri-shim/api-core'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage/storage'
import { useAxBiConnection } from '@/stores/ax-bi-connection-store'
import {
  DEFAULT_AX_BI_MCP_URL,
  DEFAULT_AX_BI_WEB_URL,
  normalizeAxBiMcpUrl,
} from './endpoints'
import { classifyAxBiConnectionError } from './mcp-result'
import {
  AxBI,
  type AxBIMcpTransport,
  type AxBIMcpTransportResponse,
} from './sdk'

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
import {
  clearStoredAxBiMcpToken,
  hasStoredAxBiMcpToken,
  normalizeAxBiToken,
  storeAxBiMcpToken,
} from './token-storage'

const STORAGE_CONTEXT = 'AX BI MCP URL override'
const MISSING_TOKEN_ERROR = 'AX BI API key or JWT is required.'

let cachedClient: { key: string; client: AxBI } | null = null

type AxBiMcpIpcResponse = {
  ok: boolean
  status: number
  statusText: string
  contentType: string | null
  sessionId: string | null
  body: string
}

function ipcResponse(response: AxBiMcpIpcResponse): AxBIMcpTransportResponse {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: {
      get: (name) => {
        const normalized = name.toLowerCase()
        if (normalized === 'content-type') return response.contentType
        if (normalized === 'mcp-session-id') return response.sessionId
        return null
      },
    },
    text: async () => response.body,
    json: async () => JSON.parse(response.body) as unknown,
  }
}

const electronMcpTransport: AxBIMcpTransport = {
  post: async (url, options) => {
    const response = await invoke<AxBiMcpIpcResponse>('ax_bi_mcp_request', {
      url,
      body: options.body,
      sessionId: options.headers['Mcp-Session-Id'],
      timeoutMs: options.timeoutMs,
    })
    return ipcResponse(response)
  },
}

/** Configured MCP URL: dev/smoke override when set, else the hidden default. */
export function getElectronAxBiMcpUrl(): string {
  const override = safeStorageGetItem(
    localStorage,
    localStorageKey.axBiMcpUrlOverride,
    STORAGE_CONTEXT
  )
  if (override?.trim()) {
    try {
      return normalizeAxBiMcpUrl(override)
    } catch (error) {
      console.warn('[ax-bi] Ignoring invalid MCP URL override:', error)
    }
  }
  return normalizeAxBiMcpUrl(DEFAULT_AX_BI_MCP_URL)
}

/** Dev/smoke seam: point the direct client at a non-default MCP endpoint. */
export function setElectronAxBiMcpUrlOverride(url: string | null): void {
  if (url === null) {
    safeStorageRemoveItem(
      localStorage,
      localStorageKey.axBiMcpUrlOverride,
      STORAGE_CONTEXT
    )
    return
  }
  safeStorageSetItem(
    localStorage,
    localStorageKey.axBiMcpUrlOverride,
    normalizeAxBiMcpUrl(url),
    STORAGE_CONTEXT
  )
}

/**
 * Direct `AxBI` client built from the configured URL.
 * Cached so the MCP session (initialize handshake) is reused across calls;
 * credential retrieval and HTTP are delegated to Electron's main process.
 */
export async function getDirectAxBiClient(): Promise<AxBI> {
  if (!(await hasStoredAxBiMcpToken())) throw new Error(MISSING_TOKEN_ERROR)
  const mcpUrl = getElectronAxBiMcpUrl()
  const key = mcpUrl
  if (!cachedClient || cachedClient.key !== key) {
    cachedClient = {
      key,
      client: new AxBI({
        baseUrl: DEFAULT_AX_BI_WEB_URL,
        mcpUrl,
        mcpTransport: electronMcpTransport,
      }),
    }
  }
  return cachedClient.client
}

/** Test seam: drop the cached client (and its MCP session). */
export function resetDirectAxBiClientCache(): void {
  cachedClient = null
}

/**
 * `AxBiAuthoringClient` backed by the direct SDK path. Lazily resolves the
 * stored token per call so it can be constructed synchronously like the
 * serviceHub variant — `authoring-workflow.ts` needs no changes.
 */
export function createDirectAxBiAuthoringClient(): AxBiAuthoringClient {
  return {
    ai: {
      getAuthoringCapabilities: async () =>
        (await getDirectAxBiClient()).ai.getAuthoringCapabilities(),
      createChartFromIntent: async (request) =>
        (await getDirectAxBiClient()).ai.createChartFromIntent(request),
      planDashboard: async (request) =>
        (await getDirectAxBiClient()).ai.planDashboard(request),
      promptToDashboard: async (request) =>
        (await getDirectAxBiClient()).ai.promptToDashboard(request),
      uploadAndPlan: async (request) =>
        (await getDirectAxBiClient()).ai.uploadAndPlan(request),
    },
  }
}

/**
 * Zero-config connect: store the API key (when given), handshake against the
 * MCP endpoint, and record the outcome in the connection store. Returns the
 * normalized MCP URL, mirroring `connectAxBiMcpServer`.
 */
export async function connectAxBiDirect({
  token,
}: { token?: string } = {}): Promise<string> {
  const connection = useAxBiConnection.getState()
  connection.setStatus('connecting')
  try {
    if (token !== undefined && token.trim().length > 0) {
      await storeAxBiMcpToken(normalizeAxBiToken(token))
      resetDirectAxBiClientCache()
    }
    if (!(await hasStoredAxBiMcpToken())) {
      connection.setStatus('needs-key')
      throw new Error(MISSING_TOKEN_ERROR)
    }
    const client = await getDirectAxBiClient()
    await client.ai.getAuthoringCapabilities()
    connection.setStatus('connected')
    return getElectronAxBiMcpUrl()
  } catch (error) {
    if (useAxBiConnection.getState().status !== 'needs-key') {
      const classified = classifyAxBiConnectionError(error)
      connection.setStatus(
        classified.kind === 'auth' ? 'needs-key' : 'unreachable',
        classified.message
      )
    }
    throw error
  }
}

/** Remove the saved AX BI credential and drop the cached MCP session. */
export async function disconnectAxBiDirect(): Promise<void> {
  await clearStoredAxBiMcpToken()
  resetDirectAxBiClientCache()
  useAxBiConnection.getState().setStatus('needs-key')
}

/**
 * Auto-reconnect on app start: when a token exists, warm the direct client
 * (handshake + capabilities) and update the status store. Silent by design.
 */
export async function probeAxBiDirectConnection(): Promise<void> {
  try {
    if (!(await hasStoredAxBiMcpToken())) {
      useAxBiConnection.getState().setStatus('needs-key')
      return
    }
    await connectAxBiDirect()
  } catch {
    // connectAxBiDirect already recorded needs-key / unreachable.
  }
}
