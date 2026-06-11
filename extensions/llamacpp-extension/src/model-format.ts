/**
 * Model format detection and ax-serving load-request construction.
 *
 * ax-serving routes a load request to a backend based on the model path and
 * an optional explicit `backend` hint:
 *  - `.gguf` files          → llama.cpp (default route)
 *  - MLX model directories  → mlx (`config.json` + `*.safetensors`), hint "mlx"
 *  - AX Engine artifact dirs → native ax-engine (`model-manifest.json`), hint "native"
 *
 * Without the hint, GGUF always wins, so MLX/native models must send it
 * explicitly to actually reach the ax-engine runtime.
 */

export type ModelFormat = 'gguf' | 'mlx' | 'ax-native'

/** Marker file identifying an AX Engine native artifact directory */
const AX_NATIVE_MARKER = 'model-manifest.json'
/** Marker file identifying an MLX model directory */
const MLX_MARKER = 'config.json'

/** Detect the model format from a directory's (or manifest's) file names */
export function detectModelFormatFromFiles(fileNames: string[]): ModelFormat {
  const names = fileNames.map((f) => f.toLowerCase())
  if (names.includes(AX_NATIVE_MARKER)) return 'ax-native'
  if (
    names.includes(MLX_MARKER) ||
    names.some((n) => n.endsWith('.safetensors'))
  ) {
    return 'mlx'
  }
  return 'gguf'
}

/** Formats whose model_path is a directory rather than a single .gguf file */
export function isDirectoryFormat(format: ModelFormat): boolean {
  return format === 'mlx' || format === 'ax-native'
}

/** Map a model format to the ax-serving `backend` hint (undefined = auto) */
export function axServingBackendHint(format: ModelFormat): string | undefined {
  if (format === 'mlx') return 'mlx'
  if (format === 'ax-native') return 'native'
  return undefined
}

/** Build the POST /v1/models request body for ax-serving */
export function buildAxServingLoadBody(args: {
  modelId: string
  modelPath: string
  format: ModelFormat
  mmprojPath?: string
  nGpuLayers?: number
  ctxSize?: number
}): Record<string, unknown> {
  const { modelId, modelPath, format, mmprojPath, nGpuLayers, ctxSize } = args
  const body: Record<string, unknown> = {
    model_id: modelId,
    path: modelPath,
  }

  const backend = axServingBackendHint(format)
  if (backend) body.backend = backend

  if (ctxSize != null && ctxSize > 0) body.context_length = ctxSize

  // GGUF-only llama.cpp options — MLX/native backends do not understand them
  if (format === 'gguf') {
    if (mmprojPath) body.mmproj_path = mmprojPath
    if (nGpuLayers != null && nGpuLayers >= 0 && nGpuLayers !== 100) {
      body.n_gpu_layers = nGpuLayers
    }
  }

  return body
}

/**
 * Validate a file name from an import manifest so it cannot escape the
 * model directory. Only flat names are allowed (HF MLX repos are flat).
 */
export function sanitizeImportFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.includes('/') ||
    normalized === '.' ||
    normalized === '..' ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`Invalid file name in import manifest: "${filename}"`)
  }
  return normalized
}
