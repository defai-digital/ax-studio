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

// Filesystem commands in src-tauri/src/core/filesystem/commands.rs take a
// single struct parameter named `request` (e.g. `request: SinglePathRequest`).
// In Tauri 2 the parameter name maps to a top-level key in the invoke args,
// so a JS call like `existsSync({ args: ['/path'] })` produces
// `{ args: ['/path'] }` and Tauri reports
// "command exists_sync missing required key request".
//
// Core's fs/core helper modules (`core/src/browser/fs.ts`,
// `core/src/browser/core.ts`) still use the legacy unwrapped shape, so we
// wrap them here. Also covers a couple of commands that nominally live
// outside `filesystem/commands.rs` but use the same `request: ...` pattern
// (`open_file_explorer` is parameter-named directly so it's *not* in the set).
const FILESYSTEM_REQUEST_COMMANDS: ReadonlySet<string> = new Set([
  'exists_sync',
  'join_path',
  'mkdir',
  'rm',
  'mv',
  'file_stat',
  'read_file_sync',
  'write_file_sync',
  'readdir_sync',
  'unlink_sync',
  'append_file_sync',
  'write_yaml',
  'read_yaml',
  'decompress',
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

          // Wrap legacy unwrapped filesystem-command args under `request:`
          // unless the caller already supplied that key.
          if (
            FILESYSTEM_REQUEST_COMMANDS.has(command) &&
            args &&
            !('request' in args)
          ) {
            return getServiceHub()
              .core()
              .invoke(command, { request: args })
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
