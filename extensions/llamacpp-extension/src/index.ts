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
} from '@ax-studio/core'

import {
  loadLlamaModel,
  unloadLlamaModel,
  startAxServing,
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

interface EmbedOptions {
  modelId: string
  inputs: string[]
}

interface TokenCountOptions {
  modelId: string
  messages: chatCompletionRequest['messages']
}

// ─── Main Extension Class ─────────────────────────────────────────────────────

export default class AxStudioLlamacppExtension extends AIEngine {
  readonly provider: string = 'llamacpp'
  readonly providerId: string = 'llamacpp'

  /** When true, auto-unload existing text model before loading a new one */
  private autoUnload: boolean = true
  /** Max seconds to wait for model to become ready */
  private timeout: number = 600
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
      ? rawSettings.map((s: any) =>
          s.key === 'fit'
            ? { ...s, controllerProps: { ...s.controllerProps, value: false } }
            : s
        )
      : rawSettings
    await this.registerSettings(settingsToRegister)

    // Read settings and populate local state
    await this._syncSettingsToConfig()

    // Discover / download the best backend for this hardware
    const versionBackend = await this.getSetting<string>('version_backend', '')
    configureBackends(
      versionBackend,
      this.autoUpdateEngine,
      (key: string, value: string) => this._updateSettingValue(key, value)
    ).catch((e) =>
      console.error('[llamacpp] Background backend config failed:', e)
    )

    this.registerEngine()
  }

  override async onUnload(): Promise<void> {
    const loadedModels = await this.getLoadedModels().catch(
      () => [] as string[]
    )
    for (const modelId of loadedModels) {
      await this.unload(modelId).catch(() => {})
    }

    if (this.axServingPid > 0) {
      try {
        await unloadLlamaModel(this.axServingPid)
      } catch {}
      this.axServingPid = 0
      this.axServingPort = 0
      this.axServingSessions.clear()
    }
    await this._syncLocalProviderRegistration()

    for (const off of this.cleanupListeners) {
      try {
        off()
      } catch {}
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

  onSettingUpdate<T>(key: string, value: T): void {
    const v = value as any
    const isWindows = IS_WINDOWS
    const isMac = IS_MACOS
    const isLinux = IS_LINUX

    switch (key) {
      case 'auto_unload':
        this.autoUnload = Boolean(v)
        break
      case 'auto_update_engine':
        this.autoUpdateEngine = Boolean(v)
        break
      case 'timeout':
        this.timeout = Number(v) || 600
        break
      case 'mirostat':
        this.mirostat = Number(v) || 0
        break
      case 'mirostat_lr':
        this.mirostatLr = Number(v) || 0.1
        break
      case 'mirostat_ent':
        this.mirostatEnt = Number(v) || 5.0
        break
      case 'grammar_file':
        this.grammarFile = String(v ?? '')
        break
      case 'json_schema_file':
        this.jsonSchemaFile = String(v ?? '')
        break
      default:
        break
    }

    // Build LlamacppConfig fields from each setting
    const cfg: any = this.config
    const num = (x: any, def = 0) => (x === '' || x == null ? def : Number(x))
    const bool = (x: any) => x === true || x === 'true' || x === 1 || x === '1'
    const str = (x: any, def = '') => (x == null || x === '' ? def : String(x))

    switch (key) {
      case 'version_backend':
        cfg.version_backend = str(v)
        break
      case 'auto_update_engine':
        cfg.auto_update_engine = bool(v)
        break
      case 'auto_unload':
        cfg.auto_unload = bool(v)
        break
      case 'timeout':
        cfg.timeout = num(v, 600)
        break
      case 'llamacpp_env':
        cfg.llamacpp_env = str(v)
        break
      case 'fit':
        cfg.fit = bool(v)
        break
      case 'fit_target':
        cfg.fit_target = str(v, '1024')
        break
      case 'fit_ctx':
        cfg.fit_ctx = str(v, '4096')
        break
      case 'ctx_size':
        cfg.ctx_size = num(v, 0)
        break
      case 'threads':
        cfg.threads = num(v, -1)
        break
      case 'threads_batch':
        cfg.threads_batch = num(v, -1)
        break
      case 'n_predict':
        cfg.n_predict = num(v, -1)
        break
      case 'ubatch_size':
        cfg.ubatch_size = num(v, 512)
        break
      case 'device':
        cfg.device = str(v)
        break
      case 'split_mode':
        cfg.split_mode = str(v, 'layer')
        break
      case 'main_gpu':
        cfg.main_gpu = num(v, 0)
        break
      case 'n_gpu_layers':
        cfg.n_gpu_layers = num(v, -1)
        break
      case 'flash_attn':
        cfg.flash_attn = str(v, 'auto')
        break
      case 'cont_batching':
        cfg.cont_batching = bool(v)
        break
      case 'no_mmap':
        cfg.no_mmap = bool(v)
        break
      case 'mlock':
        cfg.mlock = bool(v)
        break
      case 'no_kv_offload':
        cfg.no_kv_offload = bool(v)
        break
      case 'cache_type_k':
        cfg.cache_type_k = str(v, 'f16')
        break
      case 'cache_type_v':
        cfg.cache_type_v = str(v, 'f16')
        break
      case 'defrag_thold':
        cfg.defrag_thold = num(v, 0.1)
        break
      case 'rope_scaling':
        cfg.rope_scaling = str(v, 'none')
        break
      case 'rope_scale':
        cfg.rope_scale = num(v, 1.0)
        break
      case 'rope_freq_base':
        cfg.rope_freq_base = num(v, 0)
        break
      case 'rope_freq_scale':
        cfg.rope_freq_scale = num(v, 1.0)
        break
      case 'ctx_shift':
        cfg.ctx_shift = bool(v)
        break
      case 'offload_mmproj':
        cfg.offload_mmproj = bool(v)
        break
      case 'cpu_moe':
        cfg.cpu_moe = bool(v)
        break
      case 'n_cpu_moe':
        cfg.n_cpu_moe = num(v, 0)
        break
      case 'engine_type': {
        const prev = cfg.engine_type
        cfg.engine_type = str(v, 'llamacpp')
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
    await this.updateSettings([{ key, controllerProps: { value } as any }])
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
    } catch {
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
          } catch {
            // Not a directory or inaccessible — skip
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
    overrideSettings?: Record<string, any>,
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
    overrideSettings?: Record<string, any>,
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
        } catch (axErr: any) {
          console.warn(
            `[llamacpp] ax-serving failed, falling back to llamacpp: ${axErr?.message ?? axErr}`
          )
        }
      }

      return await this._doLoadLlamacpp(
        modelId,
        cfg,
        overrideSettings,
        isEmbedding
      )
    } catch (e: any) {
      events.emit(ModelEvent.OnModelFail, {
        modelId,
        error: e?.message ?? String(e),
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

    // Security: Prevent path traversal from tampered model.yml
    if (!modelPath.startsWith(appData + '/models')) {
      throw new Error(`Model path traversal detected: ${modelPath}`)
    }

    if (!(await fs.existsSync(modelPath))) {
      throw new Error(`Model file not found: ${modelPath}`)
    }

    // Resolve mmproj path for vision/multimodal models
    let mmprojPath: string | undefined
    if (cfg.mmproj_path) {
      mmprojPath = await joinPath([appData, cfg.mmproj_path])
      // Security: Prevent path traversal
      if (!mmprojPath.startsWith(appData + '/models')) {
        throw new Error(`Mmproj path traversal detected: ${mmprojPath}`)
      }
      if (!(await fs.existsSync(mmprojPath))) {
        console.warn(
          `[llamacpp] mmproj file not found: ${mmprojPath}, loading without vision`
        )
        mmprojPath = undefined
      }
    }

    // Build load request with all supported fields
    const loadBody: Record<string, any> = {
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
            signal: AbortSignal.timeout(3000),
          }
        )
        if (res.ok) return
      } catch {}
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
    const llamacppModels = await getLoadedModels().catch(() => [] as string[])
    const axServingModels = Array.from(this.axServingSessions.keys())
    const firstAxServingSession = this.axServingSessions.values().next()
      .value as SessionInfo | undefined
    const loadedModels = [...new Set([...llamacppModels, ...axServingModels])]
    const fallbackSession =
      llamacppModels.length > 0
        ? await findSessionByModel(llamacppModels[0]).catch(() => null)
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
    overrideSettings?: Record<string, any>,
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

    // Security: Prevent path traversal
    if (!modelPath.startsWith(appData + '/models')) {
      throw new Error(`Model path traversal detected: ${modelPath}`)
    }

    const mmprojPath = cfg.mmproj_path
      ? await joinPath([appData, cfg.mmproj_path])
      : undefined

    if (mmprojPath && !mmprojPath.startsWith(appData + '/models')) {
      throw new Error(`Mmproj path traversal detected: ${mmprojPath}`)
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
        if (value !== undefined && value !== '' && value !== null) {
          ;(mergedConfig as any)[key] = value
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
      for (const pair of String(this.config.llamacpp_env).split(/\s+/)) {
        const idx = pair.indexOf('=')
        if (idx > 0) {
          envs[pair.slice(0, idx)] = pair.slice(idx + 1)
        }
      }
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
      const llamacppIds = await getLoadedModels().catch(() => [] as string[])
      const axServingIds = Array.from(this.axServingSessions.keys())
      const allIds = [...new Set([...llamacppIds, ...axServingIds])]

      for (const id of allIds) {
        if (id === excludeModelId) continue
        // Wait for any in-progress load for this model to complete
        await this.loadingModels.get(id)?.catch(() => {})
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

    const doSwitch = async () => {
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
    }

    doSwitch().catch((e) =>
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
    } catch (e: any) {
      console.error('[llamacpp] unload error:', e)
      return { success: false, error: e?.message ?? String(e) }
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
    const body: any = {
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
        signal: abortController?.signal,
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
    body: any,
    abortController?: AbortController
  ): AsyncIterable<chatCompletionChunk> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortController?.signal,
    })

    if (!response.ok) {
      throw new Error(
        `llama-server error ${response.status}: ${await response.text()}`
      )
    }

    const reader = response.body!.getReader()
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
              if ((e as Error).message?.includes('context size')) throw e
              // Skip malformed SSE lines
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
          signal: AbortSignal.timeout(5000),
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
      } catch (e: any) {
        if (e?.message?.includes('evicted')) throw e
        // ax-serving process may have crashed — reset state
        console.error('[llamacpp] ax-serving health check failed:', e)
        this.axServingPid = 0
        this.axServingPort = 0
        this.axServingSessions.clear()
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
      await this.unload(modelId).catch(() => {})
      throw new Error(
        `Model "${modelId}" process crashed. Please reload the model.`
      )
    }

    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.status === 404) {
        await this.unload(modelId).catch(() => {})
        throw new Error(`Model "${modelId}" server unavailable. Please reload.`)
      }
    } catch (e: any) {
      if (
        e?.message?.includes('crashed') ||
        e?.message?.includes('unavailable')
      )
        throw e
      // Timeout or network error — the server may still be initializing, continue
    }
  }

  // ─── import() ─────────────────────────────────────────────────────────────

  async import(modelId: string, opts: ImportOptions): Promise<void> {
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

    const downloadExt = (window as any).core?.extensionManager?.getByName(
      '@ax-studio/download-extension'
    )

    // ── Download model file if URL provided ──
    const modelPath = opts.modelPath
    if (modelPath.startsWith('http://') || modelPath.startsWith('https://')) {
      if (!downloadExt) throw new Error('Download extension not available')

      events.emit(DownloadEvent.onFileDownloadStarted, {
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
          (transferred: number, total: number) => {
            events.emit(DownloadEvent.onFileDownloadUpdate, {
              modelId,
              fileName: 'model.gguf',
              percent: transferred / total,
              size: { transferred, total },
              downloadState: 'downloading',
            })
          }
        )
      } catch (e) {
        try {
          await fs.rm(modelFilePath)
        } catch {}
        events.emit(DownloadEvent.onFileDownloadError, {
          modelId,
          error: String(e),
        })
        throw e
      }

      events.emit(DownloadEvent.onFileDownloadSuccess, {
        modelId,
        fileName: 'model.gguf',
      })

      // Validate SHA256 if provided
      if (opts.modelSha256) {
        events.emit(DownloadEvent.onModelValidationStarted, { modelId })
        const valid = await this._validateSha256(
          modelFilePath,
          opts.modelSha256
        )
        if (!valid) {
          try {
            await fs.rm(modelFilePath)
          } catch {}
          events.emit(DownloadEvent.onModelValidationFailed, { modelId })
          throw new Error(
            `SHA256 mismatch for model "${modelId}". File may be corrupted.`
          )
        }
        events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, {
          modelId,
        })
      }
    } else {
      // Local file — copy to models directory
      await fs.copyFile(modelPath, modelFilePath)
    }

    // ── Download mmproj file if provided ──
    let relativeMmprojPath: string | undefined
    if (opts.mmprojPath) {
      const mmprojFilePath = await joinPath([modelDir, 'mmproj.gguf'])
      relativeMmprojPath = `llamacpp/models/${modelId}/mmproj.gguf`

      if (opts.mmprojPath.startsWith('http')) {
        if (!downloadExt) throw new Error('Download extension not available')
        const proxy = getProxyConfig()
        await downloadExt.downloadFile(
          opts.mmprojPath,
          mmprojFilePath,
          `llamacpp-mmproj-${modelId}`,
          buildProxyArg(proxy)
        )
      } else {
        await fs.copyFile(opts.mmprojPath, mmprojFilePath)
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
      } catch {}
    }
    // Clean up partial model directory
    try {
      const modelDir = await this._modelDir(modelId)
      if (await fs.existsSync(modelDir)) await fs.rm(modelDir)
    } catch {}
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
    } catch {}

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
    } catch {
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
      // Security: Prevent path traversal
      if (!modelPath.startsWith(appData + '/models')) return false
      const meta: GgufMetadata = await readGgufMetadata(modelPath)
      const template = meta.metadata?.['tokenizer.chat_template'] ?? ''
      return template.toLowerCase().includes('tool')
    } catch {
      return false
    }
  }

  async checkMmprojExists(modelId: string): Promise<boolean> {
    try {
      const cfg = await this._readModelConfig(modelId)
      if (!cfg || !cfg.mmproj_path) return false
      const appData = await getAppDataFolderPath()
      const mmprojPath = await joinPath([appData, cfg.mmproj_path])
      // Security: Prevent path traversal
      if (!mmprojPath.startsWith(appData + '/models')) return false
      return await fs.existsSync(mmprojPath)
    } catch {
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
      return raw.map((d: any) => ({
        id: d.id,
        name: d.name,
        mem: d.mem ?? d.memory ?? 0,
        free: d.free ?? 0,
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
      })
      if (!templateRes.ok)
        throw new Error(`apply-template ${templateRes.status}`)
      const { prompt } = await templateRes.json()

      // Tokenize
      const tokenRes = await fetch(`${baseUrl}/tokenize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: prompt }),
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
      // If not available, skip validation
      return true
    } catch {
      return true
    }
  }
}
