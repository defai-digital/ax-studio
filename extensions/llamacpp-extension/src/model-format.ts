/**
 * Model artifact format detection.
 *
 *  - `.gguf` files           → llama-server
 *  - MLX model directories   → ax-engine-server (`config.json` + `*.safetensors`)
 *  - AX Engine artifact dirs → ax-engine-server (`model-manifest.json`)
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
