// llama-server CLI argument builder — port of `ArgumentBuilder` in
// src-tauri/plugins/tauri-plugin-llamacpp/src/args.rs (ax-serving builder
// excluded: ax-serving is discontinued).

export interface LlamacppConfig {
  version_backend: string
  auto_update_engine: boolean
  auto_unload: boolean
  timeout: number
  llamacpp_env: string
  fit: boolean
  fit_target: string
  fit_ctx: string
  chat_template: string
  n_gpu_layers: number
  offload_mmproj: boolean
  cpu_moe: boolean
  n_cpu_moe: number
  override_tensor_buffer_t: string
  ctx_size: number
  threads: number
  threads_batch: number
  n_predict: number
  batch_size: number
  ubatch_size: number
  device: string
  split_mode: string
  main_gpu: number
  flash_attn: string
  cont_batching: boolean
  no_mmap: boolean
  mlock: boolean
  no_kv_offload: boolean
  cache_type_k: string
  cache_type_v: string
  defrag_thold: number
  rope_scaling: string
  rope_scale: number
  rope_freq_base: number
  rope_freq_scale: number
  ctx_shift: boolean
  engine_type: string
}

const DEFAULT_CONFIG: LlamacppConfig = {
  version_backend: '',
  auto_update_engine: false,
  auto_unload: false,
  timeout: 600,
  llamacpp_env: '',
  fit: false,
  fit_target: '',
  fit_ctx: '',
  chat_template: '',
  n_gpu_layers: 0,
  offload_mmproj: false,
  cpu_moe: false,
  n_cpu_moe: 0,
  override_tensor_buffer_t: '',
  ctx_size: 0,
  threads: 0,
  threads_batch: 0,
  n_predict: 0,
  batch_size: 0,
  ubatch_size: 0,
  device: '',
  split_mode: '',
  main_gpu: 0,
  flash_attn: '',
  cont_batching: false,
  no_mmap: false,
  mlock: false,
  no_kv_offload: false,
  cache_type_k: '',
  cache_type_v: '',
  defrag_thold: 0.0,
  rope_scaling: '',
  rope_scale: 1.0,
  rope_freq_base: 0.0,
  rope_freq_scale: 1.0,
  ctx_shift: false,
  engine_type: 'llamacpp',
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asStr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** Fill missing fields with the Rust serde defaults; the guest-js normalizes already. */
export function normalizeLlamacppConfig(raw: unknown): LlamacppConfig {
  const source = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    version_backend: asStr(source.version_backend, DEFAULT_CONFIG.version_backend),
    auto_update_engine: asBool(source.auto_update_engine, DEFAULT_CONFIG.auto_update_engine),
    auto_unload: asBool(source.auto_unload, DEFAULT_CONFIG.auto_unload),
    timeout: asNum(source.timeout, DEFAULT_CONFIG.timeout),
    llamacpp_env: asStr(source.llamacpp_env, DEFAULT_CONFIG.llamacpp_env),
    fit: asBool(source.fit, DEFAULT_CONFIG.fit),
    fit_target: asStr(source.fit_target, DEFAULT_CONFIG.fit_target),
    fit_ctx: asStr(source.fit_ctx, DEFAULT_CONFIG.fit_ctx),
    chat_template: asStr(source.chat_template, DEFAULT_CONFIG.chat_template),
    n_gpu_layers: asNum(source.n_gpu_layers, DEFAULT_CONFIG.n_gpu_layers),
    offload_mmproj: asBool(source.offload_mmproj, DEFAULT_CONFIG.offload_mmproj),
    cpu_moe: asBool(source.cpu_moe, DEFAULT_CONFIG.cpu_moe),
    n_cpu_moe: asNum(source.n_cpu_moe, DEFAULT_CONFIG.n_cpu_moe),
    override_tensor_buffer_t: asStr(
      source.override_tensor_buffer_t,
      DEFAULT_CONFIG.override_tensor_buffer_t,
    ),
    ctx_size: asNum(source.ctx_size, DEFAULT_CONFIG.ctx_size),
    threads: asNum(source.threads, DEFAULT_CONFIG.threads),
    threads_batch: asNum(source.threads_batch, DEFAULT_CONFIG.threads_batch),
    n_predict: asNum(source.n_predict, DEFAULT_CONFIG.n_predict),
    batch_size: asNum(source.batch_size, DEFAULT_CONFIG.batch_size),
    ubatch_size: asNum(source.ubatch_size, DEFAULT_CONFIG.ubatch_size),
    device: asStr(source.device, DEFAULT_CONFIG.device),
    split_mode: asStr(source.split_mode, DEFAULT_CONFIG.split_mode),
    main_gpu: asNum(source.main_gpu, DEFAULT_CONFIG.main_gpu),
    flash_attn: asStr(source.flash_attn, DEFAULT_CONFIG.flash_attn),
    cont_batching: asBool(source.cont_batching, DEFAULT_CONFIG.cont_batching),
    no_mmap: asBool(source.no_mmap, DEFAULT_CONFIG.no_mmap),
    mlock: asBool(source.mlock, DEFAULT_CONFIG.mlock),
    no_kv_offload: asBool(source.no_kv_offload, DEFAULT_CONFIG.no_kv_offload),
    cache_type_k: asStr(source.cache_type_k, DEFAULT_CONFIG.cache_type_k),
    cache_type_v: asStr(source.cache_type_v, DEFAULT_CONFIG.cache_type_v),
    defrag_thold: asNum(source.defrag_thold, DEFAULT_CONFIG.defrag_thold),
    rope_scaling: asStr(source.rope_scaling, DEFAULT_CONFIG.rope_scaling),
    rope_scale: asNum(source.rope_scale, DEFAULT_CONFIG.rope_scale),
    rope_freq_base: asNum(source.rope_freq_base, DEFAULT_CONFIG.rope_freq_base),
    rope_freq_scale: asNum(source.rope_freq_scale, DEFAULT_CONFIG.rope_freq_scale),
    ctx_shift: asBool(source.ctx_shift, DEFAULT_CONFIG.ctx_shift),
    engine_type: asStr(source.engine_type, DEFAULT_CONFIG.engine_type),
  }
}

/** Format a number the way Rust's `Display` does for f32 (1.0 → "1", 0.5 → "0.5"). */
function num(value: number): string {
  return String(value)
}

/** Rust compares these thresholds as f32; mirror its epsilon. */
const F32_EPSILON = 1.1920928955078125e-7

/**
 * Build the llama-server argument vector. Direct port of
 * `ArgumentBuilder::build`; throws on invalid `version_backend` format.
 */
export function buildLlamacppArgs(
  config: LlamacppConfig,
  modelId: string,
  modelPath: string,
  port: number,
  mmprojPath: string | undefined,
  isEmbedding: boolean,
): string[] {
  const backend = config.version_backend.split('/')[1]
  if (backend === undefined) {
    throw new Error('Invalid version_backend format')
  }
  const isIkBackend = backend.startsWith('ik')
  const args: string[] = []

  // Disable llama-server webui for non-ik backends
  if (!isIkBackend) args.push('--no-webui')

  // Jinja template support
  args.push('--jinja')

  // Model path (required)
  args.push('-m', modelPath)

  // CPU MOE settings
  if (config.cpu_moe) args.push('--cpu-moe')
  if (config.n_cpu_moe > 0) args.push('--n-cpu-moe', num(config.n_cpu_moe))

  // Tensor buffer override
  if (config.override_tensor_buffer_t !== '') {
    args.push('--override-tensor', config.override_tensor_buffer_t)
  }

  // Multimodal projector settings
  if (mmprojPath !== undefined && mmprojPath !== '') {
    args.push('--mmproj', mmprojPath)
  }

  // Model alias and port
  args.push('-a', modelId, '--port', num(port))

  // Chat template
  if (config.chat_template !== '') args.push('--chat-template', config.chat_template)

  // GPU layers: 100 means load all layers
  const gpuLayers = config.n_gpu_layers >= 0 && config.n_gpu_layers !== 100 ? config.n_gpu_layers : -1
  args.push('-ngl', num(gpuLayers))

  // Thread settings
  if (config.threads > 0) args.push('--threads', num(config.threads))
  if (config.threads_batch > 0) args.push('--threads-batch', num(config.threads_batch))

  // Batch settings
  if (config.batch_size > 0 && config.batch_size !== 2048) {
    args.push('--batch-size', num(config.batch_size))
  }
  if (config.ubatch_size > 0 && config.ubatch_size !== 512) {
    args.push('--ubatch-size', num(config.ubatch_size))
  }

  // Device and split mode
  if (config.device !== '') args.push('--device', config.device)
  if (config.split_mode !== '' && config.split_mode !== 'layer') {
    args.push('--split-mode', config.split_mode)
  }
  if (config.main_gpu !== 0) args.push('--main-gpu', num(config.main_gpu))

  // Flash attention
  if (isIkBackend) {
    // ik fork uses old -fa flag
    if (config.flash_attn === 'on') args.push('-fa')
  } else if (config.flash_attn !== '' && config.flash_attn !== 'auto') {
    args.push('--flash-attn', config.flash_attn)
  }

  // Boolean flags
  if (config.ctx_shift) args.push('--context-shift')
  if (config.cont_batching) args.push('--cont-batching')
  if (config.no_mmap) args.push('--no-mmap')
  if (config.mlock) args.push('--mlock')
  if (config.no_kv_offload) args.push('--no-kv-offload')

  // Embedding vs text generation specific args
  if (isEmbedding) {
    args.push('--embedding', '--pooling', 'mean')
  } else {
    if (config.ctx_size > 0 && !config.fit) args.push('--ctx-size', num(config.ctx_size))
    if (config.n_predict > 0) args.push('--n-predict', num(config.n_predict))
    if (config.cache_type_k !== '' && config.cache_type_k !== 'f16') {
      args.push('--cache-type-k', config.cache_type_k)
    }
    // cache_type_v only if flash_attn is 'on' and value is not f16/f32
    if (
      config.flash_attn === 'on' &&
      config.cache_type_v !== '' &&
      config.cache_type_v !== 'f16' &&
      config.cache_type_v !== 'f32'
    ) {
      args.push('--cache-type-v', config.cache_type_v)
    }
    if (Math.abs(config.defrag_thold - 0.1) > F32_EPSILON) {
      args.push('--defrag-thold', num(config.defrag_thold))
    }
    // RoPE settings
    if (config.rope_scaling !== '' && config.rope_scaling !== 'none') {
      args.push('--rope-scaling', config.rope_scaling)
    }
    if (Math.abs(config.rope_scale - 1.0) > F32_EPSILON) {
      args.push('--rope-scale', num(config.rope_scale))
    }
    if (config.rope_freq_base !== 0.0) {
      args.push('--rope-freq-base', num(config.rope_freq_base))
    }
    if (Math.abs(config.rope_freq_scale - 1.0) > F32_EPSILON) {
      args.push('--rope-freq-scale', num(config.rope_freq_scale))
    }
  }

  // llama fit (forks like ik are not supported)
  if (!isIkBackend) {
    args.push('--fit', config.fit ? 'on' : 'off')
    if (config.fit) {
      if (config.fit_ctx !== '' && config.fit_ctx !== '4096') {
        args.push('--fit-ctx', config.fit_ctx)
      }
      if (config.fit_target !== '' && config.fit_target !== '1024') {
        args.push('--fit-target', config.fit_target)
      }
    }
  }

  return args
}
