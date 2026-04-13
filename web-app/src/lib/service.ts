import { CoreRoutes, APIRoutes } from '@ax-studio/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform'
import type { InvokeArgs } from '@/services/core/types'

export const AppRoutes = [
  'installExtensions',
  'getTools',
  'callTool',
  'cancelToolCall',
  'listThreads',
  'createThread',
  'modifyThread',
  'deleteThread',
  'listMessages',
  'createMessage',
  'modifyMessage',
  'deleteMessage',
  'getThreadAssistant',
  'createThreadAssistant',
  'modifyThreadAssistant',
  'saveMcpConfigs',
  'getMcpConfigs',
  'restartMcpServers',
  'getConnectedServers',
  'readLogs',
  'changeAppDataFolder',
]
// Define API routes based on different route types
export const Routes = [...CoreRoutes, ...APIRoutes, ...AppRoutes].map((r) => ({
  path: `app`,
  route: r,
}))

// Function to open an external URL in a new browser window
export function openExternalUrl(url: string) {
  window?.open(url, '_blank')
}

// Tauri filesystem-style commands whose Rust signature is
//   fn name(app_handle, request: SomeRequest)
// Tauri's IPC layer expects the payload as `{ request: { ... } }`.
// Every entry here gets wrapped automatically below so callers can keep
// using the legacy `{ args: [...] }` / `{ path: "..." }` shapes.
const REQUEST_WRAPPED_COMMANDS = new Set<string>([
  'rm',
  'mkdir',
  'mv',
  'join_path',
  'exists_sync',
  'file_stat',
  'read_file_sync',
  'write_file_sync',
  'readdir_sync',
  'read_dir_sync',
  'write_yaml',
  'read_yaml',
  'decompress',
  'append_file_sync',
  'unlink_sync',
])

export const APIs = {
  ...Object.values(Routes).reduce((acc, proxy) => {
    return {
      ...acc,
      [proxy.route]: (args?: InvokeArgs) => {
        if (isPlatformTauri()) {
          // For Tauri platform, use the service hub to invoke commands
          const command = proxy.route.replace(/([A-Z])/g, '_$1').toLowerCase()

          // Backward-compatible shim for start_server: wrap args into { config }
          if (command === 'start_server') {
            // If already using new shape, pass through
            if (args && 'config' in args) {
              return getServiceHub().core().invoke(command, args)
            }

            const raw: Record<string, unknown> = (args || {}) as Record<string, unknown>

            const pickString = (obj: Record<string, unknown>, keys: string[]): string | undefined => {
              for (const key of keys) {
                const value = obj[key]
                if (typeof value === 'string') return value
              }
              return undefined
            }

            const pickNumber = (obj: Record<string, unknown>, keys: string[]): number | undefined => {
              for (const key of keys) {
                const value = obj[key]
                if (typeof value === 'number') return value
              }
              return undefined
            }

            const pickStringArray = (obj: Record<string, unknown>, keys: string[]): string[] | undefined => {
              for (const key of keys) {
                const value = obj[key]
                if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
                  return value as string[]
                }
              }
              return undefined
            }

            const config = {
              host: pickString(raw, ['host']),
              port: pickNumber(raw, ['port']),
              prefix: pickString(raw, ['prefix']),
              api_key: pickString(raw, ['api_key', 'apiKey']),
              trusted_hosts: pickStringArray(raw, ['trusted_hosts', 'trustedHosts']),
              cors_enabled:
                typeof raw.isCorsEnabled === 'boolean'
                  ? raw.isCorsEnabled
                  : typeof raw.cors_enabled === 'boolean'
                    ? raw.cors_enabled
                    : undefined,
              proxy_timeout: pickNumber(raw, ['proxy_timeout', 'proxyTimeout']),
            }
            return getServiceHub().core().invoke(command, { config })
          }

          // Wrap args for commands whose Rust signature takes a `request:` param.
          // Without this wrap, Tauri rejects the IPC call with
          // "missing required key request" and the caller sees a cryptic string.
          if (REQUEST_WRAPPED_COMMANDS.has(command)) {
            // If the caller already wrapped it (defensive), pass through.
            if (args && typeof args === 'object' && 'request' in args) {
              return getServiceHub().core().invoke(command, args)
            }
            return getServiceHub().core().invoke(command, { request: args ?? {} })
          }

          return getServiceHub().core().invoke(command, args)
        } else {
          // For Web platform, provide fallback implementations
          console.warn(`API call '${proxy.route}' not supported in web environment`, args)
          return Promise.resolve(null)
        }
      },
    }
  }, {}),
  openExternalUrl,
}
