// Internal API proxy command handlers (Node port of
// src-tauri/src/core/server/commands.rs and remote_provider_commands.rs).
// The renderer registers provider credentials here; the proxy in
// electron/src/server/ injects them into upstream requests.
import { str, unwrapRequest } from './args.js'
import type { CommandHandler } from './registry.js'
import {
  abortRemoteStream,
  listProviderConfigs,
  registerProviderConfig,
  registerProviderConfigsBatch,
  unregisterProviderConfig,
  type RegisterProviderRequest,
} from '../server/providers.js'
import {
  isServerRunning,
  startProxyServer,
  stopProxyServer,
  type ProxyConfig,
} from '../server/proxy.js'

type Args = Record<string, unknown>

interface StartServerConfig {
  host: string
  port: number
  prefix: string
  api_key: string
  trusted_hosts: string[]
  cors_enabled: boolean
  verbose_logs: boolean
  proxy_timeout: number
}

/**
 * The proxy only needs an API key when something other than the local app can
 * reach it: CORS on (any browser origin) or a non-loopback bind address.
 * (commands.rs requires_authentication)
 */
function requiresAuthentication(host: string, corsEnabled: boolean): boolean {
  return corsEnabled || !['127.0.0.1', 'localhost', '::1'].includes(host)
}

function startServerConfig(args: Args | undefined): StartServerConfig {
  // web-app/src/lib/service.ts wraps start_server args under { config }.
  const raw = unwrapRequest(args)
  const config = (
    raw.config !== null && typeof raw.config === 'object' ? raw.config : raw
  ) as Record<string, unknown>

  const host = str(config.host) ?? ''
  const port = typeof config.port === 'number' ? config.port : 0
  const prefix = str(config.prefix) ?? '/v1'
  const apiKey = str(config.api_key) ?? str(config.apiKey) ?? ''
  const trustedHostsSource = config.trusted_hosts ?? config.trustedHosts
  const trustedHosts = Array.isArray(trustedHostsSource)
    ? trustedHostsSource.filter((h): h is string => typeof h === 'string')
    : []
  const corsEnabled =
    typeof config.cors_enabled === 'boolean'
      ? config.cors_enabled
      : typeof config.corsEnabled === 'boolean'
        ? config.corsEnabled
        : false
  const verboseLogs =
    typeof config.verbose_logs === 'boolean'
      ? config.verbose_logs
      : typeof config.verboseLogs === 'boolean'
        ? config.verboseLogs
        : false
  const proxyTimeout =
    typeof config.proxy_timeout === 'number'
      ? config.proxy_timeout
      : typeof config.proxyTimeout === 'number'
        ? config.proxyTimeout
        : 600

  return {
    host,
    port,
    prefix,
    api_key: apiKey,
    trusted_hosts: trustedHosts,
    cors_enabled: corsEnabled,
    verbose_logs: verboseLogs,
    proxy_timeout: proxyTimeout,
  }
}

function providerRequest(args: Args | undefined): RegisterProviderRequest {
  const raw = unwrapRequest(args)
  const customHeaders = raw.custom_headers ?? raw.customHeaders
  return {
    provider: str(raw.provider) ?? '',
    api_key: typeof raw.api_key === 'string' ? raw.api_key : typeof raw.apiKey === 'string' ? raw.apiKey : null,
    base_url: typeof raw.base_url === 'string' ? raw.base_url : typeof raw.baseUrl === 'string' ? raw.baseUrl : null,
    custom_headers: Array.isArray(customHeaders)
      ? customHeaders
          .filter((h): h is Record<string, unknown> => h !== null && typeof h === 'object')
          .map((h) => ({ header: String(h.header ?? ''), value: String(h.value ?? '') }))
      : [],
    models: Array.isArray(raw.models)
      ? raw.models.filter((m): m is string => typeof m === 'string')
      : [],
  }
}

export function createServerHandlers(): Record<string, CommandHandler> {
  return {
    start_server: async (args) => {
      const config = startServerConfig(args)

      if (requiresAuthentication(config.host, config.cors_enabled) && config.api_key.trim().length === 0) {
        throw new Error(
          'An API key is required when CORS is enabled or the server binds to a non-loopback host'
        )
      }
      if (config.port === 0) {
        throw new Error('Port must be a non-zero value')
      }
      if (config.host.trim().length === 0) {
        throw new Error('Host must not be empty')
      }

      const proxyConfig: ProxyConfig = {
        prefix: config.prefix,
        proxyApiKey: config.api_key,
        trustedHosts: [config.trusted_hosts],
        corsEnabled: config.cors_enabled,
        verboseLogs: config.verbose_logs,
        host: config.host,
      }
      return startProxyServer(config.host, config.port, proxyConfig, config.proxy_timeout)
    },

    stop_server: async () => {
      await stopProxyServer()
    },

    get_server_status: () => isServerRunning(),

    register_provider_config: async (args) => {
      await registerProviderConfig(providerRequest(args))
    },

    register_provider_configs_batch: async (args) => {
      const rawRequests = args?.requests
      if (!Array.isArray(rawRequests)) {
        throw new Error('register_provider_configs_batch: missing requests')
      }
      const requests = rawRequests.map((request) =>
        providerRequest(request !== null && typeof request === 'object' ? (request as Args) : {})
      )
      await registerProviderConfigsBatch(requests)
    },

    unregister_provider_config: (args) => {
      const provider = str(args?.provider)
      if (!provider) throw new Error('Invalid provider name')
      unregisterProviderConfig(provider)
    },

    list_provider_configs: () => listProviderConfigs(),

    abort_remote_stream: (args) => {
      const streamId = str(args?.streamId) ?? str(args?.stream_id)
      if (!streamId) throw new Error('Invalid stream identifier')
      abortRemoteStream(streamId)
    },
  }
}
