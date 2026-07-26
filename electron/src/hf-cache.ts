// Hugging Face hub cache helpers — Node port of src-tauri/src/core/hf_cache.rs.
// Used by the mlx_* command bridge (commands/mlx.ts) so the bundled llamacpp
// extension can import/register AX Engine (MLX) models straight from the local
// HF cache, same as the Tauri build.
import fs from 'node:fs'
import path from 'node:path'
import { huggingFaceCacheRoot } from './downloads/core.js'

export const AX_NATIVE_MODEL_MANIFEST_FILE = 'model-manifest.json'

export interface CachedModelEntry {
  model_id: string
  model_dir: string
  has_manifest: boolean
  size_bytes: number
}

/** hf_cache::cache_root (same env precedence as the Rust side). */
export function cacheRoot(): string | null {
  return huggingFaceCacheRoot()
}

/** hf_cache::validate_model_id — throws with the Rust error message. */
export function validateModelId(modelId: string): void {
  const validChar = (c: string) => /[A-Za-z0-9/._-]/.test(c)
  if (
    modelId.length === 0 ||
    modelId.includes('..') ||
    !modelId.includes('/') ||
    ![...modelId].every(validChar) ||
    modelId.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`invalid Hugging Face model id '${modelId}'`)
  }
}

/** hf_cache::validate_revision — throws with the Rust error message. */
export function validateRevision(revision: string): void {
  if (
    revision.length === 0 ||
    revision.includes('..') ||
    ![...revision].every((c) => /[A-Za-z0-9._-]/.test(c))
  ) {
    throw new Error(`invalid Hugging Face revision '${revision}'`)
  }
}

/** hf_cache::repo_cache_dir — `<root>/models--<org>--<name>`. */
export function repoCacheDir(modelId: string): string {
  validateModelId(modelId)
  const root = cacheRoot()
  if (root === null) {
    throw new Error('HOME is not set; cannot resolve Hugging Face cache')
  }
  return path.join(root, `models--${modelId.replaceAll('/', '--')}`)
}

/** hf_cache::snapshot_dir — pure path construction; the dir need not exist. */
export function snapshotDir(modelId: string, revision: string): string {
  validateRevision(revision)
  return path.join(repoCacheDir(modelId), 'snapshots', revision)
}

/** Reverse of hub dir naming: `models--org--name` → `org/name`. */
export function modelIdFromRepoDirName(dirName: string): string | null {
  if (!dirName.startsWith('models--')) return null
  const rest = dirName.slice('models--'.length)
  if (rest === '') return null
  const modelId = rest.replaceAll('--', '/')
  try {
    validateModelId(modelId)
  } catch {
    return null
  }
  return modelId
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

/** commands.rs::is_ax_native_model_dir */
export function isAxNativeModelDir(target: string): boolean {
  return isDirectory(target) && isFile(path.join(target, AX_NATIVE_MODEL_MANIFEST_FILE))
}

/** hf_cache::dir_contains_safetensors — direct children only (scan speed). */
function dirHasSafetensorsChild(target: string): boolean {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(target, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some(
    (entry) => !entry.isDirectory() && entry.name.toLowerCase().endsWith('.safetensors')
  )
}

/** commands.rs::dir_contains_safetensors — recursive (manifest generation). */
export function dirContainsSafetensors(target: string): boolean {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(target, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some((entry) => {
    const entryPath = path.join(target, entry.name)
    if (entry.isDirectory()) return dirContainsSafetensors(entryPath)
    return entry.name.toLowerCase().endsWith('.safetensors')
  })
}

/** hf_cache::estimate_safetensors_size — sum of direct-child .safetensors sizes. */
function estimateSafetensorsSize(target: string): number {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(target, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith('.safetensors')) continue
    try {
      total += fs.statSync(path.join(target, entry.name)).size
    } catch {
      // skip unreadable entries
    }
  }
  return total
}

interface BestCandidate {
  hasManifest: boolean
  mtimeMs: number
  path: string
  sizeBytes: number
}

function considerModelCandidate(candidate: string, best: { current: BestCandidate | null }): void {
  const hasManifest = isFile(path.join(candidate, AX_NATIVE_MODEL_MANIFEST_FILE))
  const hasWeights = dirHasSafetensorsChild(candidate)
  if (!hasManifest && !hasWeights) return

  let mtimeMs = 0
  try {
    mtimeMs = fs.statSync(candidate).mtimeMs
  } catch {
    // UNIX_EPOCH fallback, same as Rust
  }
  const sizeBytes = estimateSafetensorsSize(candidate)

  const current = best.current
  const replace =
    current === null ||
    (hasManifest && !current.hasManifest) ||
    (hasManifest === current.hasManifest && mtimeMs > current.mtimeMs)
  if (replace) best.current = { hasManifest, mtimeMs, path: candidate, sizeBytes }
}

/** hf_cache::find_best_model_dir — best snapshot (or one nested level) of a repo dir. */
function findBestModelDir(repoDir: string): BestCandidate | null {
  const snapshots = path.join(repoDir, 'snapshots')
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(snapshots, { withFileTypes: true })
  } catch {
    return null
  }

  const best: { current: BestCandidate | null } = { current: null }
  for (const entry of entries) {
    const snapshot = path.join(snapshots, entry.name)
    if (!isDirectory(snapshot)) continue
    considerModelCandidate(snapshot, best)

    // Nested layouts (e.g. snapshots/<rev>/assistant/)
    try {
      for (const child of fs.readdirSync(snapshot, { withFileTypes: true })) {
        const childPath = path.join(snapshot, child.name)
        if (isDirectory(childPath)) considerModelCandidate(childPath, best)
      }
    } catch {
      // unreadable snapshot dir — skip
    }
  }
  return best.current
}

/** hf_cache::resolve_best_model_dir */
export function resolveBestModelDir(modelId: string): string | null {
  let repoDir: string
  try {
    repoDir = repoCacheDir(modelId)
  } catch {
    return null
  }
  return findBestModelDir(repoDir)?.path ?? null
}

/**
 * hf_cache::list_cached_models — scan the cache root for `models--*` repos and
 * pick the best dir per repo. Empty cache → `[]`, never throws.
 */
export function listCachedModels(): CachedModelEntry[] {
  const root = cacheRoot()
  if (root === null) return []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }

  const models: CachedModelEntry[] = []
  for (const entry of entries) {
    const repoPath = path.join(root, entry.name)
    if (!isDirectory(repoPath)) continue
    const modelId = modelIdFromRepoDirName(entry.name)
    if (modelId === null) continue
    const best = findBestModelDir(repoPath)
    if (best === null) continue
    models.push({
      model_id: modelId,
      model_dir: best.path,
      has_manifest: best.hasManifest,
      size_bytes: best.sizeBytes,
    })
  }

  models.sort((a, b) => (a.model_id < b.model_id ? -1 : a.model_id > b.model_id ? 1 : 0))
  return models
}

/** hf_cache::normalize_existing_or_parent — canonicalize, else canonical parent + file name. */
export function normalizeExistingOrParent(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(target)), path.basename(target))
    } catch {
      return path.resolve(target)
    }
  }
}

/** hf_cache::is_within_root */
export function isWithinRoot(target: string, root: string): boolean {
  const normalizedRoot = normalizeExistingOrParent(root)
  const normalizedPath = normalizeExistingOrParent(target)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + path.sep)
}

/** hf_cache::is_within_cache */
export function isWithinCache(target: string): boolean {
  const root = cacheRoot()
  return root !== null && isWithinRoot(target, root)
}
