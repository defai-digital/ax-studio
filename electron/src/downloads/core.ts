// Download pipeline: destination resolution, parallel transfers with resume,
// progress events, validation, and transactional commit.
// Node port of src-tauri/src/core/downloads/helpers.rs.
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { emitToAllWindows } from '../events.js'
import { getAppDataFolderPath } from '../state.js'
import { getFileSize, openDownloadStream } from './http.js'
import type { DownloadCancelToken } from './manager.js'
import {
  convertHeaders,
  errToString,
  redactUrlForLog,
  validateDownloadRequest,
  type DownloadItem,
} from './policy.js'

const MAX_CONCURRENT_DOWNLOAD_FILES = 8
const PROGRESS_EMIT_INTERVAL_BYTES = 1024 * 1024
const HASH_CHUNK_BYTES = 64 * 1024

// ─── Destination identity (helpers.rs + hf_cache.rs) ─────────────────────────

/** Default macOS and Windows filesystems are case-insensitive. */
function downloadDestinationKey(target: string): string {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? target.toLowerCase()
    : target
}

/** Mirrors Rust's with_appended_extension (`file` → `file.tmp`, `a.gguf` → `a.gguf.tmp`). */
function withAppendedExtension(target: string, suffix: string): string {
  const extension = path.extname(target)
  if (extension === '') return `${target}.${suffix}`
  if (extension === '.') return `${target.slice(0, -1)}.${suffix}`
  return `${target}.${suffix}`
}

function resumeUrlFingerprint(url: string): string {
  return `sha256:${createHash('sha256').update(url, 'utf8').digest('hex')}`
}

/** Every filesystem identity owned by a download destination. */
export function downloadDestinationKeys(target: string): string[] {
  return [
    downloadDestinationKey(target),
    downloadDestinationKey(withAppendedExtension(target, 'tmp')),
    downloadDestinationKey(withAppendedExtension(target, 'url')),
  ]
}

function ensureUniqueDownloadPaths(paths: string[]): void {
  const seen = new Set<string>()
  for (const target of paths) {
    for (const identity of downloadDestinationKeys(target)) {
      if (seen.has(identity)) {
        throw new Error(`Download request contains overlapping destination artifacts near: ${target}`)
      }
      seen.add(identity)
    }
  }
}

/** hf_cache::normalize_existing_or_parent — canonicalize, else canonical parent + file name. */
function normalizeExistingOrParent(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    const parent = path.dirname(target)
    try {
      return path.join(fs.realpathSync(parent), path.basename(target))
    } catch {
      return path.resolve(target)
    }
  }
}

function isWithinRoot(target: string, root: string): boolean {
  const normalizedRoot = normalizeExistingOrParent(root)
  const normalizedPath = normalizeExistingOrParent(target)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + path.sep)
}

/** hf_cache::cache_root */
export function huggingFaceCacheRoot(): string | null {
  const nonEmpty = (value: string | undefined): string | null =>
    value !== undefined && value.trim() !== '' ? value : null
  const direct = nonEmpty(process.env.HF_HUB_CACHE) ?? nonEmpty(process.env.HUGGINGFACE_HUB_CACHE)
  if (direct !== null) return direct
  const hfHome = nonEmpty(process.env.HF_HOME)
  if (hfHome !== null) return path.join(hfHome, 'hub')
  const home = nonEmpty(process.env.HOME)
  if (home === null) return null
  return path.join(home, '.cache', 'huggingface', 'hub')
}

function isWithinHfCache(target: string): boolean {
  const root = huggingFaceCacheRoot()
  return root !== null && isWithinRoot(target, root)
}

/** helpers::resolve_download_save_path — save-path root enforcement. */
export function resolveDownloadSavePath(savePath: string): string {
  const dataFolderRaw = getAppDataFolderPath()
  let dataFolder: string
  try {
    dataFolder = fs.realpathSync(dataFolderRaw)
  } catch {
    dataFolder = path.resolve(dataFolderRaw)
  }

  if (path.isAbsolute(savePath)) {
    const normalized = normalizeExistingOrParent(savePath)
    if (isWithinRoot(normalized, dataFolder) || isWithinHfCache(normalized)) {
      return normalized
    }
    throw new Error(
      `Path ${normalized} is outside allowed download roots: AX Studio data folder ${dataFolder} or Hugging Face cache ${huggingFaceCacheRoot() ?? '<unavailable>'}`
    )
  }

  const normalized = normalizeExistingOrParent(path.join(dataFolder, savePath))
  if (!(normalized === dataFolder || normalized.startsWith(dataFolder + path.sep))) {
    throw new Error(`Path ${normalized} is outside of AX Studio data folder ${dataFolder}`)
  }
  return normalized
}

export function resolveDownloadDestinations(items: DownloadItem[]): string[] {
  const paths = items.map((item) => resolveDownloadSavePath(item.save_path))
  ensureUniqueDownloadPaths(paths)
  return paths
}

// ─── Progress tracking (models.rs ProgressTracker) ───────────────────────────

class ProgressTracker {
  private fileStats = new Map<string, { transferred: number; total: number }>()

  constructor(initialSizes: Map<string, number>) {
    for (const [id, size] of initialSizes) {
      this.fileStats.set(id, { transferred: 0, total: size })
    }
  }

  updateProgress(fileId: string, transferred: number): void {
    const entry = this.fileStats.get(fileId)
    if (entry) entry.transferred = transferred
  }

  setFileTotal(fileId: string, total: number): void {
    const entry = this.fileStats.get(fileId)
    if (entry) entry.total = total
  }

  getTotalProgress(): [number, number] {
    let transferred = 0
    let total = 0
    for (const entry of this.fileStats.values()) {
      transferred += entry.transferred
      total += entry.total
    }
    return [transferred, total]
  }
}

/** DownloadEvent serialization mirrors serde: downloadId/modelId skipped when absent. */
function downloadEvent(
  transferred: number,
  total: number,
  taskId: string,
  modelId: string | undefined
): Record<string, unknown> {
  const event: Record<string, unknown> = { transferred, total, downloadId: taskId }
  if (modelId !== undefined) event.modelId = modelId
  return event
}

// ─── Validation (helpers::validate_downloaded_file) ─────────────────────────

async function computeFileSha256WithCancellation(
  filePath: string,
  token: DownloadCancelToken
): Promise<string> {
  if (token.cancelled) throw new Error('Hash computation cancelled')
  let handle: fsp.FileHandle
  try {
    handle = await fsp.open(filePath, 'r')
  } catch (error) {
    throw new Error(
      `Failed to open file for hashing: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  try {
    const hasher = createHash('sha256')
    const buffer = Buffer.alloc(HASH_CHUNK_BYTES)
    for (;;) {
      if (token.cancelled) throw new Error('Hash computation cancelled')
      const { bytesRead } = await handle.read(buffer, 0, HASH_CHUNK_BYTES, null)
      if (bytesRead === 0) break
      hasher.update(buffer.subarray(0, bytesRead))
    }
    return hasher.digest('hex')
  } finally {
    await handle.close()
  }
}

async function validateDownloadedFile(
  item: DownloadItem,
  tmpPath: string,
  token: DownloadCancelToken,
  emitValidationEvent: boolean
): Promise<void> {
  if (item.sha256 === undefined && item.size === undefined) {
    return
  }

  const modelId = item.model_id ?? path.basename(path.dirname(tmpPath)) ?? 'unknown'

  if (emitValidationEvent) {
    emitToAllWindows('onModelValidationStarted', { modelId, downloadType: 'Model' })
  }

  if (item.size !== undefined) {
    let actualSize: number
    try {
      actualSize = (await fsp.stat(tmpPath)).size
    } catch (error) {
      throw new Error(
        `Failed to verify file size: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (actualSize !== item.size) {
      throw new Error(
        `Size verification failed. Expected ${item.size} bytes but got ${actualSize} bytes.`
      )
    }
  }

  if (token.cancelled) {
    throw new Error('Validation cancelled')
  }

  if (item.sha256 !== undefined) {
    let computed: string
    try {
      computed = await computeFileSha256WithCancellation(tmpPath, token)
    } catch (error) {
      throw new Error(
        `Failed to verify file integrity: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (computed.toLowerCase() !== item.sha256.toLowerCase()) {
      throw new Error(
        'Hash verification failed. The downloaded file is corrupted or has been tampered with.'
      )
    }
  }
}

// ─── Partial artifacts and commit (helpers.rs) ───────────────────────────────

async function cleanupPartialDownload(
  tmpPath: string,
  urlPath: string,
  preserveResume: boolean
): Promise<void> {
  if (preserveResume) {
    // A resumable partial requires both files; keeping only the .tmp while
    // deleting the URL sidecar would silently disable resume.
    return
  }
  await fsp.rm(tmpPath, { force: true }).catch(() => {})
  await fsp.rm(urlPath, { force: true }).catch(() => {})
}

async function commitDownloadFile(tmpPath: string, finalPath: string): Promise<void> {
  try {
    // POSIX rename atomically replaces an existing destination.
    await fsp.rename(tmpPath, finalPath)
  } catch (error) {
    if (process.platform === 'win32') {
      // Node/libuv rename cannot replace an existing file on Windows; the
      // Rust side uses ReplaceFileW. rm+rename is not atomic — documented
      // deviation; the old destination is lost if rename fails after rm.
      try {
        await fsp.rm(finalPath, { force: true })
        await fsp.rename(tmpPath, finalPath)
        return
      } catch (retryError) {
        throw new Error(errToString(retryError))
      }
    }
    throw new Error(errToString(error))
  }
}

interface PreparedDownload {
  tmpPath: string
  urlPath: string
  finalPath: string
  displayUrl: string
}

// ─── Single-file transfer (helpers::download_single_file) ───────────────────

interface DownloadCtx {
  headerEntries: [string, string][]
  resume: boolean
  token: DownloadCancelToken
  evtName: string
  tracker: ProgressTracker
  taskId: string
  modelId: string | undefined
  emitValidationEvent: boolean
}

async function readUrlSidecar(urlPath: string): Promise<string | null> {
  try {
    return await fsp.readFile(urlPath, 'utf8')
  } catch {
    return null
  }
}

interface TrackedWriter {
  stream: fs.WriteStream
  failed: Error | null
  closed: Promise<unknown>
}

function createTrackedWriter(target: string, flags: 'a' | 'w'): TrackedWriter {
  const stream = fs.createWriteStream(target, { flags })
  const tracked: TrackedWriter = { stream, failed: null, closed: once(stream, 'close') }
  // Prevent unhandled 'error' events/rejections; failures surface via writeChunk.
  tracked.closed.catch(() => {})
  stream.on('error', (error) => {
    tracked.failed = error
  })
  return tracked
}

async function writeChunk(writer: TrackedWriter, chunk: Buffer): Promise<void> {
  if (writer.failed !== null) throw writer.failed
  if (!writer.stream.write(chunk)) {
    await Promise.race([once(writer.stream, 'drain'), writer.closed])
    if (writer.failed !== null) throw writer.failed
  }
}

async function closeWriter(writer: TrackedWriter): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    writer.stream.end((error: Error | null | undefined) => (error ? reject(error) : resolve()))
  })
}

/** Errors thrown after cleanup has already run; rethrown as-is by the stream loop. */
class DownloadFailure extends Error {}

async function downloadSingleFile(
  item: DownloadItem,
  savePath: string,
  fileId: string,
  ctx: DownloadCtx
): Promise<PreparedDownload> {
  const { headerEntries, resume, token, evtName, tracker, taskId, modelId, emitValidationEvent } =
    ctx
  if (token.cancelled) {
    throw new Error('Download cancelled')
  }
  try {
    await fsp.mkdir(path.dirname(savePath), { recursive: true })
  } catch (error) {
    throw new Error(errToString(error))
  }

  const tmpPath = withAppendedExtension(savePath, 'tmp')
  const urlPath = withAppendedExtension(savePath, 'url')
  const urlFingerprint = resumeUrlFingerprint(item.url)

  let shouldResume =
    resume &&
    fs.existsSync(tmpPath) &&
    (await readUrlSidecar(urlPath).then(
      (stored) => stored !== null && (stored === urlFingerprint || stored === item.url)
    ))

  if (item.proxy?.ignore_ssl === true && item.sha256 === undefined) {
    // _get_client_for_item parity (validate_download_item already rejects
    // this combination; kept as the transport-side guard).
    throw new Error(
      errToString(
        `SSL certificate verification disabled for download from ${redactUrlForLog(item.url)}. ` +
          'SHA256 hash validation is required for security but not provided. ' +
          'Downloads without hash verification can be tampered with.'
      )
    )
  }

  try {
    await fsp.writeFile(urlPath, urlFingerprint, 'utf8')
  } catch (error) {
    throw new Error(errToString(error))
  }

  let downloadDelta = 0
  let initialProgress = 0
  const hadResumeState = shouldResume

  let response
  try {
    if (shouldResume) {
      let downloadedSize: number
      try {
        downloadedSize = (await fsp.stat(tmpPath)).size
      } catch (error) {
        throw new Error(errToString(error))
      }
      try {
        response = await openDownloadStream(item, downloadedSize, headerEntries, token)
        initialProgress = downloadedSize
      } catch (error) {
        if (error instanceof Error && error.message === 'Download cancelled') throw error
        // Resume failed; restart from byte zero.
        shouldResume = false
        response = await openDownloadStream(item, 0, headerEntries, token)
      }
    } else {
      response = await openDownloadStream(item, 0, headerEntries, token)
    }
  } catch (error) {
    await cleanupPartialDownload(tmpPath, urlPath, hadResumeState)
    throw error
  }

  // Refine the expected size from the GET/206 Content-Length; the HEAD-based
  // estimate can be 0 when the CDN omits it on HEAD requests.
  if (response.contentLength !== null && response.contentLength > 0) {
    tracker.setFileTotal(fileId, initialProgress + response.contentLength)
  }

  // Initial progress event now that the total is accurate.
  tracker.updateProgress(fileId, initialProgress)
  {
    const [transferred, total] = tracker.getTotalProgress()
    emitToAllWindows(evtName, downloadEvent(transferred, total, taskId, modelId))
  }

  const writer = createTrackedWriter(tmpPath, shouldResume ? 'a' : 'w')
  let totalTransferred = initialProgress

  const destroyOnCancel = token.onCancel(() => response.stream.destroy())
  try {
    for await (const chunk of response.stream as AsyncIterable<Buffer>) {
      if (token.cancelled) {
        writer.stream.destroy()
        await cleanupPartialDownload(tmpPath, urlPath, shouldResume)
        throw new DownloadFailure('Download cancelled')
      }
      try {
        await writeChunk(writer, chunk)
      } catch (error) {
        writer.stream.destroy()
        await cleanupPartialDownload(tmpPath, urlPath, true)
        throw new DownloadFailure(errToString(error))
      }

      downloadDelta += chunk.length
      totalTransferred += chunk.length

      if (item.size !== undefined && totalTransferred > item.size) {
        writer.stream.destroy()
        await cleanupPartialDownload(tmpPath, urlPath, false)
        throw new DownloadFailure('Downloaded data exceeds the expected file size')
      }

      // Update progress every 1 MB for responsive UI.
      if (downloadDelta >= PROGRESS_EMIT_INTERVAL_BYTES) {
        tracker.updateProgress(fileId, totalTransferred)
        const [transferred, total] = tracker.getTotalProgress()
        emitToAllWindows(evtName, downloadEvent(transferred, total, taskId, modelId))
        downloadDelta = 0
      }
    }
  } catch (error) {
    if (error instanceof DownloadFailure) throw error
    // Raw response-stream error (including the cancel-induced destroy).
    writer.stream.destroy()
    if (token.cancelled) {
      await cleanupPartialDownload(tmpPath, urlPath, shouldResume)
      throw new Error('Download cancelled')
    }
    await cleanupPartialDownload(tmpPath, urlPath, true)
    throw new Error(errToString(error))
  } finally {
    destroyOnCancel()
  }

  try {
    await closeWriter(writer)
  } catch (error) {
    await cleanupPartialDownload(tmpPath, urlPath, true)
    throw new Error(errToString(error))
  }

  if (token.cancelled) {
    await cleanupPartialDownload(tmpPath, urlPath, false)
    throw new Error('Download cancelled')
  }

  // Validate the temporary file before touching an existing verified final
  // destination: a bad hash/size can no longer delete the user's old model.
  try {
    await validateDownloadedFile(item, tmpPath, token, emitValidationEvent)
  } catch (error) {
    await cleanupPartialDownload(tmpPath, urlPath, false)
    throw error
  }

  if (token.cancelled) {
    await cleanupPartialDownload(tmpPath, urlPath, false)
    throw new Error('Download cancelled')
  }

  tracker.updateProgress(fileId, totalTransferred)
  {
    const [transferred, total] = tracker.getTotalProgress()
    emitToAllWindows(evtName, downloadEvent(transferred, total, taskId, modelId))
  }

  return {
    tmpPath,
    urlPath,
    finalPath: savePath,
    displayUrl: redactUrlForLog(item.url),
  }
}

// ─── Batch driver (helpers::_download_files_internal) ───────────────────────

export async function downloadFilesInternal(
  items: DownloadItem[],
  headers: Record<string, string>,
  taskId: string,
  resume: boolean,
  token: DownloadCancelToken
): Promise<void> {
  validateDownloadRequest(items, taskId, headers)
  const resolvedPaths = resolveDownloadDestinations(items)
  const headerEntries = convertHeaders(headers)

  // HEAD sizes concurrently; a failed/slow HEAD must not abort the batch.
  const fileSizes = new Map<string, number>()
  {
    let next = 0
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_DOWNLOAD_FILES, items.length) },
      async () => {
        for (;;) {
          if (token.cancelled) throw new Error('Download cancelled')
          const index = next++
          if (index >= items.length) return
          const item = items[index]
          try {
            const size = await getFileSize(item, headerEntries, token)
            fileSizes.set(item.url, size)
          } catch (error) {
            if (error instanceof Error && error.message === 'Download cancelled') throw error
            // A failed or slow HEAD (common on HuggingFace CDN) must not abort
            // the whole batch; the GET path refines the size later.
            fileSizes.set(item.url, 0)
          }
        }
      }
    )
    await Promise.all(workers)
  }

  const evtName = `download-${taskId}`
  const fileIdSizes = new Map<string, number>()
  items.forEach((item, index) => {
    fileIdSizes.set(`${taskId}-${index}`, fileSizes.get(item.url) ?? 0)
  })
  const tracker = new ProgressTracker(fileIdSizes)

  const downloadModelId =
    items.find((item) => item.model_id !== undefined)?.model_id ??
    (() => {
      const parent = path.dirname(items[0].save_path)
      return parent === '.' || parent === '' ? undefined : path.basename(parent)
    })()
  const validationEventIndex = items.findIndex(
    (item) => item.sha256 !== undefined || item.size !== undefined
  )

  // Parallel transfers; one failed shard cancels siblings via the token.
  type Outcome =
    | { ok: true; value: PreparedDownload }
    | { ok: false; error: unknown }
    | undefined
  const outcomes: Outcome[] = new Array(items.length).fill(undefined)
  {
    let next = 0
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_DOWNLOAD_FILES, items.length) },
      async () => {
        for (;;) {
          if (token.cancelled) return
          const index = next++
          if (index >= items.length) return
          const item = items[index]
          const ctx: DownloadCtx = {
            headerEntries,
            resume,
            token,
            evtName,
            tracker,
            taskId,
            modelId: downloadModelId,
            emitValidationEvent: validationEventIndex === index,
          }
          try {
            outcomes[index] = {
              ok: true,
              value: await downloadSingleFile(item, resolvedPaths[index], `${taskId}-${index}`, ctx),
            }
          } catch (error) {
            outcomes[index] = { ok: false, error }
            // One failed shard makes the batch unusable; stop siblings.
            token.cancel()
          }
        }
      }
    )
    await Promise.all(workers)
  }

  // Prefer the causal transfer/validation failure over sibling cancellation
  // noise regardless of item ordering.
  let firstError: string | null = null
  const preparedDownloads: PreparedDownload[] = []
  for (const outcome of outcomes) {
    if (outcome === undefined) {
      if (firstError === null) firstError = 'Download cancelled'
      continue
    }
    if (outcome.ok) {
      preparedDownloads.push(outcome.value)
      continue
    }
    const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
    if (firstError === null || (firstError === 'Download cancelled' && message !== 'Download cancelled')) {
      firstError = message
    }
  }
  if (firstError !== null) {
    for (const prepared of preparedDownloads) {
      await cleanupPartialDownload(prepared.tmpPath, prepared.urlPath, false)
    }
    throw new Error(firstError)
  }

  if (token.cancelled) {
    for (const prepared of preparedDownloads) {
      await cleanupPartialDownload(prepared.tmpPath, prepared.urlPath, false)
    }
    throw new Error('Download cancelled')
  }

  // No final destination is touched until every shard has downloaded and
  // passed verification. This prevents mixed-version model directories.
  for (let index = 0; index < preparedDownloads.length; index++) {
    const prepared = preparedDownloads[index]
    try {
      await commitDownloadFile(prepared.tmpPath, prepared.finalPath)
    } catch (error) {
      for (const pending of preparedDownloads.slice(index)) {
        await cleanupPartialDownload(pending.tmpPath, pending.urlPath, false)
      }
      throw error
    }
    try {
      await fsp.rm(prepared.urlPath, { force: true })
    } catch (error) {
      console.warn('[downloads] failed to remove .url sidecar after download:', error)
    }
    console.log(`[downloads] Finished downloading: ${prepared.displayUrl}`)
  }

  const [transferred, total] = tracker.getTotalProgress()
  emitToAllWindows(evtName, downloadEvent(transferred, total, taskId, downloadModelId))
}
