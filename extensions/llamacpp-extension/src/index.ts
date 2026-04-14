/**
 * Ax-Studio llama.cpp Extension — Main Engine Class
 *
 * Implements AIEngine from @ax-studio/core to provide local LLM inference
 * via llama.cpp. Written from scratch for Ax-Studio (UNLICENSED).
 *
 * Capabilities:
 *  - Load / unload GGUF models via tauri-plugin-llamacpp
 *  - Streaming and non-streaming chat completions
 *  - Embedding generation with auto-batching
 *  - GGUF metadata validation (tool support, architecture)
 *  - Backend auto-download, update, and manual install
 *  - Vision / multimodal model support (mmproj.gguf)
 *  - Auto-unload: one text model active at a time
 */

import {
  AIEngine,
  modelInfo,
  SessionInfo,
  UnloadResult,
  ImportOptions,
  chatCompletionRequest,
  chatCompletion,
  chatCompletionChunk,
  getAppDataFolderPath,
  joinPath,
  fs,
  events,
  AppEvent,
  DownloadEvent,
  ModelEvent,
  showToast,
} from '@ax-studio/core'

import {
  loadLlamaModel,
  unloadLlamaModel,
  startAxServing,
  DeviceInfo,
  getDevices,
  generateApiKey,
  isProcessRunning,
  findSessionByModel,
  getLoadedModels,
  getRandomPort,
  readGgufMetadata,
  getModelSize,
  isModelSupported,
  normalizeLlamacppConfig,
  LlamacppConfig,
  DeviceList,
  GgufMetadata,
} from '@ax-studio/tauri-plugin-llamacpp-api'

import { invoke } from '@tauri-apps/api/core'

import {
  configureBackends,
  downloadBackend,
  updateBackend,
  installBackendFromFile,
  getBackendExePath,
  getAxServingBinaryPath,
  BackendUpdateInfo,
  checkForBackendUpdate,
  fetchRemoteBackends,
} from './backend'

import {
  parseSimpleYaml,
  toSimpleYaml,
  getProxyConfig,
  buildProxyArg,
  buildEmbedBatches,
  mergeEmbedResponses,
  EmbeddingResponse,
} from './util'
import { decideLocalProviderSync } from './provider-sync'

// Build-time constants — see env.d.ts for declarations

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelConfig {
  model_path: string
  mmproj_path?: string
  name: string
  size_bytes: number
  embedding?: boolean
  sha256?: string
  mmproj_sha256?: string
}

type EnvMap = Record<string, string>

interface EmbedOptions {
  modelId: string
  inputs: string[]
}

interface TokenCountOptions {
  modelId: string
  messages: chatCompletionRequest['messages']
}

type SettingValue = string | string[] | number | boolean | null | undefined

type UpdateSettingPayload = {
  key: string
  controllerProps: {
    value: string
  }
}

type ImportOptionsWithHeaders = ImportOptions & {
  downloadHeaders?: Record<string, string>
}

type AxServingLoadRequest = {
  model_id: string
  path: string
  mmproj_path?: string
  n_gpu_layers?: number
  context_length?: number
}

type ChatRequestBody = chatCompletionRequest & {
  stream: boolean
  return_progress: true
  mirostat?: number | null
  mirostat_tau?: number | null
  mirostat_eta?: number | null
}

type DeviceInfoLike = DeviceInfo | DeviceList

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const toNumberSetting = (value: SettingValue, defaultValue = 0): number =>
  value === '' || value == null ? defaultValue : Number(value)

const toBooleanSetting = (value: SettingValue): boolean =>
  value === true || value === 'true' || value === 1 || value === '1'

const toStringSetting = (value: SettingValue, defaultValue = ''): string =>
  value == null || value === '' ? defaultValue : String(value)

async function computeFileSha256Browser(filePath: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API unavailable')
  }

  const response = await fetch(filePath)
  if (!response.ok) {
    throw new Error(`Failed to read file for SHA256 validation: ${response.status}`)
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    await response.arrayBuffer()
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const ALLOWED_LOAD_OVERRIDE_KEYS = new Set<keyof LlamacppConfig>([
  'fit',
  'fit_target',
  'fit_ctx',
  'chat_template',
  'n_gpu_layers',
  'offload_mmproj',
  'cpu_moe',
  'n_cpu_moe',
  'override_tensor_buffer_t',
  'ctx_size',
  'threads',
  'threads_batch',
  'n_predict',
  'batch_size',
  'ubatch_size',
  'device',
  'split_mode',
  'main_gpu',
  'flash_attn',
  'cont_batching',
  'no_mmap',
  'mlock',
  'no_kv_offload',
  'cache_type_k',
  'cache_type_v',
  'defrag_thold',
  'rope_scaling',
  'rope_scale',
  'rope_freq_base',
  'rope_freq_scale',
  'ctx_shift',
])

const DEFAULT_LOAD_TIMEOUT_SECONDS = 600
const AX_SERVING_PORT_CHECK_TIMEOUT_MS = 3_000
const AX_SERVING_HEALTH_CHECK_TIMEOUT_MS = 5_000

// ─── Main Extension Class ─────────────────────────────────────────────────────

export default class AxStudioLlamacppExtension extends AIEngine {
  readonly provider: string = 'llamacpp'
  readonly providerId: string = 'llamacpp'

  /** When true, auto-unload existing text model before loading a new one */
  private autoUnload: boolean = true
  /** Max seconds to wait for model to become ready */
  private timeout: number = DEFAULT_LOAD_TIMEOUT_SECONDS
  /** The active LlamacppConfig built from extension settings */
  private config: Partial<LlamacppConfig> = {}
  /** Per-model load promises — prevents duplicate load calls */
  private loadingModels: Map<string, Promise<SessionInfo>> = new Map()
  /** Per-backend download promises — prevents duplicate downloads */
  private pendingDownloads: Map<string, Promise<void>> = new Map()
  /** Whether to emit backend update events */
  private autoUpdateEngine: boolean = true
  /** Mirostat settings (passed at inference time, not server start) */
  private mirostat: number = 0
  private mirostatLr: number = 0.1
  private mirostatEnt: number = 5.0
  /** Grammar / JSON schema file paths (passed at inference time) */
  private grammarFile: string = ''
  private jsonSchemaFile: string = ''
  /** Unload listeners to clean up */
  private cleanupListeners: Array<() => void> = []
  /** Serialize backend engine transitions triggered by settings changes */
  private engineSwitchQueue: Promise<void> = Promise.resolve()

  // ─── ax-serving state ─────────────────────────────────────────────────────
  /** Port the ax-serving service is listening on (0 = not running) */
  private axServingPort: number = 0
  /** PID of the ax-serving process (0 = not running) */
  private axServingPid: number = 0
  /** Sessions for models loaded via ax-serving HTTP API */
  private axServingSessions: Map<string, SessionInfo> = new Map()
  /** Coalesces concurrent ax-serving start attempts */
  private axServingStarting: Promise<void> | null = null

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  override async onLoad(): Promise<void> {
    const rawSettings = SETTINGS
    const isMac = IS_MACOS

    // On macOS, Auto-Fit defaults to false — Metal handles memory internally.
    const settingsToRegister = isMac
      ? rawSettings.map((setting: SettingDefinition) =>
          setting.key === 'fit'
            ? {
                ...setting,
                controllerProps: { ...setting.controllerProps, value: false },
              }
            : setting
        )
      : rawSettings
    await this.registerSettings(settingsToRegister)

    // Read settings and populate local state
    await this._syncSettingsToConfig()

    // Discover / download the best backend for this hardware
    const versionBackend = await this.getSetting<string>('version_backend', '')
    void configureBackends(
      versionBackend,
      this.autoUpdateEngine,
      (key: string, value: string) => this._updateSettingValue(key, value)
    ).catch((e) => {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[llamacpp] Background backend config failed:', e)
      showToast(
        'llama.cpp backend setup failed',
        `Backend configuration failed: ${message}`
      )
    })

    this.registerEngine()
  }

  override async onUnload(): Promise<void> {
    const loadedModels = await this.getLoadedModels().catch(
      () => [] as string[]
    )
    for (const modelId of loadedModels) {
      await this.unload(modelId).catch((error) => {
        console.warn(`[llamacpp] Failed to unload ${modelId} during extension shutdown:`, error)
      })
    }

    if (this.axServingPid > 0) {
      try {
        await unloadLlamaModel(this.axServingPid)
      } catch (error) {
        console.warn('[llamacpp] Failed to stop ax-serving during shutdown:', error)
      }
      this.axServingPid = 0
      this.axServingPort = 0
      this.axServingSessions.clear()
    }
    await this._syncLocalProviderRegistration()

    for (const off of this.cleanupListeners) {
      try {
        off()
      } catch (error) {
        console.warn('[llamacpp] Cleanup listener failed during unload:', error)
      }
    }
    this.cleanupListeners = []
  }

  // ─── Settings sync ─────────────────────────────────────────────────────────

  /** Read all settings from localStorage and populate local config state */
  private async _syncSettingsToConfig(): Promise<void> {
    const settings = await this.getSettings()
    for (const s of settings) {
      this.onSettingUpdate(s.key, s.controllerProps?.value)
    }
  }

  override onSettingUpdate<T>(key: string, value: T): void {
    const settingValue = value as SettingValue
    const cfg = this.config
    switch (key) {
      case 'version_backend':
        cfg.version_backend = toStringSetting(settingValue)
        break
      case 'auto_update_engine':
        this.autoUpdateEngine = toBooleanSetting(settingValue)
        cfg.auto_update_engine = toBooleanSetting(settingValue)
        break
      case 'auto_unload':
        this.autoUnload = toBooleanSetting(settingValue)
        cfg.auto_unload = toBooleanSetting(settingValue)
        break
      case 'timeout':
        this.timeout = toNumberSetting(settingValue, DEFAULT_LOAD_TIMEOUT_SECONDS)
        cfg.timeout = toNumberSetting(settingValue, DEFAULT_LOAD_TIMEOUT_SECONDS)
        break
      case 'llamacpp_env':
        cfg.llamacpp_env = toStringSetting(settingValue)
        break
      case 'fit':
        cfg.fit = toBooleanSetting(settingValue)
        break
      case 'fit_target':
        cfg.fit_target = toStringSetting(settingValue, '1024')
        break
      case 'fit_ctx':
        cfg.fit_ctx = toStringSetting(settingValue, '4096')
        break
      case 'ctx_size':
        cfg.ctx_size = toNumberSetting(settingValue, 0)
        break
      case 'threads':
        cfg.threads = toNumberSetting(settingValue, -1)
        break
      case 'threads_batch':
        cfg.threads_batch = toNumberSetting(settingValue, -1)
        break
      case 'n_predict':
        cfg.n_predict = toNumberSetting(settingValue, -1)
        break
      case 'ubatch_size':
        cfg.ubatch_size = toNumberSetting(settingValue, 512)
        break
      case 'device':
        cfg.device = toStringSetting(settingValue)
        break
      case 'split_mode':
        cfg.split_mode = toStringSetting(settingValue, 'layer')
        break
      case 'main_gpu':
        cfg.main_gpu = toNumberSetting(settingValue, 0)
        break
      case 'n_gpu_layers':
        cfg.n_gpu_layers = toNumberSetting(settingValue, -1)
        break
      case 'flash_attn':
        cfg.flash_attn = toStringSetting(settingValue, 'auto')
        break
      case 'cont_batching':
        cfg.cont_batching = toBooleanSetting(settingValue)
        break
      case 'no_mmap':
        cfg.no_mmap = toBooleanSetting(settingValue)
        break
      case 'mlock':
        cfg.mlock = toBooleanSetting(settingValue)
        break
      case 'no_kv_offload':
        cfg.no_kv_offload = toBooleanSetting(settingValue)
        break
      case 'cache_type_k':
        cfg.cache_type_k = toStringSetting(settingValue, 'f16')
        break
      case 'cache_type_v':
        cfg.cache_type_v = toStringSetting(settingValue, 'f16')
        break
      case 'defrag_thold':
        cfg.defrag_thold = toNumberSetting(settingValue, 0.1)
        break
      case 'rope_scaling':
        cfg.rope_scaling = toStringSetting(settingValue, 'none')
        break
      case 'rope_scale':
        cfg.rope_scale = toNumberSetting(settingValue, 1.0)
        break
      case 'rope_freq_base':
        cfg.rope_freq_base = toNumberSetting(settingValue, 0)
        break
      case 'rope_freq_scale':
        cfg.rope_freq_scale = toNumberSetting(settingValue, 1.0)
        break
      case 'ctx_shift':
        cfg.ctx_shift = toBooleanSetting(settingValue)
        break
      case 'offload_mmproj':
        cfg.offload_mmproj = toBooleanSetting(settingValue)
        break
      case 'cpu_moe':
        cfg.cpu_moe = toBooleanSetting(settingValue)
        break
      case 'n_cpu_moe':
        cfg.n_cpu_moe = toNumberSetting(settingValue, 0)
        break
      case 'mirostat':
        this.mirostat = toNumberSetting(settingValue, 0)
        break
      case 'mirostat_lr':
        this.mirostatLr = toNumberSetting(settingValue, 0.1)
        break
      case 'mirostat_ent':
        this.mirostatEnt = toNumberSetting(settingValue, 5.0)
        break
      case 'grammar_file':
        this.grammarFile = toStringSetting(settingValue)
        break
      case 'json_schema_file':
        this.jsonSchemaFile = toStringSetting(settingValue)
        break
      case 'engine_type': {
        const prev = cfg.engine_type
        cfg.engine_type = toStringSetting(settingValue, 'llamacpp')
        // When engine changes, unload active models and stop the old engine
        // so the next load uses the newly selected engine.
        if (prev && prev !== cfg.engine_type) {
          this._handleEngineSwitch(prev, cfg.engine_type)
        }
        break
      }
    }
  }

  /** Persist a setting value update to localStorage */
  private async _updateSettingValue(key: string, value: string): Promise<void> {
    const payload: UpdateSettingPayload = { key, controllerProps: { value } }
    await this.updateSettings([payload])
  }

  // ─── Model directory helpers ───────────────────────────────────────────────

  private async _modelsDir(): Promise<string> {
    const appData = await getAppDataFolderPath()
    return joinPath([appData, 'llamacpp', 'models'])
  }

  private async _modelDir(modelId: string): Promise<string> {
    const modelsDir = await this._modelsDir()
    return joinPath([modelsDir, modelId])
  }

  private async _modelYmlPath(modelId: string): Promise<string> {
    const dir = await this._modelDir(modelId)
    return joinPath([dir, 'model.yml'])
  }

  private _parseEnvAssignments(rawEnv: string): EnvMap {
    const assignments: string[] = []
    let current = ''
    let inSingle = false
    let inDouble = false

    for (const char of rawEnv) {
      if (char === "'" && !inDouble) {
        inSingle = !inSingle
        current += char
        continue
      }
      if (char === '"' && !inSingle) {
        inDouble = !inDouble
        current += char
        continue
      }
      if (!inSingle && !inDouble && /\s/.test(char)) {
        if (current.trim()) {
          assignments.push(current.trim())
          current = ''
        }
        continue
      }
      current += char
    }

    if (current.trim()) assignments.push(current.trim())

    return assignments.reduce<EnvMap>((envs, assignment) => {
      const separator = assignment.indexOf('=')
      if (separator <= 0) return envs

      const key = assignment.slice(0, separator).trim()
      let value = assignment.slice(separator + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      envs[key] = value
      return envs
    }, {})
  }

  private async _validateLocalModelFile(
    path: string,
    label: string
  ): Promise<void> {
    const stat = await fs.fileStat(path)
    if (!stat) {
      throw new Error(`${label} file not found: ${path}`)
    }
    if (stat.isDirectory) {
      throw new Error(`${label} path must be a file: ${path}`)
    }
  }

  private _isAbsolutePath(path: string): boolean {
    return (
      path.startsWith('/') ||
      /^[A-Za-z]:[\\/]/.test(path) ||
      path.startsWith('\\\\')
    )
  }

  private _canonicalizeFilePath(path: string, label: string): string {
    if (!path || path.includes('\0')) {
      throw new Error(`${label} path is invalid`)
    }
    if (!this._isAbsolutePath(path)) {
      throw new Error(`${label} path must be absolute: ${path}`)
    }

    const separator = path.includes('\\') ? '\\' : '/'
    const normalized = path.replace(/[\\/]+/g, separator)
    const prefixMatch = normalized.match(/^(\\\\[^\\]+\\[^\\]+|[A-Za-z]:|\/)/)
    const prefix = prefixMatch?.[0] ?? ''
    const remainder = normalized.slice(prefix.length)
    const segments = remainder.split(/[\\/]+/).filter(Boolean)
    const resolved: string[] = []

    for (const segment of segments) {
      if (segment === '.') continue
      if (segment === '..') {
        if (resolved.length === 0) {
          throw new Error(`${label} path traversal detected: ${path}`)
        }
        resolved.pop()
        continue
      }
      resolved.push(segment)
    }

    const joined = resolved.join(separator)
    const rootedPrefix = prefix.endsWith(separator) ? prefix : `${prefix}${separator}`
    return joined ? `${rootedPrefix}${joined}` : rootedPrefix
  }

  private _splitFilePath(
    path: string,
    label: string
  ): { parentPath: string; fileName: string } {
    const separator = path.includes('\\') ? '\\' : '/'
    const lastSeparatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    if (lastSeparatorIndex < 0) {
      throw new Error(`${label} path must include a parent directory: ${path}`)
    }

    let parentPath: string
    if (lastSeparatorIndex === 0) {
      parentPath = separator
    } else if (separator === '\\' && /^[A-Za-z]:\\/.test(path) && lastSeparatorIndex === 2) {
      parentPath = path.slice(0, 3)
    } else {
      parentPath = path.slice(0, lastSeparatorIndex)
    }

    const fileName = path.slice(lastSeparatorIndex + 1)
    if (!fileName) {
      throw new Error(`${label} path must include a file name: ${path}`)
    }

    return { parentPath, fileName }
  }

  private async _canonicalizeExistingPath(
    path: string,
    label: string
  ): Promise<string> {
    const normalizedPath = this._canonicalizeFilePath(path, label)
    try {
      return await invoke<string>('canonicalize_path', { path: normalizedPath })
    } catch (error) {
      throw new Error(`${label} path is invalid: ${getErrorMessage(error)}`)
    }
  }

  private async _canonicalizeComparablePath(
    path: string,
    label: string
  ): Promise<string> {
    const normalizedPath = this._canonicalizeFilePath(path, label)
    if (await fs.existsSync(normalizedPath)) {
      return this._canonicalizeExistingPath(normalizedPath, label)
    }

    const { parentPath, fileName } = this._splitFilePath(normalizedPath, label)
    const canonicalParent = await this._canonicalizeExistingPath(
      parentPath,
      `${label} parent`
    )
    const separator = canonicalParent.includes('\\') ? '\\' : '/'
    return canonicalParent.endsWith(separator)
      ? `${canonicalParent}${fileName}`
      : `${canonicalParent}${separator}${fileName}`
  }

  private async _modelsBasePath(): Promise<string> {
    const appData = await getAppDataFolderPath()
    return joinPath([appData, 'llamacpp', 'models'])
  }

  private async _validatePathWithinModelsDir(
    targetPath: string,
    label: string
  ): Promise<void> {
    const expectedBase = await this._canonicalizeExistingPath(
      await this._modelsBasePath(),
      'Models base'
    )
    const normalizedTarget = await this._canonicalizeComparablePath(
      targetPath,
      label
    )
    const separator = normalizedTarget.includes('\\') ? '\\' : '/'
    const normalizedBaseWithSeparator = expectedBase.endsWith(separator)
      ? expectedBase
      : `${expectedBase}${separator}`
    const normalizedBase = IS_WINDOWS ? expectedBase.toLowerCase() : expectedBase
    const comparableTarget = IS_WINDOWS
      ? normalizedTarget.toLowerCase()
      : normalizedTarget
    const comparableBaseWithSeparator = IS_WINDOWS
      ? normalizedBaseWithSeparator.toLowerCase()
      : normalizedBaseWithSeparator

    if (
      comparableTarget !== normalizedBase &&
      !comparableTarget.startsWith(comparableBaseWithSeparator)
    ) {
      throw new Error(`${label} path traversal detected: ${targetPath}`)
    }
  }

  private _canonicalizeImportSourcePath(path: string, label: string): string {
    const canonicalPath = this._canonicalizeFilePath(path, label)
    if (!canonicalPath.toLowerCase().endsWith('.gguf')) {
      throw new Error(`${label} file must be a .gguf file: ${path}`)
    }
    return canonicalPath
  }

  private async _canonicalizeExistingImportSourcePath(
    path: string,
    label: string
  ): Promise<string> {
    const normalizedPath = this._canonicalizeImportSourcePath(path, label)
    const canonicalPath = await this._canonicalizeExistingPath(
      normalizedPath,
      label
    )
    await this._validateLocalModelFile(canonicalPath, label)
    return canonicalPath
  }

  private async _isPathWithinModelsDir(targetPath: string): Promise<boolean> {
    try {
      await this._validatePathWithinModelsDir(targetPath, 'Model')
      return true
    } catch (error) {
      console.debug('[llamacpp] Model path rejected by models-dir guard:', error)
      return false
    }
  }

  private async _cleanupImportArtifacts(
    modelId: string,
    paths: string[]
  ): Promise<void> {
    for (const path of paths) {
      if (!path) continue
      try {
        if (await fs.existsSync(path)) await fs.rm(path)
      } catch (error) {
        console.warn(`[llamacpp] Failed to clean up import artifact ${path}:`, error)
      }
    }

    try {
      const modelDir = await this._modelDir(modelId)
      if (!(await fs.existsSync(modelDir))) return
      const remaining = await fs.readdirSync(modelDir)
      if (remaining.length === 0) await fs.rm(modelDir)
    } catch (error) {
      console.warn(`[llamacpp] Failed to clean up import directory for ${modelId}:`, error)
    }
  }

  private _getTimeoutSignal(
    timeoutMs: number,
    abortController?: AbortController
  ): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const externalSignal = abortController?.signal
    if (!externalSignal) return timeoutSignal
    if (typeof AbortSignal.any === 'function') {
      return AbortSignal.any([externalSignal, timeoutSignal])
    }
    return externalSignal
  }

  private async _readModelConfig(modelId: string): Promise<ModelConfig | null> {
    try {
      const ymlPath = await this._modelYmlPath(modelId)
      const content = await fs.readFileSync(ymlPath)
      if (!content) return null
      const parsed = parseSimpleYaml(content)
      return {
        model_path: String(parsed.model_path ?? ''),
        mmproj_path: parsed.mmproj_path
          ? String(parsed.mmproj_path)
          : undefined,
        name: String(parsed.name ?? modelId),
        size_bytes: Number(parsed.size_bytes ?? 0),
        embedding: Boolean(parsed.embedding),
        sha256: parsed.sha256 ? String(parsed.sha256) : undefined,
        mmproj_sha256: parsed.mmproj_sha256
          ? String(parsed.mmproj_sha256)
          : undefined,
      }
    } catch (error) {
      console.debug(`[llamacpp] Failed to read model config for ${modelId}:`, error)
      return null
    }
  }

  private async _writeModelConfig(
    modelId: string,
    cfg: ModelConfig
  ): Promise<void> {
    const dir = await this._modelDir(modelId)
    if (!(await fs.existsSync(dir))) await fs.mkdir(dir)
    const ymlPath = await this._modelYmlPath(modelId)
    const content = toSimpleYaml({
      model_path: cfg.model_path,
      ...(cfg.mmproj_path ? { mmproj_path: cfg.mmproj_path } : {}),
      name: cfg.name,
      size_bytes: cfg.size_bytes,
      embedding: cfg.embedding ?? false,
      ...(cfg.sha256 ? { sha256: cfg.sha256 } : {}),
      ...(cfg.mmproj_sha256 ? { mmproj_sha256: cfg.mmproj_sha256 } : {}),
    })
    await fs.writeFileSync(ymlPath, content)
  }

  // ─── list() ───────────────────────────────────────────────────────────────

  async list(): Promise<modelInfo[]> {
    try {
      const engineName = ENGINE
      const modelsDir = await this._modelsDir()
      if (!(await fs.existsSync(modelsDir))) return []

      const results: modelInfo[] = []

      // Ensure modelsDir ends with separator for reliable prefix stripping
      const sep = modelsDir.includes('\\') ? '\\' : '/'
      const modelsDirPrefix = modelsDir.endsWith(sep)
        ? modelsDir
        : modelsDir + sep

      // DFS to discover model directories (handles nested IDs like "author/model")
      // readdirSync returns full absolute paths from the Rust backend
      const topEntries: string[] = (await fs.readdirSync(modelsDir)) ?? []
      const stack: string[] = [...topEntries]

      while (stack.length > 0) {
        const entryPath = stack.pop()!

        // Check if this directory contains model.yml
        const ymlPath = await joinPath([entryPath, 'model.yml'])
        const hasModelYml = await fs.existsSync(ymlPath)

        if (hasModelYml) {
          // Extract relative model ID by stripping the modelsDir prefix
          let modelId = entryPath
          if (entryPath.startsWith(modelsDirPrefix)) {
            modelId = entryPath.substring(modelsDirPrefix.length)
          }
          // Normalize separators to forward slashes for consistent IDs
          modelId = modelId.replace(/\\/g, '/')

          const cfg = await this._readModelConfig(modelId)
          if (cfg) {
            results.push({
              id: modelId,
              name: cfg.name || modelId,
              providerId: this.providerId,
              port: 0,
              sizeBytes: cfg.size_bytes ?? 0,
              embedding: Boolean(cfg.embedding),
              path: cfg.model_path,
              engine: engineName,
            })
          }
        } else {
          // No model.yml — might be a parent directory (e.g., "bartowski/"),
          // recurse into its children
          try {
            const subEntries: string[] = (await fs.readdirSync(entryPath)) ?? []
            stack.push(...subEntries)
          } catch (error) {
            console.debug(`[llamacpp] Skipping unreadable model entry ${entryPath}:`, error)
          }
        }
      }

      return results
    } catch (e) {
      console.error('[llamacpp] list() error:', e)
      return []
    }
  }

  // ─── get() ────────────────────────────────────────────────────────────────

  async get(modelId: string): Promise<modelInfo | undefined> {
    this._validateModelId(modelId)
    const cfg = await this._readModelConfig(modelId)
    if (!cfg) return undefined
    const engineName = ENGINE
    return {
      id: modelId,
      name: cfg.name || modelId,
      providerId: this.providerId,
      port: 0,
      sizeBytes: cfg.size_bytes ?? 0,
      embedding: Boolean(cfg.embedding),
      path: cfg.model_path,
      engine: engineName,
    }
  }

  // ─── load() ───────────────────────────────────────────────────────────────

  async load(
    modelId: string,
    overrideSettings?: Partial<Record<keyof LlamacppConfig, unknown>>,
    isEmbedding?: boolean,
    bypassAutoUnload?: boolean
  ): Promise<SessionInfo> {
    this._validateModelId(modelId)
    // Deduplicate concurrent load calls for the same model
    const existing = this.loadingModels.get(modelId)
    if (existing) return existing

    const loadPromise = this._doLoad(
      modelId,
      overrideSettings,
      isEmbedding,
      bypassAutoUnload
    )
    this.loadingModels.set(modelId, loadPromise)

    try {
      const session = await loadPromise
      return session
    } finally {
      this.loadingModels.delete(modelId)
    }
  }

  private async _doLoad(
    modelId: string,
    overrideSettings?: Partial<Record<keyof LlamacppConfig, unknown>>,
    isEmbedding = false,
    bypassAutoUnload = false
  ): Promise<SessionInfo> {
    events.emit(ModelEvent.OnModelInit, { modelId })

    try {
      // Auto-unload active text model when loading a new one
      if (this.autoUnload && !isEmbedding && !bypassAutoUnload) {
        await this._unloadActiveTextModels(modelId)
      }

      // Read model config
      const cfg = await this._readModelConfig(modelId)
      if (!cfg) throw new Error(`Model not found: ${modelId}`)

      const engineType = this.config.engine_type || 'llamacpp'
      const embedding = isEmbedding || Boolean(cfg.embedding)

      // ax-serving mode — handles text, vision, and embedding models
      if (engineType === 'ax-serving') {
        try {
          return await this._doLoadAxServing(modelId, cfg, embedding)
        } catch (axErr: unknown) {
          console.warn(
            `[llamacpp] ax-serving failed, falling back to llamacpp: ${getErrorMessage(axErr)}`
          )
        }
      }

      return await this._doLoadLlamacpp(
        modelId,
        cfg,
        overrideSettings,
        isEmbedding
      )
    } catch (e: unknown) {
      events.emit(ModelEvent.OnModelFail, {
        modelId,
        error: getErrorMessage(e),
      })
      throw e
    }
  }

  // ─── ax-serving load path ──────────────────────────────────────────────────

  /** Load a model via ax-serving HTTP API (long-running service model) */
  private async _doLoadAxServing(
    modelId: string,
    cfg: ModelConfig,
    isEmbedding = false
  ): Promise<SessionInfo> {
    // Ensure ax-serving process is running
    await this._ensureAxServingRunning()

    // Resolve absolute model path
    const appData = await getAppDataFolderPath()
    const modelPath = await joinPath([appData, cfg.model_path])
    await this._validatePathWithinModelsDir(modelPath, 'Model')

    if (!(await fs.existsSync(modelPath))) {
      throw new Error(`Model file not found: ${modelPath}`)
    }

    // Resolve mmproj path for vision/multimodal models
    let mmprojPath: string | undefined
    if (cfg.mmproj_path) {
      const candidateMmprojPath = await joinPath([appData, cfg.mmproj_path])
      await this._validatePathWithinModelsDir(candidateMmprojPath, 'Mmproj')
      if (!(await fs.existsSync(candidateMmprojPath))) {
        console.warn(
          `[llamacpp] mmproj file not found: ${candidateMmprojPath}, loading without vision`
        )
      } else {
        mmprojPath = candidateMmprojPath
      }
    }

    // Build load request with all supported fields
    const loadBody: AxServingLoadRequest = {
      model_id: modelId,
      path: modelPath,
    }
    if (mmprojPath) {
      loadBody.mmproj_path = mmprojPath
    }
    const nGpuLayers = Number(this.config.n_gpu_layers)
    if (nGpuLayers >= 0 && nGpuLayers !== 100) {
      loadBody.n_gpu_layers = nGpuLayers
    }
    const ctxSize = Number(this.config.ctx_size)
    if (ctxSize > 0) {
      loadBody.context_length = ctxSize
    }

    // Load model via ax-serving REST API
    const loadRes = await fetch(
      `http://127.0.0.1:${this.axServingPort}/v1/models`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loadBody),
        signal: AbortSignal.timeout(this.timeout * 1000),
      }
    )

    if (loadRes.status === 409) {
      // Model already loaded — this is fine
      console.log(`[llamacpp] ax-serving: model "${modelId}" already loaded`)
    } else if (!loadRes.ok) {
      const errText = await loadRes.text()
      throw new Error(
        `ax-serving failed to load model (${loadRes.status}): ${errText}`
      )
    } else {
      const loadData = await loadRes.json()
      console.log(
        `[llamacpp] ax-serving: loaded "${modelId}" (arch=${loadData.architecture}, ctx=${loadData.context_length}, ${loadData.load_time_ms}ms)`
      )
    }

    // Create synthetic session (ax-serving manages the process, not Tauri plugin)
    const session: SessionInfo = {
      pid: this.axServingPid,
      port: this.axServingPort,
      model_id: modelId,
      model_path: modelPath,
      is_embedding: isEmbedding,
      api_key: '',
    }
    this.axServingSessions.set(modelId, session)

    await this._syncLocalProviderRegistration({
      port: this.axServingPort,
      apiKey: '',
      models: [modelId],
    })

    events.emit(ModelEvent.OnModelReady, {
      modelId,
      port: session.port,
      api_key: session.api_key,
      provider: this.providerId,
    })
    return session
  }

  /** Ensure the ax-serving process is running, start it if needed */
  private async _ensureAxServingRunning(): Promise<void> {
    // Check if already running and healthy
    if (this.axServingPid > 0) {
      try {
        const res = await fetch(
          `http://127.0.0.1:${this.axServingPort}/health`,
          {
            signal: AbortSignal.timeout(AX_SERVING_PORT_CHECK_TIMEOUT_MS),
          }
        )
        if (res.ok) return
      } catch (error) {
        console.debug('[llamacpp] ax-serving health probe failed before restart:', error)
      }
      // Not responding — kill the old process tree before restarting
      console.warn(
        '[llamacpp] ax-serving not responding, killing old process and restarting'
      )
      const oldPid = this.axServingPid
      this.axServingPid = 0
      this.axServingPort = 0
      this.axServingSessions.clear()
      try {
        await unloadLlamaModel(oldPid)
      } catch (e) {
        console.warn('[llamacpp] Failed to kill unresponsive ax-serving:', e)
      }
    }

    // Coalesce concurrent start attempts
    if (this.axServingStarting) {
      await this.axServingStarting
      return
    }

    this.axServingStarting = this._startAxServingProcess()
    try {
      await this.axServingStarting
    } finally {
      this.axServingStarting = null
    }
  }

  /** Start the ax-serving process via Tauri plugin */
  private async _startAxServingProcess(): Promise<void> {
    const binaryPath = await getAxServingBinaryPath()
    const port = await getRandomPort()

    console.log(
      `[llamacpp] Starting ax-serving at ${binaryPath} on port ${port}`
    )
    const session = await startAxServing(binaryPath, port, this.timeout)

    this.axServingPort = session.port
    this.axServingPid = session.pid
    console.log(
      `[llamacpp] ax-serving started (PID=${session.pid}, port=${session.port})`
    )
  }

  private async _syncLocalProviderRegistration(preferred?: {
    port?: number
    apiKey?: string
    models?: string[]
  }) {
    const llamacppModels = await getLoadedModels().catch((error: unknown) => {
      console.debug('[llamacpp] Failed to list llamacpp models during provider sync:', error)
      return [] as string[]
    })
    const axServingModels = Array.from(this.axServingSessions.keys())
    const firstAxServingSession = this.axServingSessions.values().next()
      .value as SessionInfo | undefined
    const loadedModels = [...new Set([...llamacppModels, ...axServingModels])]
    const fallbackSession =
      llamacppModels.length > 0
        ? await findSessionByModel(llamacppModels[0]).catch((error: unknown) => {
            console.debug('[llamacpp] Failed to resolve fallback local provider session:', error)
            return null
          })
        : null

    const decision = decideLocalProviderSync({
      loadedModels,
      llamacppModels,
      axServingModels,
      axServingPort: this.axServingPort || firstAxServingSession?.port || 0,
      preferred,
      fallbackSession,
    })

    if (decision.action === 'unregister') {
      try {
        await invoke('unregister_provider_config', {
          provider: this.providerId,
        })
      } catch (err) {
        console.warn(
          '[llamacpp] Failed to unregister provider from proxy:',
          err
        )
      }
      return
    }

    if (decision.action === 'skip') {
      console.warn(
        '[llamacpp] Skipping provider sync because no active port is available'
      )
      return
    }

    if (
      decision.models.length === 1 &&
      llamacppModels.length > 1 &&
      axServingModels.length === 0 &&
      !preferred?.models
    ) {
      console.warn(
        '[llamacpp] Multiple process-based models are loaded, but only one can be routed through the proxy at a time.'
      )
    }

    try {
      await invoke('register_provider_config', {
        request: {
          provider: this.providerId,
          base_url: `http://127.0.0.1:${decision.port}/v1`,
          api_key: decision.apiKey,
          custom_headers: [],
          models: decision.models,
        },
      })
    } catch (regErr) {
      console.warn('[llamacpp] Failed to register provider with proxy:', regErr)
    }
  }

  // ─── llamacpp load path ────────────────────────────────────────────────────

  /** Load a model by spawning a dedicated llama-server process (original flow) */
  private async _doLoadLlamacpp(
    modelId: string,
    cfg: ModelConfig,
    overrideSettings?: Partial<Record<keyof LlamacppConfig, unknown>>,
    isEmbedding = false
  ): Promise<SessionInfo> {
    // Resolve backend binary
    const versionBackend = await this.getSetting<string>('version_backend', '')
    if (!versionBackend) {
      throw new Error(
        'No backend selected. Please configure the engine backend in settings.'
      )
    }
    const [version, ...rest] = versionBackend.split('/')
    const backend = rest.join('/')
    const backendPath = await this._ensureBackend(version, backend)

    // Resolve absolute paths
    const appData = await getAppDataFolderPath()
    const modelPath = await joinPath([appData, cfg.model_path])
    await this._validatePathWithinModelsDir(modelPath, 'Model')

    const mmprojPath = cfg.mmproj_path
      ? await joinPath([appData, cfg.mmproj_path])
      : undefined

    if (mmprojPath) {
      await this._validatePathWithinModelsDir(mmprojPath, 'Mmproj')
    }

    // Verify model file exists
    if (!(await fs.existsSync(modelPath))) {
      throw new Error(`Model file not found: ${modelPath}`)
    }

    const embedding = isEmbedding || Boolean(cfg.embedding)
    const port = await getRandomPort()
    const apiSecret = String(Date.now())
    const apiKey = await generateApiKey(modelId, apiSecret)

    // Merge global config with per-model override settings
    // Per-model settings (ctx_size, n_gpu_layers, etc.) take precedence
    // Force engine_type to 'llamacpp' — this method always runs llama-server
    const mergedConfig: Partial<LlamacppConfig> = {
      ...this.config,
      engine_type: 'llamacpp',
    }
    if (overrideSettings) {
      for (const [key, value] of Object.entries(overrideSettings)) {
        if (!ALLOWED_LOAD_OVERRIDE_KEYS.has(key as keyof LlamacppConfig)) {
          throw new Error(`Unsupported load override setting: ${key}`)
        }
        if (value !== undefined && value !== '' && value !== null) {
          ;(mergedConfig as Record<string, unknown>)[key] = value
        }
      }
    }
    const llamaConfig = normalizeLlamacppConfig(mergedConfig)

    // Build environment variables for the llama-server process
    const envs: Record<string, string> = {
      LLAMA_API_KEY: apiKey,
      LLAMA_ARG_TIMEOUT: String(this.timeout),
    }
    if (this.config.llamacpp_env) {
      Object.assign(envs, this._parseEnvAssignments(String(this.config.llamacpp_env)))
    }

    const session = await loadLlamaModel(
      backendPath,
      modelId,
      modelPath,
      port,
      llamaConfig,
      envs,
      mmprojPath,
      embedding,
      this.timeout
    )

    // Register the local provider with the Rust proxy SYNCHRONOUSLY before
    // returning, so the proxy is ready to route requests immediately.
    await this._syncLocalProviderRegistration({
      port: session.port,
      apiKey: session.api_key ?? '',
      models: [modelId],
    })

    events.emit(ModelEvent.OnModelReady, {
      modelId,
      port: session.port,
      api_key: session.api_key,
      provider: this.providerId,
    })
    return session
  }

  /** Ensure backend binary is present, downloading if necessary */
  private async _ensureBackend(
    version: string,
    backend: string
  ): Promise<string> {
    const key = `${version}_${backend}`

    // Coalesce concurrent download requests for the same backend
    const pending = this.pendingDownloads.get(key)
    if (pending) await pending

    const exePath = await getBackendExePath(version, backend)
    if (!(await fs.existsSync(exePath))) {
      if (!this.pendingDownloads.has(key)) {
        const downloadPromise = downloadBackend(version, backend).finally(
          () => {
            this.pendingDownloads.delete(key)
          }
        )
        this.pendingDownloads.set(key, downloadPromise)
      }
      await this.pendingDownloads.get(key)
    }

    return exePath
  }

  private async _unloadLoadedModels(
    excludeModelId: string,
    shouldUnload: (session: SessionInfo) => boolean
  ): Promise<void> {
    try {
      // Collect all loaded model IDs from both engines
      const llamacppIds = await getLoadedModels().catch((error) => {
        console.warn('[llamacpp] Failed to read loaded models:', error)
        return [] as string[]
      })
      const axServingIds = Array.from(this.axServingSessions.keys())
      const allIds = [...new Set([...llamacppIds, ...axServingIds])]

      for (const id of allIds) {
        if (id === excludeModelId) continue
        // Wait for any in-progress load for this model to complete
        await this.loadingModels.get(id)?.catch((error) => {
          console.debug(`[llamacpp] Ignoring in-flight load failure for ${id} during unload sweep:`, error)
        })
        try {
          // Check ax-serving sessions first
          const axSession = this.axServingSessions.get(id)
          if (axSession && shouldUnload(axSession)) {
            await this.unload(id)
            continue
          }
          // Check llamacpp sessions
          const session = await findSessionByModel(id)
          if (session && shouldUnload(session)) {
            await this.unload(id)
          }
        } catch (e) {
          console.warn(`[llamacpp] Failed to auto-unload ${id}:`, e)
        }
      }
    } catch (e) {
      console.warn('[llamacpp] _unloadLoadedModels error:', e)
    }
  }

  /** Unload all active text models except the one about to be loaded */
  private async _unloadActiveTextModels(excludeModelId: string): Promise<void> {
    await this._unloadLoadedModels(
      excludeModelId,
      (session) => !session.is_embedding
    )
  }

  /**
   * Handle engine switch: unload all active text models and stop the
   * ax-serving process if we are moving away from it.  Fire-and-forget
   * because onSettingUpdate is synchronous.
   */
  private _handleEngineSwitch(from: string, to: string): void {
    console.log(
      `[llamacpp] Engine switch: ${from} → ${to}, unloading active text models`
    )

    this.engineSwitchQueue = this.engineSwitchQueue
      .catch((error) =>
        console.debug('[llamacpp] Previous engine switch failed before queuing a new one:', error)
      )
      .then(async () => {
        // 1. Unload all active models so provider routing cannot point at mixed engines.
        await this._unloadLoadedModels('', () => true)

        // 2. If we are leaving ax-serving, stop its process and reset state
        if (from === 'ax-serving' && this.axServingPid > 0) {
          try {
            await unloadLlamaModel(this.axServingPid)
            console.log(
              '[llamacpp] ax-serving process stopped after engine switch'
            )
          } catch (e) {
            console.warn('[llamacpp] Failed to stop ax-serving process:', e)
          }
          this.axServingPid = 0
          this.axServingPort = 0
          this.axServingSessions.clear()
        }
        await this._syncLocalProviderRegistration()
      })
      .catch((e) =>
        console.warn('[llamacpp] Engine switch cleanup error:', e)
      )
  }

  // ─── unload() ─────────────────────────────────────────────────────────────

  async unload(sessionId: string): Promise<UnloadResult> {
    try {
      // Check ax-serving sessions first
      const axSession = this.axServingSessions.get(sessionId)
      if (axSession) {
        events.emit(ModelEvent.OnModelStop, { modelId: sessionId })
        // Unload via ax-serving HTTP API
        try {
          const encodedId = encodeURIComponent(sessionId)
          const res = await fetch(
            `http://127.0.0.1:${this.axServingPort}/v1/models/${encodedId}`,
            { method: 'DELETE', signal: AbortSignal.timeout(10000) }
          )
          if (!res.ok && res.status !== 404) {
            const errText = await res.text()
            console.warn(
              `[llamacpp] ax-serving unload warning (${res.status}): ${errText}`
            )
          }
        } catch (e) {
          console.warn('[llamacpp] ax-serving unload HTTP error:', e)
        }
        this.axServingSessions.delete(sessionId)
        await this._syncLocalProviderRegistration()
        events.emit(ModelEvent.OnModelStopped, { modelId: sessionId })
        return { success: true }
      }

      // Fallback: llamacpp process-based session
      const session = await findSessionByModel(sessionId)
      if (!session) {
        return { success: true }
      }
      events.emit(ModelEvent.OnModelStop, { modelId: sessionId })
      const result = await unloadLlamaModel(session.pid)
      await this._syncLocalProviderRegistration()
      events.emit(ModelEvent.OnModelStopped, { modelId: sessionId })
      return result
    } catch (e: unknown) {
      console.error('[llamacpp] unload error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  }

  // ─── chat() ───────────────────────────────────────────────────────────────

  async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    const modelId = opts.model
    const session = await this._requireSession(modelId)

    // Health check
    await this._healthCheck(session.port, session.pid, modelId)

    const stream = opts.stream !== false

    // Augment request with per-inference settings from extension config
    const body: ChatRequestBody = {
      ...opts,
      stream,
      return_progress: true,
      ...(this.mirostat > 0 ? { mirostat: this.mirostat } : {}),
      ...(this.mirostat > 0 ? { mirostat_tau: this.mirostatEnt } : {}),
      ...(this.mirostat > 0 ? { mirostat_eta: this.mirostatLr } : {}),
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${session.api_key}`,
      'Content-Type': 'application/json',
    }

    const url = `http://localhost:${session.port}/v1/chat/completions`

    if (!stream) {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: this._getTimeoutSignal(this.timeout * 1000, abortController),
      })
      if (!response.ok) {
        throw new Error(
          `llama-server error ${response.status}: ${await response.text()}`
        )
      }
      const completion = (await response.json()) as chatCompletion
      const reason = completion.choices?.[0]?.finish_reason
      if (reason === 'length') {
        throw new Error(
          'Request exceeds available context size. Reduce message history or increase context size.'
        )
      }
      return completion
    }

    // Streaming — return an AsyncIterable<chatCompletionChunk>
    return this._streamChat(url, headers, body, abortController)
  }

  private async *_streamChat(
    url: string,
    headers: Record<string, string>,
    body: ChatRequestBody,
    abortController?: AbortController
  ): AsyncIterable<chatCompletionChunk> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: this._getTimeoutSignal(this.timeout * 1000, abortController),
    })

    if (!response.ok) {
      throw new Error(
        `llama-server error ${response.status}: ${await response.text()}`
      )
    }

    if (!response.body) {
      throw new Error('llama-server stream response did not include a body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === ':') continue
          if (trimmed.startsWith('data:')) {
            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') return
            try {
              const chunk = JSON.parse(data) as chatCompletionChunk
              const reason = chunk.choices?.[0]?.finish_reason
              if (reason === 'length') {
                throw new Error(
                  'Request exceeds available context size. Reduce message history or increase context size.'
                )
              }
              yield chunk
            } catch (e) {
              if (e instanceof SyntaxError) {
                console.warn('[llamacpp] Failed to parse SSE chunk:', data)
                continue
              }
              throw e
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /** Find a loaded session or throw */
  private async _requireSession(modelId: string): Promise<SessionInfo> {
    // Check ax-serving sessions first
    const axSession = this.axServingSessions.get(modelId)
    if (axSession) return axSession

    // Fallback to Tauri IPC (llamacpp-spawned sessions)
    const session = await findSessionByModel(modelId)
    if (!session) {
      throw new Error(`Model "${modelId}" is not loaded. Load it first.`)
    }
    return session
  }

  /** Health check — verify the inference server is alive */
  private async _healthCheck(
    port: number,
    pid: number,
    modelId: string
  ): Promise<void> {
    const isAxServing = this.axServingSessions.has(modelId)

    if (isAxServing) {
      // ax-serving: check server health and model presence
      try {
        const res = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(AX_SERVING_HEALTH_CHECK_TIMEOUT_MS),
        })
        if (!res.ok) {
          throw new Error(`ax-serving health check failed (${res.status})`)
        }
        const health = await res.json()
        // Check if our model is still loaded (may have been evicted by LRU/idle)
        if (
          Array.isArray(health.loaded_models) &&
          !health.loaded_models.includes(modelId)
        ) {
          this.axServingSessions.delete(modelId)
          await this._syncLocalProviderRegistration()
          throw new Error(
            `Model "${modelId}" was evicted by ax-serving. Please reload.`
          )
        }
      } catch (e: unknown) {
        if (getErrorMessage(e).includes('evicted')) throw e
        // ax-serving process may have crashed — mark only this model unhealthy first.
        console.error('[llamacpp] ax-serving health check failed:', e)
        this.axServingSessions.delete(modelId)
        if (this.axServingSessions.size === 0) {
          this.axServingPid = 0
          this.axServingPort = 0
        }
        await this._syncLocalProviderRegistration()
        throw new Error(
          `ax-serving is not responding. Please reload the model.`
        )
      }
      return
    }

    // llamacpp: check process is alive
    const alive = await isProcessRunning(pid)
    if (!alive) {
      await this.unload(modelId).catch((error) => {
        console.warn(`[llamacpp] Failed to unload crashed model ${modelId}:`, error)
      })
      throw new Error(
        `Model "${modelId}" process crashed. Please reload the model.`
      )
    }

    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(AX_SERVING_HEALTH_CHECK_TIMEOUT_MS),
      })
      if (res.status === 404) {
        await this.unload(modelId).catch((error) => {
          console.warn(`[llamacpp] Failed to unload unavailable model ${modelId}:`, error)
        })
        throw new Error(`Model "${modelId}" server unavailable. Please reload.`)
      }
    } catch (e: unknown) {
      const message = getErrorMessage(e)
      if (message.includes('crashed') || message.includes('unavailable')) throw e
      // Timeout or network error — the server may still be initializing, continue
    }
  }

  // ─── import() ─────────────────────────────────────────────────────────────

  async import(modelId: string, opts: ImportOptions): Promise<void> {
    const importOptions = opts as ImportOptionsWithHeaders
    // Validate model ID — no path traversal
    if (!/^[a-zA-Z0-9/\-_.]+$/.test(modelId) || modelId.includes('..')) {
      throw new Error(
        `Invalid model ID: "${modelId}". Use only alphanumeric, /, -, _, . characters.`
      )
    }

    const appData = await getAppDataFolderPath()
    const modelDir = await this._modelDir(modelId)
    const modelFilePath = await joinPath([modelDir, 'model.gguf'])
    const relativeModelPath = `llamacpp/models/${modelId}/model.gguf`

    if (!(await fs.existsSync(modelDir))) await fs.mkdir(modelDir)
    await this._validatePathWithinModelsDir(modelFilePath, 'Model')

    const downloadExt = (window as any).core?.extensionManager?.getByName(
      '@ax-studio/download-extension'
    )

    // ── Download model file if URL provided ──
    const modelPath = opts.modelPath
    if (modelPath.startsWith('http://') || modelPath.startsWith('https://')) {
      if (!downloadExt) {
        const error = new Error('Download extension not available')
        console.error('[llamacpp] Download extension unavailable:', error)
        throw error
      }

      events.emit(DownloadEvent.onFileDownloadStarted, {
        downloadId: modelId,
        modelId,
        fileName: 'model.gguf',
      })

      const proxy = getProxyConfig()
      const proxyArg = buildProxyArg(proxy)

      try {
        await downloadExt.downloadFile(
          modelPath,
          modelFilePath,
          `llamacpp-import-${modelId}`,
          proxyArg,
          importOptions.downloadHeaders,
          (transferred: number, total: number) => {
            events.emit(DownloadEvent.onFileDownloadUpdate, {
              downloadId: modelId,
              modelId,
              fileName: 'model.gguf',
              percent: total > 0 ? transferred / total : 0,
              size: { transferred, total },
              downloadState: 'downloading',
            })
          }
        )
      } catch (e) {
        console.error(
          '[llamacpp] Download failed for model:',
          modelId,
          'error:',
          e
        )
        await this._cleanupImportArtifacts(modelId, [modelFilePath])
        events.emit(DownloadEvent.onFileDownloadError, {
          downloadId: modelId,
          modelId,
          error: String(e),
        })
        throw e
      }

      events.emit(DownloadEvent.onFileDownloadSuccess, {
        downloadId: modelId,
        modelId,
        fileName: 'model.gguf',
      })

      // Validate SHA256 if provided
      if (opts.modelSha256) {
        events.emit(DownloadEvent.onModelValidationStarted, { downloadId: modelId, modelId })
        const valid = await this._validateSha256(
          modelFilePath,
          opts.modelSha256
        )
        if (!valid) {
          await this._cleanupImportArtifacts(modelId, [modelFilePath])
          events.emit(DownloadEvent.onModelValidationFailed, { downloadId: modelId, modelId })
          throw new Error(
            `SHA256 mismatch for model "${modelId}". File may be corrupted.`
          )
        }
      }
      // Always emit success — most HuggingFace models have no SHA256,
      // so emitting only inside the if block means the model never registers.
      events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, {
        downloadId: modelId,
        modelId,
      })
    } else {
      // Local file — copy to models directory
      const canonicalModelPath = await this._canonicalizeExistingImportSourcePath(
        modelPath,
        'Model'
      )
      await fs.copyFile(canonicalModelPath, modelFilePath)
    }

    // ── Download mmproj file if provided ──
    let relativeMmprojPath: string | undefined
    if (opts.mmprojPath) {
      const mmprojFilePath = await joinPath([modelDir, 'mmproj.gguf'])
      relativeMmprojPath = `llamacpp/models/${modelId}/mmproj.gguf`
      await this._validatePathWithinModelsDir(mmprojFilePath, 'MMProj')

      if (opts.mmprojPath.startsWith('http')) {
        if (!downloadExt) throw new Error('Download extension not available')
        const proxy = getProxyConfig()
        await downloadExt.downloadFile(
          opts.mmprojPath,
          mmprojFilePath,
          `llamacpp-mmproj-${modelId}`,
          buildProxyArg(proxy),
          importOptions.downloadHeaders
        )
      } else {
        const canonicalMmprojPath = await this._canonicalizeExistingImportSourcePath(
          opts.mmprojPath,
          'MMProj'
        )
        await fs.copyFile(canonicalMmprojPath, mmprojFilePath)
      }

      if (opts.mmprojSha256) {
        const valid = await this._validateSha256(
          mmprojFilePath,
          opts.mmprojSha256
        )
        if (!valid) {
          await this._cleanupImportArtifacts(modelId, [mmprojFilePath])
          throw new Error(
            `SHA256 mismatch for mmproj "${modelId}". File may be corrupted.`
          )
        }
      }
    }

    // ── Read GGUF metadata to detect embedding models ──
    let isEmbedding = false
    let sizeBytes = opts.modelSize ?? 0
    try {
      const meta: GgufMetadata = await readGgufMetadata(modelFilePath)
      const arch = meta.metadata?.['general.architecture'] ?? ''
      isEmbedding = arch === 'bert' || arch === 'nomic-bert'
      if (!sizeBytes) {
        sizeBytes = await getModelSize(modelFilePath)
      }
    } catch (e) {
      console.warn('[llamacpp] Failed to read GGUF metadata:', e)
      if (!sizeBytes) {
        const stat = await fs.fileStat(modelFilePath)
        sizeBytes = stat?.size ?? 0
      }
    }

    // ── Write model.yml ──
    await this._writeModelConfig(modelId, {
      model_path: relativeModelPath,
      mmproj_path: relativeMmprojPath,
      name: modelId,
      size_bytes: sizeBytes,
      embedding: isEmbedding,
      sha256: opts.modelSha256,
      mmproj_sha256: opts.mmprojSha256,
    })

    events.emit(AppEvent.onModelImported, { modelId })
  }

  async abortImport(modelId: string): Promise<void> {
    const downloadExt = (window as any).core?.extensionManager?.getByName(
      '@ax-studio/download-extension'
    )
    if (downloadExt) {
      try {
        await downloadExt.cancelDownload(`llamacpp-import-${modelId}`)
      } catch (error) {
        console.warn(`[llamacpp] Failed to cancel model download for ${modelId}:`, error)
      }
      try {
        await downloadExt.cancelDownload(`llamacpp-mmproj-${modelId}`)
      } catch (error) {
        console.warn(`[llamacpp] Failed to cancel mmproj download for ${modelId}:`, error)
      }
    }
    const modelDir = await this._modelDir(modelId)
    const modelFilePath = await joinPath([modelDir, 'model.gguf'])
    const mmprojFilePath = await joinPath([modelDir, 'mmproj.gguf'])
    const modelYmlPath = await joinPath([modelDir, 'model.yml'])
    await this._cleanupImportArtifacts(modelId, [
      modelFilePath,
      mmprojFilePath,
      modelYmlPath,
    ])
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private _validateModelId(modelId: string): void {
    if (!/^[a-zA-Z0-9/\-_.]+$/.test(modelId) || modelId.includes('..')) {
      throw new Error(
        `Invalid model ID: "${modelId}". Use only alphanumeric, /, -, _, . characters.`
      )
    }
  }

  // ─── delete() / update() ──────────────────────────────────────────────────

  async delete(modelId: string): Promise<void> {
    this._validateModelId(modelId)
    // Unload first if running (check both engines)
    try {
      if (this.axServingSessions.has(modelId)) {
        await this.unload(modelId)
      } else {
        const session = await findSessionByModel(modelId)
        if (session) await this.unload(modelId)
      }
    } catch (error) {
      console.warn(`[llamacpp] Failed to unload model ${modelId} before delete:`, error)
    }

    const modelDir = await this._modelDir(modelId)
    if (await fs.existsSync(modelDir)) {
      await fs.rm(modelDir)
    }
  }

  async update(modelId: string, model: Partial<modelInfo>): Promise<void> {
    this._validateModelId(modelId)
    const cfg = await this._readModelConfig(modelId)
    if (!cfg) return
    if (model.name) cfg.name = model.name
    if (model.sizeBytes !== undefined) cfg.size_bytes = model.sizeBytes
    if (model.embedding !== undefined) cfg.embedding = model.embedding
    await this._writeModelConfig(modelId, cfg)
  }

  // ─── getLoadedModels() ────────────────────────────────────────────────────

  async getLoadedModels(): Promise<string[]> {
    try {
      const llamacppModels = await getLoadedModels()
      const axModels = Array.from(this.axServingSessions.keys())
      // Deduplicate in case of overlap
      return [...new Set([...llamacppModels, ...axModels])]
    } catch (error) {
      console.debug('[llamacpp] Falling back to ax-serving model list after getLoadedModels failure:', error)
      return Array.from(this.axServingSessions.keys())
    }
  }

  async syncModelRoute(modelId: string): Promise<void> {
    const axSession = this.axServingSessions.get(modelId)
    if (axSession) {
      await this._syncLocalProviderRegistration({
        port: axSession.port,
        apiKey: '',
        models: [modelId],
      })
      return
    }

    const session = await findSessionByModel(modelId)
    if (!session) {
      throw new Error(`Model "${modelId}" is not loaded. Load it first.`)
    }

    await this._syncLocalProviderRegistration({
      port: session.port,
      apiKey: session.api_key ?? '',
      models: [modelId],
    })
  }

  // ─── isToolSupported() ────────────────────────────────────────────────────

  async isToolSupported(modelId: string): Promise<boolean> {
    try {
      const cfg = await this._readModelConfig(modelId)
      if (!cfg) return false
      const appData = await getAppDataFolderPath()
      const modelPath = await joinPath([appData, cfg.model_path])
      if (!(await this._isPathWithinModelsDir(modelPath))) return false
      const meta: GgufMetadata = await readGgufMetadata(modelPath)
      const template = meta.metadata?.['tokenizer.chat_template'] ?? ''
      return template.toLowerCase().includes('tool')
    } catch (error) {
      console.debug(`[llamacpp] Failed to inspect tool support for ${modelId}:`, error)
      return false
    }
  }

  async checkMmprojExists(modelId: string): Promise<boolean> {
    try {
      const cfg = await this._readModelConfig(modelId)
      if (!cfg || !cfg.mmproj_path) return false
      const appData = await getAppDataFolderPath()
      const mmprojPath = await joinPath([appData, cfg.mmproj_path])
      if (!(await this._isPathWithinModelsDir(mmprojPath))) return false
      return await fs.existsSync(mmprojPath)
    } catch (error) {
      console.debug(`[llamacpp] Failed to check mmproj presence for ${modelId}:`, error)
      return false
    }
  }

  // ─── getDevices() ─────────────────────────────────────────────────────────

  async getDevices(): Promise<DeviceList[]> {
    try {
      const versionBackend = await this.getSetting<string>(
        'version_backend',
        ''
      )
      if (!versionBackend) return []
      const [version, ...rest] = versionBackend.split('/')
      const backend = rest.join('/')
      const backendPath = await getBackendExePath(version, backend)
      const raw = await getDevices(backendPath)
      // Map DeviceInfo → DeviceList (handle both field name conventions)
      return raw.map((device: DeviceInfoLike) => ({
        id: device.id,
        name: device.name,
        mem: 'mem' in device ? device.mem : device.memory,
        free: 'free' in device ? device.free : 0,
      }))
    } catch (e) {
      console.error('[llamacpp] getDevices error:', e)
      return []
    }
  }

  // ─── embed() ──────────────────────────────────────────────────────────────

  async embed(opts: EmbedOptions): Promise<EmbeddingResponse> {
    const { modelId, inputs } = opts
    const session = await this._requireSession(modelId)
    await this._healthCheck(session.port, session.pid, modelId)

    const ubatchSize = Number(this.config.ubatch_size) || 512
    const batches = buildEmbedBatches(inputs, ubatchSize)
    const batchResults = []

    for (const batch of batches) {
      const res = await fetch(
        `http://localhost:${session.port}/v1/embeddings`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.api_key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: batch.inputs,
            model: modelId,
            encoding_format: 'float',
          }),
          signal: AbortSignal.timeout(this.timeout * 1000),
        }
      )
      if (!res.ok)
        throw new Error(`Embedding error: ${res.status} ${await res.text()}`)
      batchResults.push(await res.json())
    }

    return mergeEmbedResponses(modelId, batchResults)
  }

  // ─── getTokensCount() ─────────────────────────────────────────────────────

  async getTokensCount(opts: TokenCountOptions): Promise<number> {
    const { modelId, messages } = opts
    const session = await this._requireSession(modelId)
    await this._healthCheck(session.port, session.pid, modelId)

    const baseUrl = `http://localhost:${session.port}`
    const headers = {
      'Authorization': `Bearer ${session.api_key}`,
      'Content-Type': 'application/json',
    }

    try {
      // Apply chat template to get rendered prompt
      const templateRes = await fetch(`${baseUrl}/apply-template`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.timeout(this.timeout * 1000),
      })
      if (!templateRes.ok)
        throw new Error(`apply-template ${templateRes.status}`)
      const { prompt } = await templateRes.json()

      // Tokenize
      const tokenRes = await fetch(`${baseUrl}/tokenize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: prompt }),
        signal: AbortSignal.timeout(this.timeout * 1000),
      })
      if (!tokenRes.ok) throw new Error(`tokenize ${tokenRes.status}`)
      const { tokens } = await tokenRes.json()
      return Array.isArray(tokens) ? tokens.length : 0
    } catch (e) {
      console.error('[llamacpp] getTokensCount error:', e)
      return 0
    }
  }

  // ─── GGUF helpers ─────────────────────────────────────────────────────────

  async readGgufMetadata(path: string): Promise<GgufMetadata> {
    return readGgufMetadata(path)
  }

  async getModelSize(path: string): Promise<number> {
    return getModelSize(path)
  }

  async isModelSupported(
    path: string,
    ctxSize?: number
  ): Promise<'GREEN' | 'YELLOW' | 'RED'> {
    return isModelSupported(path, ctxSize)
  }

  async validateGgufFile(
    path: string
  ): Promise<{ isValid: boolean; error?: string; metadata?: GgufMetadata }> {
    try {
      const metadata = await readGgufMetadata(path)
      return {
        isValid: true,
        metadata,
      }
    } catch (e) {
      return {
        isValid: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  // ─── Backend management (exposed to frontend) ─────────────────────────────

  async checkBackendForUpdates(): Promise<BackendUpdateInfo> {
    const versionBackend = await this.getSetting<string>('version_backend', '')
    const remoteBackends = await fetchRemoteBackends()
    return checkForBackendUpdate(versionBackend, remoteBackends)
  }

  async updateBackend(
    targetVersionBackend: string
  ): Promise<{ wasUpdated: boolean; newBackend: string }> {
    const current = await this.getSetting<string>('version_backend', '')
    const result = await updateBackend(targetVersionBackend, current)
    if (result.wasUpdated) {
      await this._updateSettingValue('version_backend', result.newBackend)
    }
    return result
  }

  async installBackend(filePath: string): Promise<void> {
    await installBackendFromFile(filePath)
  }

  async configureBackends(): Promise<void> {
    const versionBackend = await this.getSetting<string>('version_backend', '')
    await configureBackends(
      versionBackend,
      this.autoUpdateEngine,
      (key, value) => this._updateSettingValue(key, value)
    )
  }

  // ─── SHA256 validation ────────────────────────────────────────────────────

  private async _validateSha256(
    filePath: string,
    expected: string
  ): Promise<boolean> {
    try {
      // Use the core API if available (Tauri backend provides this)
      const result = await (window as any).core?.api?.validateSha256?.(
        filePath,
        expected
      )
      if (result !== undefined) return Boolean(result)

      const computed = await computeFileSha256Browser(filePath)
      return computed.toLowerCase() === expected.toLowerCase()
    } catch (error) {
      // Skip validation rather than crash the model load. The Tauri API may
      // be missing in web/dev contexts, and the browser fallback throws when
      // `fetch` cannot read a local file path. Hard-throwing here would make
      // every model load fail in those environments.
      console.warn(
        '[llamacpp] SHA256 validation unavailable — skipping integrity check:',
        error
      )
      return true
    }
  }
}
