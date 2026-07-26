// llamacpp plugin command handlers (Node port of tauri-plugin-llamacpp).
// Command names keep the exact `plugin:llamacpp|<name>` keys the guest-js
// invokes — the shim passes the command string through verbatim.
import { str } from './args.js'
import type { CommandHandler } from './registry.js'
import * as backend from '../llamacpp/backend.js'
import { getDevicesFromBackend } from '../llamacpp/device.js'
import { estimateKVCacheSize, getModelSize, isModelSupported, readGgufMetadata } from '../llamacpp/gguf.js'
import { trustedBinaryRoots } from '../llamacpp/path.js'
import {
  cleanupLlamaProcesses,
  findSessionByModel,
  generateApiKey,
  getAllSessions,
  getLoadedModels,
  getRandomPort,
  isProcessRunning,
  loadLlamaModel,
  unloadLlamaModel,
} from '../llamacpp/session.js'

type Args = Record<string, unknown>

function requiredStr(args: Args | undefined, ...names: string[]): string {
  for (const name of names) {
    const value = str(args?.[name])
    if (value) return value
  }
  throw new Error(`Invalid argument: missing ${names.join('/')}`)
}

function requiredNumber(args: Args | undefined, ...names: string[]): number {
  for (const name of names) {
    const value = args?.[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  throw new Error(`Invalid argument: missing ${names.join('/')}`)
}

function optionalNumber(args: Args | undefined, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = args?.[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Args)) {
    if (typeof entry === 'string') record[key] = entry
  }
  return record
}

function backendList(value: unknown): backend.BackendInfo[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (entry): entry is Args =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry),
    )
    .map((entry) => ({
      version: typeof entry.version === 'string' ? entry.version : '',
      backend: typeof entry.backend === 'string' ? entry.backend : '',
    }))
}

export function createLlamacppHandlers(): Record<string, CommandHandler> {
  return {
    // ── Server lifecycle ────────────────────────────────────────────────
    'plugin:llamacpp|load_llama_model': (args) => loadLlamaModel(args ?? {}),
    'plugin:llamacpp|unload_llama_model': (args) =>
      unloadLlamaModel(requiredNumber(args, 'pid')),
    'plugin:llamacpp|get_devices': (args) =>
      getDevicesFromBackend(
        requiredStr(args, 'backendPath', 'backend_path'),
        stringRecord(args?.envs),
        trustedBinaryRoots(),
      ),
    'plugin:llamacpp|generate_api_key': (args) =>
      generateApiKey(
        requiredStr(args, 'modelId', 'model_id'),
        requiredStr(args, 'apiSecret', 'api_secret'),
      ),
    'plugin:llamacpp|is_process_running': (args) => isProcessRunning(requiredNumber(args, 'pid')),
    'plugin:llamacpp|get_random_port': () => getRandomPort(),
    'plugin:llamacpp|find_session_by_model': (args) =>
      findSessionByModel(requiredStr(args, 'modelId', 'model_id')),
    'plugin:llamacpp|get_loaded_models': () => getLoadedModels(),
    'plugin:llamacpp|get_all_sessions': () => getAllSessions(),
    // NOTE: `plugin:llamacpp|start_ax_serving` is intentionally NOT
    // registered — ax-serving is discontinued; the registry answers
    // unimplemented_command.

    // ── GGUF ────────────────────────────────────────────────────────────
    'plugin:llamacpp|read_gguf_metadata': (args) =>
      readGgufMetadata(requiredStr(args, 'path')),
    'plugin:llamacpp|estimate_kv_cache_size': (args) =>
      estimateKVCacheSize(
        stringRecord(args?.meta),
        optionalNumber(args, 'ctxSize', 'ctx_size'),
      ),
    'plugin:llamacpp|get_model_size': (args) => getModelSize(requiredStr(args, 'path')),
    'plugin:llamacpp|is_model_supported': (args) =>
      isModelSupported(
        requiredStr(args, 'path'),
        optionalNumber(args, 'ctxSize', 'ctx_size'),
      ),

    // ── Cleanup ─────────────────────────────────────────────────────────
    'plugin:llamacpp|cleanup_llama_processes': () => cleanupLlamaProcesses(),

    // ── Backend management ──────────────────────────────────────────────
    'plugin:llamacpp|map_old_backend_to_new': (args) =>
      backend.mapOldBackendToNew(requiredStr(args, 'oldBackend', 'old_backend')),
    'plugin:llamacpp|get_local_installed_backends': (args) =>
      backend.getLocalInstalledBackends(requiredStr(args, 'backendsDir', 'backends_dir')),
    'plugin:llamacpp|list_supported_backends': (args) =>
      backend.listSupportedBackends(
        backendList(args?.remoteBackendVersions ?? args?.remote_backend_versions),
        backendList(args?.localBackendVersions ?? args?.local_backend_versions),
      ),
    'plugin:llamacpp|determine_supported_backends': (args) =>
      backend.determineSupportedBackends(
        requiredStr(args, 'osType', 'os_type'),
        requiredStr(args, 'arch'),
        (args?.features ?? {}) as backend.BackendFeatures,
      ),
    'plugin:llamacpp|get_supported_features': (args) =>
      backend.getSupportedFeatures(
        requiredStr(args, 'osType', 'os_type'),
        Array.isArray(args?.cpuExtensions)
          ? (args.cpuExtensions as unknown[]).filter((e): e is string => typeof e === 'string')
          : Array.isArray(args?.cpu_extensions)
            ? (args.cpu_extensions as unknown[]).filter((e): e is string => typeof e === 'string')
            : [],
        Array.isArray(args?.gpus) ? (args.gpus as backend.GpuInfoInput[]) : [],
      ),
    'plugin:llamacpp|is_cuda_installed': (args) =>
      backend.isCudaInstalled(
        requiredStr(args, 'backendDir', 'backend_dir'),
        requiredStr(args, 'version'),
        requiredStr(args, 'osType', 'os_type'),
        requiredStr(args, 'appDataFolderPath', 'app_data_folder_path'),
      ),
    'plugin:llamacpp|find_latest_version_for_backend': (args) =>
      backend.findLatestVersionForBackend(
        backendList(args?.versionBackends ?? args?.version_backends),
        requiredStr(args, 'backendType', 'backend_type'),
      ),
    'plugin:llamacpp|prioritize_backends': (args) =>
      backend.prioritizeBackends(
        backendList(args?.versionBackends ?? args?.version_backends),
        args?.hasEnoughGpuMemory === true || args?.has_enough_gpu_memory === true,
      ),
    'plugin:llamacpp|parse_backend_version': (args) =>
      backend.parseBackendVersion(requiredStr(args, 'versionString', 'version_string')),
    'plugin:llamacpp|check_backend_for_updates': (args) =>
      backend.checkBackendForUpdates(
        requiredStr(args, 'currentBackendString', 'current_backend_string'),
        backendList(args?.versionBackends ?? args?.version_backends),
      ),
    'plugin:llamacpp|remove_old_backend_versions': (args) =>
      backend.removeOldBackendVersions(
        requiredStr(args, 'backendsDir', 'backends_dir'),
        requiredStr(args, 'latestVersion', 'latest_version'),
        requiredStr(args, 'backendType', 'backend_type'),
      ),
    'plugin:llamacpp|validate_backend_string': (args) =>
      backend.validateBackendString(requiredStr(args, 'backendString', 'backend_string')),
    'plugin:llamacpp|should_migrate_backend': (args) =>
      backend.shouldMigrateBackend(
        requiredStr(args, 'storedBackendType', 'stored_backend_type'),
        backendList(args?.versionBackends ?? args?.version_backends),
      ),
    'plugin:llamacpp|handle_setting_update': (args) =>
      backend.handleSettingUpdate(
        requiredStr(args, 'key'),
        typeof args?.value === 'string' ? args.value : '',
        str(args?.currentStoredBackend) ?? str(args?.current_stored_backend),
      ),
  }
}
