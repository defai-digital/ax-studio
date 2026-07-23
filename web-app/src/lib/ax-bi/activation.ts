/**
 * Shared inject-at-activation path for ax-bi MCP.
 * Reads the keychain token, injects Authorization only into the runtime config
 * (never into persisted mcp_config.json), activates the server, then persists
 * `active: true` only after success and keeps the zustand store in sync.
 */
import type { ServiceHub } from '@/services'
import type { MCPConfig } from '@/services/mcp/types'
import {
  type MCPServerConfig,
  useMCPServers,
} from '@/hooks/tools/useMCPServers'
import {
  readStoredAxBiMcpToken,
  storeAxBiMcpToken,
} from './token-storage'
import {
  AX_BI_SERVER,
  DEFAULT_AX_BI_MCP_URL,
  normalizeAxBiMcpUrl,
} from './endpoints'

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

/**
 * Normalize a user- or keychain-supplied AX BI token.
 * Strips optional leading `Bearer ` (case-insensitive) and trims whitespace.
 */
export function normalizeAxBiToken(token: string): string {
  let normalized = token.trim()
  if (/^bearer\s+/i.test(normalized)) {
    normalized = normalized.replace(/^bearer\s+/i, '').trim()
  }
  if (!normalized) {
    throw new Error('AX BI API key or JWT is required.')
  }
  if (containsControlCharacter(normalized)) {
    throw new Error('AX BI API key or JWT contains invalid characters.')
  }
  return normalized
}

function removeAuthorizationHeader(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined
  const filtered = Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => name.toLowerCase() !== 'authorization'
    )
  )
  return Object.keys(filtered).length > 0 ? filtered : undefined
}

function syncAxBiServerToStore(persisted: MCPServerConfig): void {
  const store = useMCPServers.getState()
  if (store.getServerConfig(AX_BI_SERVER)) {
    store.editServer(AX_BI_SERVER, persisted)
  } else {
    store.addServer(AX_BI_SERVER, persisted)
  }
}

async function writeAxBiPersistedConfig(
  serviceHub: ServiceHub,
  persistedServer: MCPServerConfig
): Promise<void> {
  const config = await serviceHub
    .mcp()
    .getMCPConfig()
    .catch((): MCPConfig => ({}))
  await serviceHub.mcp().updateMCPConfig(
    JSON.stringify({
      mcpServers: {
        ...(config.mcpServers ?? {}),
        [AX_BI_SERVER]: persistedServer,
      },
      mcpSettings: config.mcpSettings,
    })
  )
}

async function markAxBiInactive(
  serviceHub: ServiceHub,
  baseServer: MCPServerConfig
): Promise<void> {
  const inactive: MCPServerConfig = { ...baseServer, active: false }
  try {
    await writeAxBiPersistedConfig(serviceHub, inactive)
    syncAxBiServerToStore(inactive)
  } catch (error) {
    console.warn(
      '[ax-bi] Failed to persist inactive state after activation error:',
      error
    )
  }
}

function buildBaseServer(
  existingServer: MCPServerConfig | undefined,
  normalizedUrl: string
): MCPServerConfig {
  return {
    ...existingServer,
    command: existingServer?.command ?? '',
    args: existingServer?.args ?? [],
    env: existingServer?.env ?? {},
    type: 'http',
    url: normalizedUrl,
    headers: removeAuthorizationHeader(existingServer?.headers),
    active: false,
  }
}

/**
 * Activate ax-bi using the token already stored in the OS keychain
 * (or an optional already-normalized `token` override, e.g. right after
 * a connect form submit stores a new key).
 * Authorization is injected only into the runtime activate call.
 */
export async function activateAxBiWithStoredToken(
  serviceHub: ServiceHub,
  options?: { url?: string; token?: string }
): Promise<string> {
  let authToken: string
  if (options?.token !== undefined && options.token.trim().length > 0) {
    authToken = normalizeAxBiToken(options.token)
  } else {
    const stored = await readStoredAxBiMcpToken()
    if (!stored || !stored.trim()) {
      throw new Error('AX BI API key or JWT is required.')
    }
    authToken = normalizeAxBiToken(stored)
  }

  const config = await serviceHub
    .mcp()
    .getMCPConfig()
    .catch((): MCPConfig => ({}))
  const existingServer = config.mcpServers?.[AX_BI_SERVER]
  const normalizedUrl = normalizeAxBiMcpUrl(
    options?.url ?? existingServer?.url ?? DEFAULT_AX_BI_MCP_URL
  )
  const baseServer = buildBaseServer(existingServer, normalizedUrl)
  const runtimeServer: MCPServerConfig = {
    ...baseServer,
    active: true,
    headers: {
      ...(baseServer.headers ?? {}),
      Authorization: `Bearer ${authToken}`,
    },
  }

  try {
    await serviceHub.mcp().activateMCPServer(AX_BI_SERVER, runtimeServer)
  } catch (error) {
    await markAxBiInactive(serviceHub, baseServer)
    throw error
  }

  const persistedServer: MCPServerConfig = { ...baseServer, active: true }
  await writeAxBiPersistedConfig(serviceHub, persistedServer)
  syncAxBiServerToStore(persistedServer)
  return normalizedUrl
}

/**
 * Connect path: optionally store a new token, then activate via the shared helper.
 */
export async function connectAxBiMcpServer({
  serviceHub,
  url,
  token,
}: {
  serviceHub: ServiceHub
  url: string
  token?: string
}): Promise<string> {
  let authToken: string | undefined
  if (token !== undefined && token.trim().length > 0) {
    authToken = normalizeAxBiToken(token)
    await storeAxBiMcpToken(authToken)
  } else {
    const existing = await readStoredAxBiMcpToken()
    if (!existing || !existing.trim()) {
      throw new Error('AX BI API key or JWT is required.')
    }
    // Validate stored token shape (e.g. reject control chars / empty after strip)
    authToken = normalizeAxBiToken(existing)
  }

  return activateAxBiWithStoredToken(serviceHub, { url, token: authToken })
}
