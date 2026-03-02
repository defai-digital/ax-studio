/**
 * Ax-Fabric llama.cpp Extension — Main Engine Class
 *
 * Implements AIEngine from @ax-fabric/core to provide local LLM inference
 * via llama.cpp. Written from scratch for Ax-Fabric (UNLICENSED).
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
} from '@ax-fabric/core'

import {
  loadLlamaModel,
  unloadLlamaModel,
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
} from '@ax-fabric/tauri-plugin-llamacpp-api'

import { invoke } from '@tauri-apps/api/core'

import {
  configureBackends,
  downloadBackend,
  updateBackend,
  installBackendFromFile,
  getBackendExePath,
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

// Injected by rolldown at build time
declare const SETTINGS: any[]
declare const ENGINE: string
declare const IS_WINDOWS: boolean
declare const IS_MACOS: boolean
declare const IS_LINUX: boolean

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

export default class AxFabricLlamacppExtension extends AIEngine {
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

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  override async onLoad(): Promise<void> {
    // Safety check for injected constants
    const rawSettings = typeof SETTINGS !== 'undefined' ? SETTINGS : []
    const isMac = typeof IS_MACOS !== 'undefined' ? IS_MACOS : false

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
    ).catch(e => console.error('[llamacpp] Background backend config failed:', e))

    this.registerEngine()
  }

  override async onUnload(): Promise<void> {
    for (const off of this.cleanupListeners) {
      try { off() } catch {}
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
    const isWindows = typeof IS_WINDOWS !== 'undefined' ? IS_WINDOWS : false
    const isMac = typeof IS_MACOS !== 'undefined' ? IS_MACOS : false
    const isLinux = typeof IS_LINUX !== 'undefined' ? IS_LINUX : false

    switch (key) {
      case 'auto_unload':       this.autoUnload = Boolean(v); break
      case 'auto_update_engine':this.autoUpdateEngine = Boolean(v); break
      case 'timeout':           this.timeout = Number(v) || 600; break
      case 'mirostat':          this.mirostat = Number(v) || 0; break
      case 'mirostat_lr':       this.mirostatLr = Number(v) || 0.1; break
      case 'mirostat_ent':      this.mirostatEnt = Number(v) || 5.0; break
      case 'grammar_file':      this.grammarFile = String(v ?? ''); break
      case 'json_schema_file':  this.jsonSchemaFile = String(v ?? ''); break
      default: break
    }

    // Build LlamacppConfig fields from each setting
    const cfg: any = this.config
    const num = (x: any, def = 0) => (x === '' || x == null ? def : Number(x))
    const bool = (x: any) => x === true || x === 'true' || x === 1 || x === '1'
    const str = (x: any, def = '') => (x == null || x === '' ? def : String(x))

    switch (key) {
      case 'version_backend':       cfg.version_backend = str(v); break
      case 'auto_update_engine':    cfg.auto_update_engine = bool(v); break
      case 'auto_unload':           cfg.auto_unload = bool(v); break
      case 'timeout':               cfg.timeout = num(v, 600); break
      case 'llamacpp_env':          cfg.llamacpp_env = str(v); break
      case 'fit':                   cfg.fit = bool(v); break
      case 'fit_target':            cfg.fit_target = str(v, '1024'); break
      case 'fit_ctx':               cfg.fit_ctx = str(v, '4096'); break
      case 'ctx_size':              cfg.ctx_size = num(v, 0); break
      case 'threads':               cfg.threads = num(v, -1); break
      case 'threads_batch':         cfg.threads_batch = num(v, -1); break
      case 'n_predict':             cfg.n_predict = num(v, -1); break
      case 'ubatch_size':           cfg.ubatch_size = num(v, 512); break
      case 'device':                cfg.device = str(v); break
      case 'split_mode':            cfg.split_mode = str(v, 'layer'); break
      case 'main_gpu':              cfg.main_gpu = num(v, 0); break
      case 'n_gpu_layers':          cfg.n_gpu_layers = num(v, -1); break
      case 'flash_attn':            cfg.flash_attn = str(v, 'auto'); break
      case 'cont_batching':         cfg.cont_batching = bool(v); break
      case 'no_mmap':               cfg.no_mmap = bool(v); break
      case 'mlock':                 cfg.mlock = bool(v); break
      case 'no_kv_offload':         cfg.no_kv_offload = bool(v); break
      case 'cache_type_k':          cfg.cache_type_k = str(v, 'f16'); break
      case 'cache_type_v':          cfg.cache_type_v = str(v, 'f16'); break
      case 'defrag_thold':          cfg.defrag_thold = num(v, 0.1); break
      case 'rope_scaling':          cfg.rope_scaling = str(v, 'none'); break
      case 'rope_scale':            cfg.rope_scale = num(v, 1.0); break
      case 'rope_freq_base':        cfg.rope_freq_base = num(v, 0); break
      case 'rope_freq_scale':       cfg.rope_freq_scale = num(v, 1.0); break
      case 'ctx_shift':             cfg.ctx_shift = bool(v); break
      case 'offload_mmproj':        cfg.offload_mmproj = bool(v); break
      case 'cpu_moe':               cfg.cpu_moe = bool(v); break
      case 'n_cpu_moe':             cfg.n_cpu_moe = num(v, 0); break
    }
  }

  /** Persist a setting value update to localStorage */
  private async _updateSettingValue(key: string, value: string): Promise<void> {
    await this.updateSettings([
      { key, controllerProps: { value } as any },
    ])
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
        mmproj_path: parsed.mmproj_path ? String(parsed.mmproj_path) : undefined,
        name: String(parsed.name ?? modelId),
        size_bytes: Number(parsed.size_bytes ?? 0),
        embedding: Boolean(parsed.embedding),
        sha256: parsed.sha256 ? String(parsed.sha256) : undefined,
        mmproj_sha256: parsed.mmproj_sha256 ? String(parsed.mmproj_sha256) : undefined,
      }
    } catch {
      return null
    }
  }

  private async _writeModelConfig(modelId: string, cfg: ModelConfig): Promise<void> {
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
      const engineName = typeof ENGINE !== 'undefined' ? ENGINE : 'llamacpp'
      const modelsDir = await this._modelsDir()
      if (!(await fs.existsSync(modelsDir))) return []

      const results: modelInfo[] = []

      // Ensure modelsDir ends with separator for reliable prefix stripping
      const sep = modelsDir.includes('\\') ? '\\' : '/'
      const modelsDirPrefix = modelsDir.endsWith(sep) ? modelsDir : modelsDir + sep

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
    const cfg = await this._readModelConfig(modelId)
    if (!cfg) return undefined
    const engineName = typeof ENGINE !== 'undefined' ? ENGINE : 'llamacpp'
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
    // Deduplicate concurrent load calls for the same model
    const existing = this.loadingModels.get(modelId)
    if (existing) return existing

    const loadPromise = this._doLoad(modelId, overrideSettings, isEmbedding, bypassAutoUnload)
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

      // Resolve backend path
      const versionBackend = await this.getSetting<string>('version_backend', '')
      if (!versionBackend) {
        throw new Error('No backend selected. Please configure the engine backend in settings.')
      }
      const [version, ...rest] = versionBackend.split('/')
      const backend = rest.join('/')
      const backendPath = await this._ensureBackend(version, backend)

      // Read model config
      const cfg = await this._readModelConfig(modelId)
      if (!cfg) throw new Error(`Model not found: ${modelId}`)

      // Resolve absolute paths
      const appData = await getAppDataFolderPath()
      const modelPath = await joinPath([appData, cfg.model_path])
      const mmprojPath = cfg.mmproj_path
        ? await joinPath([appData, cfg.mmproj_path])
        : undefined

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
      const mergedConfig: Partial<LlamacppConfig> = { ...this.config }
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
      // This prevents a race condition where sendMessages() sends a request
      // to the proxy before the provider is registered.
      try {
        await invoke('register_provider_config', {
          request: {
            provider: this.providerId,
            base_url: `http://localhost:${session.port}/v1`,
            api_key: session.api_key ?? '',
            custom_headers: [],
            models: [modelId],
          },
        })
      } catch (regErr) {
        console.warn('[llamacpp] Failed to register provider with proxy:', regErr)
      }

      events.emit(ModelEvent.OnModelReady, {
        modelId,
        port: session.port,
        api_key: session.api_key,
        provider: this.providerId,
      })
      return session
    } catch (e: any) {
      events.emit(ModelEvent.OnModelFail, { modelId, error: e?.message ?? String(e) })
      throw e
    }
  }

  /** Ensure backend binary is present, downloading if necessary */
  private async _ensureBackend(version: string, backend: string): Promise<string> {
    const key = `${version}_${backend}`

    // Coalesce concurrent download requests for the same backend
    const pending = this.pendingDownloads.get(key)
    if (pending) await pending

    const exePath = await getBackendExePath(version, backend)
    if (!(await fs.existsSync(exePath))) {
      if (!this.pendingDownloads.has(key)) {
        const downloadPromise = downloadBackend(version, backend).finally(() => {
          this.pendingDownloads.delete(key)
        })
        this.pendingDownloads.set(key, downloadPromise)
      }
      await this.pendingDownloads.get(key)
    }

    return exePath
  }

  /** Unload all active text models except the one about to be loaded */
  private async _unloadActiveTextModels(excludeModelId: string): Promise<void> {
    try {
      const activeIds = await getLoadedModels()
      for (const id of activeIds) {
        if (id === excludeModelId) continue
        // Wait for any in-progress load for this model to complete
        await this.loadingModels.get(id)?.catch(() => {})
        try {
          const session = await findSessionByModel(id)
          if (session && !session.is_embedding) {
            await this.unload(id)
          }
        } catch (e) {
          console.warn(`[llamacpp] Failed to auto-unload ${id}:`, e)
        }
      }
    } catch (e) {
      console.warn('[llamacpp] _unloadActiveTextModels error:', e)
    }
  }

  // ─── unload() ─────────────────────────────────────────────────────────────

  async unload(sessionId: string): Promise<UnloadResult> {
    try {
      // sessionId is the modelId in this engine
      const session = await findSessionByModel(sessionId)
      if (!session) {
        return { success: true }
      }
      events.emit(ModelEvent.OnModelStop, { modelId: sessionId })
      const result = await unloadLlamaModel(session.pid)
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
      Authorization: `Bearer ${session.api_key}`,
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
        throw new Error(`llama-server error ${response.status}: ${await response.text()}`)
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
      throw new Error(`llama-server error ${response.status}: ${await response.text()}`)
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
    const session = await findSessionByModel(modelId)
    if (!session) {
      throw new Error(`Model "${modelId}" is not loaded. Load it first.`)
    }
    return session
  }

  /** Health check — verify the llama-server process is alive */
  private async _healthCheck(port: number, pid: number, modelId: string): Promise<void> {
    const alive = await isProcessRunning(pid)
    if (!alive) {
      await this.unload(modelId).catch(() => {})
      throw new Error(`Model "${modelId}" process crashed. Please reload the model.`)
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
      if (e?.message?.includes('crashed') || e?.message?.includes('unavailable')) throw e
      // Timeout or network error — the server may still be initializing, continue
    }
  }

  // ─── import() ─────────────────────────────────────────────────────────────

  async import(modelId: string, opts: ImportOptions): Promise<void> {
    // Validate model ID — no path traversal
    if (!/^[a-zA-Z0-9/\-_.]+$/.test(modelId) || modelId.includes('..')) {
      throw new Error(`Invalid model ID: "${modelId}". Use only alphanumeric, /, -, _, . characters.`)
    }

    const appData = await getAppDataFolderPath()
    const modelDir = await this._modelDir(modelId)
    const modelFilePath = await joinPath([modelDir, 'model.gguf'])
    const relativeModelPath = `llamacpp/models/${modelId}/model.gguf`

    if (!(await fs.existsSync(modelDir))) await fs.mkdir(modelDir)

    const downloadExt = (window as any).core?.extensionManager?.getByName(
      '@ax-fabric/download-extension'
    )

    // ── Download model file if URL provided ──
    const modelPath = opts.modelPath
    if (modelPath.startsWith('http://') || modelPath.startsWith('https://')) {
      if (!downloadExt) throw new Error('Download extension not available')

      events.emit(DownloadEvent.onFileDownloadStarted, { modelId, fileName: 'model.gguf' })

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
        try { await fs.rm(modelFilePath) } catch {}
        events.emit(DownloadEvent.onFileDownloadError, { modelId, error: String(e) })
        throw e
      }

      events.emit(DownloadEvent.onFileDownloadSuccess, { modelId, fileName: 'model.gguf' })

      // Validate SHA256 if provided
      if (opts.modelSha256) {
        events.emit(DownloadEvent.onModelValidationStarted, { modelId })
        const valid = await this._validateSha256(modelFilePath, opts.modelSha256)
        if (!valid) {
          try { await fs.rm(modelFilePath) } catch {}
          events.emit(DownloadEvent.onModelValidationFailed, { modelId })
          throw new Error(`SHA256 mismatch for model "${modelId}". File may be corrupted.`)
        }
        events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, { modelId })
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
      '@ax-fabric/download-extension'
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

  // ─── delete() / update() ──────────────────────────────────────────────────

  async delete(modelId: string): Promise<void> {
    // Unload first if running
    try {
      const session = await findSessionByModel(modelId)
      if (session) await this.unload(modelId)
    } catch {}

    const modelDir = await this._modelDir(modelId)
    if (await fs.existsSync(modelDir)) {
      await fs.rm(modelDir)
    }
  }

  async update(modelId: string, model: Partial<modelInfo>): Promise<void> {
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
      return await getLoadedModels()
    } catch {
      return []
    }
  }

  // ─── isToolSupported() ────────────────────────────────────────────────────

  async isToolSupported(modelId: string): Promise<boolean> {
    try {
      const cfg = await this._readModelConfig(modelId)
      if (!cfg) return false
      const appData = await getAppDataFolderPath()
      const modelPath = await joinPath([appData, cfg.model_path])
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
      return await fs.existsSync(mmprojPath)
    } catch {
      return false
    }
  }

  // ─── getDevices() ─────────────────────────────────────────────────────────

  async getDevices(): Promise<DeviceList[]> {
    try {
      const versionBackend = await this.getSetting<string>('version_backend', '')
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
      const res = await fetch(`http://localhost:${session.port}/v1/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: batch.inputs,
          model: modelId,
          encoding_format: 'float',
        }),
      })
      if (!res.ok) throw new Error(`Embedding error: ${res.status} ${await res.text()}`)
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
      Authorization: `Bearer ${session.api_key}`,
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
      if (!templateRes.ok) throw new Error(`apply-template ${templateRes.status}`)
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

  async isModelSupported(path: string, ctxSize?: number): Promise<'GREEN' | 'YELLOW' | 'RED'> {
    return isModelSupported(path, ctxSize)
  }

  async validateGgufFile(path: string): Promise<{ isValid: boolean; error?: string; metadata?: GgufMetadata }> {
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

  async updateBackend(targetVersionBackend: string): Promise<{ wasUpdated: boolean; newBackend: string }> {
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

  private async _validateSha256(filePath: string, expected: string): Promise<boolean> {
    try {
      // Use the core API if available (Tauri backend provides this)
      const result = await (window as any).core?.api?.validateSha256?.(filePath, expected)
      if (result !== undefined) return Boolean(result)
      // If not available, skip validation
      return true
    } catch {
      return true
    }
  }
}
