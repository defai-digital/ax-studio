// ax-engine sidecar lifecycle manager (macOS). Node port of AX Code's
// packages/ax-code/src/provider/ax-engine/{server,lifecycle}.ts:
//
//  - spawn `ax-engine serve <model> --port <p> -- <posture flags>`, detached,
//    stdout/stderr appended to <data>/ax-engine/server.log
//  - server.json (pid/port/baseURL/model/posture) written BEFORE the readiness
//    wait so a later app run can reclaim the orphan instead of double-spawning
//  - readiness = poll GET /v1/models with Bearer every 500 ms, 2 s per probe,
//    up to 240 s (cold MLX loads are slow)
//  - model swap WITHOUT respawn via POST /v1/model/load|unload; full relaunch
//    only when the launch posture changed
//  - stop = SIGTERM → 5 s grace → SIGKILL, and only after `ps` confirms the
//    pid's command line really is an ax-engine serve process (pid recycling)
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import { isDangerousProcessEnvKey } from '../llamacpp/path.js'
import { checkAxEngineDependency } from './dependency.js'
import { acquireAxEngineLock, isPidAlive } from './lock.js'
import { axEngineDir, serverLogPath, serverRecordPath } from './paths.js'
import { checkAxEnginePlatform } from './platform.js'
import {
  AX_ENGINE_BACKEND_KIND,
  DEFAULT_POSTURE,
  canonicalPosture,
  type AxEnginePhase,
  type AxEnginePosture,
  type AxEngineServerRecord,
  type AxEngineStatus,
  type AxEngineStopResult,
} from './types.js'

const execFileAsync = promisify(execFile)

export const AX_ENGINE_PORT_BASE = 31418
export const AX_ENGINE_PORT_SCAN = 20
const READINESS_INTERVAL_MS = 500
const READINESS_PROBE_TIMEOUT_MS = 2_000
const READINESS_TOTAL_TIMEOUT_MS = 240_000
const STOP_GRACE_MS = 5_000
const LOG_TAIL_BYTES = 8 * 1024
const LOG_TAIL_LINES = 40
const DEFAULT_API_KEY = 'local'

export interface EnsureAxEngineOptions {
  modelPath: string
  modelId?: string
  posture?: Partial<Omit<AxEnginePosture, 'modelId'>>
  /** Config-level binary override (highest resolution priority). */
  binaryPath?: string
  apiKey?: string
  envs?: Record<string, string>
  readinessTimeoutMs?: number
}

/** Non-null while an ensure is mid-flight; drives the `starting` phase. */
let inflight: Promise<AxEngineStatus> | null = null

// ─── server.json ────────────────────────────────────────────────────────────

export function readServerRecord(): AxEngineServerRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(serverRecordPath(), 'utf8')) as AxEngineServerRecord
    if (typeof parsed?.pid !== 'number' || typeof parsed?.port !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeServerRecord(record: AxEngineServerRecord): void {
  const file = serverRecordPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, JSON.stringify(record, null, 2))
  fs.renameSync(temp, file)
}

function removeServerRecord(): void {
  try {
    fs.unlinkSync(serverRecordPath())
  } catch {
    /* already gone */
  }
}

// ─── process inspection (pid-recycling protection) ──────────────────────────

async function processCommandLine(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='], {
      timeout: 5_000,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * True only when the cmdline genuinely looks like `ax-engine serve …` or an
 * `ax-engine-server` process. Guards against signaling a recycled pid.
 */
export function looksLikeAxEngineServer(cmdline: string | null): boolean {
  if (!cmdline) return false
  const tokens = cmdline.split(/\s+/)
  const hasBinary = tokens.some((token) => /(^|\/)ax-engine(-server)?$/.test(token))
  if (!hasBinary) return false
  return /(^|\/)ax-engine-server$/.test(tokens[0] ?? '') || tokens.includes('serve')
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

async function probeModels(
  record: AxEngineServerRecord,
  timeoutMs = READINESS_PROBE_TIMEOUT_MS,
): Promise<{ ok: boolean; models: string[] }> {
  try {
    const response = await fetch(`${record.baseURL}/models`, {
      headers: { Authorization: `Bearer ${record.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      response.body?.cancel()
      return { ok: false, models: [] }
    }
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> }
    const models = Array.isArray(body.data)
      ? body.data.map((m) => m?.id).filter((id): id is string => typeof id === 'string')
      : []
    return { ok: true, models }
  } catch {
    return { ok: false, models: [] }
  }
}

async function postModelAction(
  record: AxEngineServerRecord,
  action: 'load' | 'unload',
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${record.baseURL}/model/${action}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${record.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `ax-engine /v1/model/${action} failed: HTTP ${response.status} ${text.slice(0, 300)}`.trim(),
    )
  }
}

// ─── log tail ───────────────────────────────────────────────────────────────

export function tailServerLog(): string | undefined {
  try {
    const file = serverLogPath()
    const stat = fs.statSync(file)
    const start = Math.max(0, stat.size - LOG_TAIL_BYTES)
    const fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buffer, 0, buffer.length, start)
    fs.closeSync(fd)
    const lines = buffer.toString('utf8').split('\n')
    return lines.slice(-LOG_TAIL_LINES).join('\n').trim() || undefined
  } catch {
    return undefined
  }
}

// ─── port probe ─────────────────────────────────────────────────────────────

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

/** First free loopback port from 31418 up to +20 (AX Code parity). */
export async function probeAxEnginePort(): Promise<number> {
  for (let port = AX_ENGINE_PORT_BASE; port <= AX_ENGINE_PORT_BASE + AX_ENGINE_PORT_SCAN; port += 1) {
    if (await canBind(port)) return port
  }
  throw new Error(
    `No free loopback port for ax-engine in ${AX_ENGINE_PORT_BASE}..${AX_ENGINE_PORT_BASE + AX_ENGINE_PORT_SCAN}`,
  )
}

// ─── posture / args ─────────────────────────────────────────────────────────

export function normalizePosture(
  modelId: string,
  partial?: Partial<Omit<AxEnginePosture, 'modelId'>>,
): AxEnginePosture {
  return { ...DEFAULT_POSTURE, ...(partial ?? {}), modelId }
}

/**
 * `ax-engine serve <model> --port <p> -- <passthrough>`. There is NO
 * --context-length flag: the context window is total-blocks × block-size-tokens.
 */
export function buildServeArgs(modelPath: string, port: number, posture: AxEnginePosture): string[] {
  const totalBlocks = Math.max(1, Math.ceil(posture.contextTokens / posture.blockSizeTokens))
  const passthrough = [
    '--model-id', posture.modelId,
    '--speculation-profile', posture.speculationProfile,
    '--max-batch-tokens', String(posture.maxBatchTokens),
  ]
  if (posture.disableNgramAcceleration) passthrough.push('--disable-ngram-acceleration')
  passthrough.push('--max-concurrent-requests', String(posture.maxConcurrentRequests))
  if (posture.mlxMtpDisableNgramStacking) passthrough.push('--mlx-mtp-disable-ngram-stacking')
  passthrough.push('--block-size-tokens', String(posture.blockSizeTokens))
  passthrough.push('--total-blocks', String(totalBlocks))
  return ['serve', modelPath, '--port', String(port), '--', ...passthrough]
}

// ─── adoption / reclaim ─────────────────────────────────────────────────────

interface LiveServer {
  record: AxEngineServerRecord
  models: string[]
}

/**
 * Adopt the server described by server.json when its pid is alive, its cmdline
 * still looks like ax-engine, and it answers /v1/models. Otherwise the record
 * is stale and removed.
 */
async function adoptRecord(record: AxEngineServerRecord | null): Promise<LiveServer | null> {
  if (!record) return null
  if (!isPidAlive(record.pid)) {
    removeServerRecord()
    return null
  }
  const cmdline = await processCommandLine(record.pid)
  if (!looksLikeAxEngineServer(cmdline)) {
    // pid was recycled by an unrelated process — never touch it.
    removeServerRecord()
    return null
  }
  const probe = await probeModels(record)
  if (!probe.ok) {
    // Process alive but not (yet) answering — keep the record; caller decides.
    return { record, models: [] }
  }
  return { record, models: probe.models }
}

// ─── status ─────────────────────────────────────────────────────────────────

function baseStatus(): AxEngineStatus {
  return {
    phase: 'unavailable',
    backend: AX_ENGINE_BACKEND_KIND,
    baseURL: null,
    port: null,
    pid: null,
    models: [],
    binaryPath: null,
    binarySource: null,
    version: null,
    apiKey: null,
    warnings: [],
  }
}

export async function getAxEngineStatus(binaryOverride?: string): Promise<AxEngineStatus> {
  const status = baseStatus()

  const platform = checkAxEnginePlatform()
  status.warnings = platform.warnings
  if (!platform.supported) {
    status.phase = 'unavailable'
    status.detail = platform.detail
    return status
  }

  const dependency = await checkAxEngineDependency(binaryOverride)
  if (!dependency.binary || !dependency.versionOk) {
    status.phase = 'missing_dependency'
    status.detail = dependency.detail
    status.binaryPath = dependency.binary?.path ?? null
    status.binarySource = dependency.binary?.source ?? null
    status.version = dependency.version
    return status
  }
  status.binaryPath = dependency.binary.path
  status.binarySource = dependency.binary.source
  status.version = dependency.version

  if (inflight) {
    status.phase = 'starting'
    status.detail = 'ax-engine server is starting'
    return status
  }

  const record = readServerRecord()
  if (!record) {
    status.phase = 'missing_model'
    status.detail = 'No ax-engine server is running; no model is loaded.'
    return status
  }
  status.baseURL = record.baseURL
  status.port = record.port
  status.pid = record.pid
  status.apiKey = record.apiKey

  const live = await adoptRecord(record)
  if (!live) {
    status.phase = 'missing_model'
    status.baseURL = null
    status.port = null
    status.pid = null
    status.apiKey = null
    status.detail = 'Stale ax-engine server record reclaimed; no model is loaded.'
    return status
  }
  status.models = live.models
  if (live.models.length === 0) {
    const probe = await probeModels(record)
    status.phase = probe.ok ? 'missing_model' : 'degraded'
    status.detail = probe.ok
      ? 'ax-engine server is running with no models loaded.'
      : 'ax-engine process is alive but not answering /v1/models.'
    if (!probe.ok) status.logTail = tailServerLog()
    return status
  }
  status.phase = 'ready'
  return status
}

// ─── readiness ──────────────────────────────────────────────────────────────

async function waitForReadiness(record: AxEngineServerRecord, timeoutMs: number): Promise<string[]> {
  // Contract: server.json is on disk BEFORE the readiness wait begins.
  if (!fs.existsSync(serverRecordPath())) {
    throw new Error('internal error: server.json must be written before the readiness wait')
  }
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!isPidAlive(record.pid)) {
      throw new Error(`ax-engine exited during startup (pid ${record.pid})`)
    }
    const probe = await probeModels(record)
    if (probe.ok) return probe.models
    if (Date.now() >= deadline) {
      throw new Error(`ax-engine did not become ready within ${Math.round(timeoutMs / 1000)}s`)
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_INTERVAL_MS))
  }
}

// ─── spawn / stop ───────────────────────────────────────────────────────────

function filterEnvs(envs: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(envs ?? {})) {
    if (isDangerousProcessEnvKey(key)) continue
    out[key] = value
  }
  return out
}

async function spawnServer(
  binaryPath: string,
  version: string | null,
  modelPath: string,
  posture: AxEnginePosture,
  apiKey: string,
  envs: Record<string, string> | undefined,
  readinessTimeoutMs: number,
): Promise<AxEngineServerRecord> {
  fs.mkdirSync(axEngineDir(), { recursive: true })
  const port = await probeAxEnginePort()
  const args = buildServeArgs(modelPath, port, posture)

  const logFd = fs.openSync(serverLogPath(), 'a')
  let child
  try {
    child = spawn(binaryPath, args, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, AX_ENGINE_API_KEY: apiKey, ...filterEnvs(envs) },
    })
  } finally {
    fs.closeSync(logFd)
  }
  child.unref()
  child.on('error', (error) => {
    console.error(`[ax-engine] spawn error (pid ${child.pid}): ${error.message}`)
  })

  const record: AxEngineServerRecord = {
    pid: child.pid ?? 0,
    port,
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey,
    model: posture.modelId,
    modelPath,
    models: [],
    posture: canonicalPosture(posture),
    binaryPath,
    version,
    startedAt: new Date().toISOString(),
  }
  if (!record.pid) throw new Error('Failed to spawn ax-engine (no pid)')
  // Written BEFORE the readiness wait: a crash/restart can reclaim the orphan.
  writeServerRecord(record)
  record.models = await waitForReadiness(record, readinessTimeoutMs)
  writeServerRecord(record)
  return record
}

async function signalAndWait(pid: number, graceMs: number): Promise<'SIGTERM' | 'SIGKILL'> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return 'SIGTERM'
  }
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return 'SIGTERM'
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
  const killDeadline = Date.now() + 2_000
  while (Date.now() < killDeadline && isPidAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return 'SIGKILL'
}

/** Lock-free inner stop; callers must hold the ax-engine lock. */
async function stopAxEngineLocked(graceMs: number): Promise<AxEngineStopResult> {
  const record = readServerRecord()
  if (!record) return { success: true, stale: true, signal: 'none' }

  if (isPidAlive(record.pid)) {
    const cmdline = await processCommandLine(record.pid)
    if (!looksLikeAxEngineServer(cmdline)) {
      // pid belongs to something else now — drop the record, never signal.
      removeServerRecord()
      return { success: true, stale: true, signal: 'none' }
    }
    const signal = await signalAndWait(record.pid, graceMs)
    removeServerRecord()
    return { success: true, signal }
  }

  removeServerRecord()
  return { success: true, stale: true, signal: 'none' }
}

/**
 * Stop the server described by server.json. The pid is signaled ONLY when
 * `ps` shows a genuine ax-engine serve cmdline (pid-recycling protection).
 */
export async function stopAxEngine(graceMs = STOP_GRACE_MS): Promise<AxEngineStopResult> {
  const release = await acquireAxEngineLock()
  try {
    return await stopAxEngineLocked(graceMs)
  } finally {
    release()
  }
}

/** True when a server.json exists (quit cleanup should attempt a stop). */
export function hasAxEngineServerRecord(): boolean {
  return readServerRecord() !== null
}

/** Best-effort shutdown for app quit; never throws. */
export async function stopAxEngineOnQuit(): Promise<void> {
  if (!readServerRecord()) return
  try {
    await stopAxEngine(2_000)
  } catch (error) {
    console.error('[ax-engine] quit cleanup failed:', error)
  }
}

// ─── ensure / model management ──────────────────────────────────────────────

function readyStatus(record: AxEngineServerRecord, models: string[], warnings: string[]): AxEngineStatus {
  const status = baseStatus()
  status.phase = models.length > 0 ? 'ready' : 'missing_model'
  status.baseURL = record.baseURL
  status.port = record.port
  status.pid = record.pid
  status.models = models
  status.binaryPath = record.binaryPath
  status.binarySource = null
  status.version = record.version
  status.apiKey = record.apiKey
  status.warnings = warnings
  return status
}

export function ensureAxEngine(options: EnsureAxEngineOptions): Promise<AxEngineStatus> {
  // Serialize ensures: a concurrent caller queues behind the in-flight one
  // (its posture/model may differ, so sharing the promise would be wrong).
  if (inflight) {
    return inflight.catch(() => undefined).then(() => ensureAxEngine(options))
  }
  inflight = ensureAxEngineInner(options).finally(() => {
    inflight = null
  })
  return inflight
}

async function ensureAxEngineInner(options: EnsureAxEngineOptions): Promise<AxEngineStatus> {
  const modelPath = options.modelPath
  const modelId = options.modelId ?? modelPath
  const posture = normalizePosture(modelId, options.posture)
  const apiKey = options.apiKey ?? process.env.AX_ENGINE_API_KEY ?? DEFAULT_API_KEY
  const readinessTimeoutMs = options.readinessTimeoutMs ?? READINESS_TOTAL_TIMEOUT_MS

  const platform = checkAxEnginePlatform()
  if (!platform.supported) {
    const status = baseStatus()
    status.phase = 'unavailable'
    status.detail = platform.detail
    return status
  }

  const dependency = await checkAxEngineDependency(options.binaryPath)
  if (!dependency.binary || !dependency.versionOk) {
    const status = baseStatus()
    status.phase = 'missing_dependency'
    status.warnings = platform.warnings
    status.detail = dependency.detail
    status.binaryPath = dependency.binary?.path ?? null
    status.binarySource = dependency.binary?.source ?? null
    status.version = dependency.version
    return status
  }

  const release = await acquireAxEngineLock()
  try {
    // Reuse or reclaim a running server.
    const live = await adoptRecord(readServerRecord())
    if (live && live.record.posture === canonicalPosture(posture) && live.record.apiKey === apiKey) {
      if (live.models.includes(modelId)) {
        return readyStatus(live.record, live.models, platform.warnings)
      }
      // Same launch posture → hot-add the model, NO respawn.
      await postModelAction(live.record, 'load', {
        model_id: modelId,
        model_path: modelPath,
        load_mode: 'add',
        make_default: true,
      })
      const models = Array.from(new Set([...live.models, modelId]))
      const updated: AxEngineServerRecord = { ...live.record, model: modelId, modelPath, models }
      writeServerRecord(updated)
      return readyStatus(updated, models, platform.warnings)
    }

    // Posture changed (or the live server is unhealthy) → full relaunch.
    if (live || readServerRecord()) await stopAxEngineLocked(STOP_GRACE_MS)

    try {
      const record = await spawnServer(
        dependency.binary.path,
        dependency.version,
        modelPath,
        posture,
        apiKey,
        options.envs,
        readinessTimeoutMs,
      )
      return readyStatus(record, record.models, platform.warnings)
    } catch (error) {
      await stopAxEngineLocked(1_000).catch(() => undefined)
      const status = baseStatus()
      status.phase = 'error'
      status.warnings = platform.warnings
      status.binaryPath = dependency.binary.path
      status.binarySource = dependency.binary.source
      status.version = dependency.version
      status.detail = error instanceof Error ? error.message : String(error)
      status.logTail = tailServerLog()
      return status
    }
  } finally {
    release()
  }
}

export async function loadAxEngineModel(
  modelId: string,
  modelPath: string,
  makeDefault = true,
): Promise<AxEngineStatus> {
  const release = await acquireAxEngineLock()
  try {
    const live = await adoptRecord(readServerRecord())
    if (!live) throw new Error('ax-engine server is not running; call ax_engine_ensure first')
    await postModelAction(live.record, 'load', {
      model_id: modelId,
      model_path: modelPath,
      load_mode: 'add',
      make_default: makeDefault,
    })
    const models = Array.from(new Set([...live.models, modelId]))
    const updated: AxEngineServerRecord = {
      ...live.record,
      models,
      ...(makeDefault ? { model: modelId, modelPath } : {}),
    }
    writeServerRecord(updated)
    return readyStatus(updated, models, [])
  } finally {
    release()
  }
}

export async function unloadAxEngineModel(modelId: string): Promise<AxEngineStatus> {
  const release = await acquireAxEngineLock()
  try {
    const live = await adoptRecord(readServerRecord())
    if (!live) throw new Error('ax-engine server is not running')
    await postModelAction(live.record, 'unload', { model_id: modelId })
    const models = live.models.filter((id) => id !== modelId)
    const updated: AxEngineServerRecord = { ...live.record, models }
    writeServerRecord(updated)
    return readyStatus(updated, models, [])
  } finally {
    release()
  }
}

export type { AxEnginePhase }
