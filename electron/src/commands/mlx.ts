// mlx_* helper command handlers — Node port of the fs/path-only commands in
// src-tauri/src/core/mlx/commands.rs. The in-process MLX runtime commands
// (mlx_load_model / mlx_chat_stream / …) stay unimplemented: under Electron AX
// Engine inference runs as the `ax-engine serve` sidecar. What the bundled
// llamacpp extension needs is the HF-cache import surface:
//   mlx_hf_snapshot_dir        — where a HF repo/revision download lands
//   mlx_resolve_model_dir      — resolve a model id to a loadable snapshot dir
//   mlx_list_hf_cache_models   — discover cached models for auto-registration
//   mlx_has_model_manifest     — AX-native artifact probe
//   mlx_cleanup_import_artifacts — best-effort cleanup confined to the HF cache
//   mlx_generate_model_manifest  — via the installed `ax-engine-bench` CLI
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { str } from './args.js'
import type { CommandHandler } from './registry.js'
import { getAppDataFolderPath } from '../state.js'
import { resolveAxEngineBinary } from '../ax-engine/dependency.js'
import {
  AX_NATIVE_MODEL_MANIFEST_FILE,
  dirContainsSafetensors,
  isAxNativeModelDir,
  isWithinCache,
  isWithinRoot,
  listCachedModels,
  normalizeExistingOrParent,
  resolveBestModelDir,
  snapshotDir,
  validateModelId,
} from '../hf-cache.js'

const execFileAsync = promisify(execFile)

type Args = Record<string, unknown>

const MANIFEST_GENERATION_TIMEOUT_MS = 120_000

function requiredStr(args: Args | undefined, ...names: string[]): string {
  for (const name of names) {
    const value = str(args?.[name])
    if (value) return value
  }
  throw new Error(`Invalid argument: missing ${names.join('/')}`)
}

/** commands.rs::resolve_downloaded_or_cached_model_dir */
function resolveDownloadedOrCachedModelDir(modelId: string): string | null {
  // Prefer an AX-native HF snapshot (has model-manifest.json).
  const hfBest = resolveBestModelDir(modelId)
  if (hfBest !== null && isAxNativeModelDir(hfBest)) return hfBest

  // App-data import path next: <data>/llamacpp/models/<org>/<name>.
  if (
    modelId.length > 0 &&
    !modelId.includes('..') &&
    !modelId.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    const appDataDir = path.join(getAppDataFolderPath(), 'llamacpp', 'models', ...modelId.split('/'))
    if (isAxNativeModelDir(appDataDir)) return appDataDir
  }

  // Last resort: HF snapshot with weights only (caller may generate manifest).
  if (hfBest !== null && dirContainsSafetensors(hfBest)) return hfBest
  return null
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Locate the `ax-engine-bench` CLI (ships with ax-engine ≥ 6.x via Homebrew /
 * the release tarball): `AX_ENGINE_BENCH_BIN` env → sibling of the resolved
 * `ax-engine` binary → PATH. A configured env that is not executable is a hard
 * miss (same convention as AX_ENGINE_BIN).
 */
export function resolveAxEngineBenchBinary(): string | null {
  const envBin = process.env.AX_ENGINE_BENCH_BIN
  if (envBin) return isExecutable(envBin) ? envBin : null
  const axEngine = resolveAxEngineBinary()
  if (axEngine) {
    const sibling = path.join(path.dirname(axEngine.path), 'ax-engine-bench')
    if (isExecutable(sibling)) return sibling
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, 'ax-engine-bench')
    if (isExecutable(candidate)) return candidate
  }
  return null
}

/**
 * Light stand-in for Rust's NativeModelArtifacts::from_dir validation: the
 * manifest must parse as a JSON object. The full schema validation runs inside
 * `ax-engine-bench generate-manifest` / `ax-engine serve` when the artifact is
 * actually consumed.
 */
function validateExistingManifest(modelDir: string): void {
  const manifestPath = path.join(modelDir, AX_NATIVE_MODEL_MANIFEST_FILE)
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `existing AX manifest is invalid: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('existing AX manifest is invalid: not a JSON object')
  }
}

async function generateModelManifest(modelDir: string): Promise<void> {
  // Confinement (the Rust command has none, but the Electron bridge confines
  // writes to the app data folder / HF cache like the rest of the FS surface).
  const normalized = normalizeExistingOrParent(modelDir)
  if (!isWithinCache(normalized) && !isWithinRoot(normalized, getAppDataFolderPath())) {
    throw new Error(
      `MLX model directory is outside the AX Studio data folder and Hugging Face cache: ${normalized}`
    )
  }

  let isDir = false
  try {
    isDir = fs.statSync(normalized).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) {
    throw new Error(`MLX model directory does not exist: ${modelDir}`)
  }
  if (!dirContainsSafetensors(normalized)) {
    throw new Error(`MLX model directory does not contain safetensors: ${modelDir}`)
  }

  const manifestPath = path.join(normalized, AX_NATIVE_MODEL_MANIFEST_FILE)
  if (fs.existsSync(manifestPath)) {
    validateExistingManifest(normalized)
    return
  }

  const bench = resolveAxEngineBenchBinary()
  if (bench === null) {
    throw new Error(
      'ax-engine-bench binary not found; cannot generate the AX model manifest. ' +
        'Install ax-engine (e.g. `brew install ax-engine`) or set AX_ENGINE_BENCH_BIN.'
    )
  }

  try {
    await execFileAsync(bench, ['generate-manifest', normalized], {
      timeout: MANIFEST_GENERATION_TIMEOUT_MS,
      env: { ...process.env },
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch (error) {
    const err = error as { stderr?: unknown; message?: unknown }
    const detail =
      typeof err.stderr === 'string' && err.stderr.trim() !== ''
        ? err.stderr.trim()
        : String(err.message ?? error)
    throw new Error(`failed to generate AX manifest: ${detail}`)
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      'generated AX manifest is invalid: model-manifest.json was not produced'
    )
  }
  validateExistingManifest(normalized)
}

export function createMlxHandlers(): Record<string, CommandHandler> {
  return {
    // Pure path construction (the snapshot dir need not exist yet) — the
    // extension joins save paths under it before downloading.
    mlx_hf_snapshot_dir: (args) =>
      snapshotDir(
        requiredStr(args, 'modelId', 'model_id'),
        requiredStr(args, 'revision')
      ),

    mlx_resolve_model_dir: (args) => {
      const modelId = requiredStr(args, 'modelId', 'model_id')
      validateModelId(modelId)
      const resolved = resolveDownloadedOrCachedModelDir(modelId)
      if (resolved === null) {
        throw new Error(
          `could not resolve AX Studio download or HF cache snapshot for '${modelId}'`
        )
      }
      return resolved
    },

    mlx_list_hf_cache_models: () => listCachedModels(),

    mlx_has_model_manifest: (args) => {
      const modelDir = requiredStr(args, 'modelDir', 'model_dir')
      const normalized = normalizeExistingOrParent(modelDir)
      if (!isWithinCache(normalized)) {
        throw new Error(
          `MLX model directory is outside Hugging Face cache: ${normalized}`
        )
      }
      return isAxNativeModelDir(normalized)
    },

    // Best-effort; confined to the HF cache so a failed import cannot delete
    // arbitrary files. Per-path errors are swallowed (Rust parity).
    mlx_cleanup_import_artifacts: (args) => {
      const raw = args?.paths
      const paths = Array.isArray(raw) ? raw : []
      for (const entry of paths) {
        if (typeof entry !== 'string' || entry.trim() === '') continue
        const normalized = normalizeExistingOrParent(entry)
        if (!isWithinCache(normalized)) {
          console.warn(
            `Skipping MLX import cleanup outside Hugging Face cache: ${normalized}`
          )
          continue
        }
        try {
          fs.rmSync(normalized, { recursive: true, force: true })
        } catch {
          // best-effort
        }
      }
      return null
    },

    mlx_generate_model_manifest: (args) =>
      generateModelManifest(requiredStr(args, 'modelDir', 'model_dir')),
  }
}
