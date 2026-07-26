// Error types mirroring src-tauri/plugins/tauri-plugin-llamacpp/src/error.rs.
// The `code` values match the Rust SCREAMING_SNAKE_CASE serialization; the IPC
// registry forwards them to the renderer as structured { code, cmd, message }.

export type LlamacppErrorCode =
  | 'BINARY_NOT_FOUND'
  | 'MODEL_FILE_NOT_FOUND'
  | 'LIBRARY_PATH_INVALID'
  | 'MODEL_LOAD_FAILED'
  | 'DRAFT_MODEL_LOAD_FAILED'
  | 'MULTIMODAL_PROJECTOR_LOAD_FAILED'
  | 'MODEL_ARCH_NOT_SUPPORTED'
  | 'MODEL_LOAD_TIMED_OUT'
  | 'LLAMA_CPP_PROCESS_ERROR'
  | 'OUT_OF_MEMORY'
  | 'INVALID_ARGUMENT'
  | 'DEVICE_LIST_PARSE_FAILED'
  | 'IO_ERROR'
  | 'INTERNAL_ERROR'

export class LlamacppError extends Error {
  constructor(
    readonly code: LlamacppErrorCode,
    message: string,
    readonly details?: string,
  ) {
    super(message)
    this.name = 'LlamacppError'
  }

  /** Port of `LlamacppError::from_stderr` — classify a failed server startup. */
  static fromStderr(stderr: string): LlamacppError {
    const lower = stderr.toLowerCase()
    const isOutOfMemory =
      lower.includes('out of memory') ||
      lower.includes('failed to allocate') ||
      lower.includes('insufficient memory') ||
      lower.includes('erroroutofdevicememory') || // vulkan specific
      lower.includes('kiogpucommandbuffercallbackerroroutofmemory') || // Metal
      lower.includes('cuda_error_out_of_memory') // CUDA

    if (isOutOfMemory) {
      return new LlamacppError(
        'OUT_OF_MEMORY',
        'Out of memory. The model requires more RAM or VRAM than available.',
        stderr,
      )
    }
    if (lower.includes('error loading model architecture')) {
      return new LlamacppError(
        'MODEL_ARCH_NOT_SUPPORTED',
        "The model's architecture is not supported by this version of the backend.",
        stderr,
      )
    }
    return new LlamacppError(
      'LLAMA_CPP_PROCESS_ERROR',
      'The model process encountered an unexpected error.',
      stderr,
    )
  }
}

/** ax-serving is discontinued; parity with the registry's loud-unimplemented contract. */
export function unimplementedCommand(cmd: string): Error & { code: string } {
  const error = new Error(`Command '${cmd}' is not implemented in the Electron bridge yet`) as Error & {
    code: string
  }
  error.code = 'unimplemented_command'
  return error
}
