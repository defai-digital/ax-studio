// llama-server session management — port of
// src-tauri/plugins/tauri-plugin-llamacpp/src/{commands.rs,process.rs,state.rs,cleanup.rs}.
//
// Spawn semantics: every server is spawned as a process-group leader
// (`detached` on POSIX) so unload/cleanup can SIGTERM the whole group — this
// is the Rust ax-serving behavior extended to llama-server, per the migration
// plan (orphaned grandchildren must not hold ports/GPU). Windows uses
// `taskkill /T /F`.
import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac, randomInt } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { buildLlamacppArgs, normalizeLlamacppConfig, type LlamacppConfig } from './args.js'
import { LlamacppError, unimplementedCommand } from './error.js'
import {
  isDangerousProcessEnvKey,
  trustedBinaryRoots,
  trustedModelRoots,
  validateBinaryPath,
  validateMmprojPath,
  validateModelPath,
  validatePathWithinRoots,
} from './path.js'
import { addCudaPaths, binaryRequiresCuda, setupLibraryPath } from './sysutil.js'

export interface SessionInfo {
  pid: number
  port: number
  model_id: string
  model_path: string
  is_embedding: boolean
  api_key: string
  mmproj_path: string | null
}

export interface UnloadResult {
  success: boolean
  error: string | null
}

interface Session {
  child: ChildProcess
  info: SessionInfo
  /** Resolves when the child process exits (exit event observed). */
  exited: Promise<number | null>
}

const sessions = new Map<number, Session>()

// Per-model startup locks (port of LlamacppState::acquire_startup_lock):
// serialize loads of the same model without blocking unrelated models.
const startupChains = new Map<string, Promise<void>>()

function withStartupLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = startupChains.get(key) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const chain = previous.then(() => current)
  startupChains.set(key, chain)
  return previous.then(fn).finally(() => {
    release()
    // Drop the chain entry once drained, unless a newer link was appended.
    void chain.then(() => {
      if (startupChains.get(key) === chain) startupChains.delete(key)
    })
  })
}

const STDERR_BUFFER_CAP = 64 * 1024

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new LlamacppError('INVALID_ARGUMENT', `Missing or invalid argument: ${name}`)
  }
  return value
}

function requiredPort(value: unknown): number {
  const port = typeof value === 'number' && Number.isInteger(value) ? value : NaN
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new LlamacppError('INVALID_ARGUMENT', 'Invalid configuration argument provided.', `port: ${String(value)}`)
  }
  return port
}

export interface LoadModelArgs {
  backendPath: string
  modelId: string
  modelPath: string
  port: number
  config: LlamacppConfig
  envs: Record<string, string>
  mmprojPath?: string
  isEmbedding: boolean
  timeout: number
}

/** Port of the `load_llama_model` command (llamacpp engine only). */
export async function loadLlamaModel(rawArgs: Record<string, unknown>): Promise<SessionInfo> {
  const modelId = requiredString(rawArgs.modelId ?? rawArgs.model_id, 'modelId')
  return withStartupLock(modelId, async () => {
    // Existing session for this model? Return it without a respawn.
    for (const session of sessions.values()) {
      if (session.info.model_id === modelId) return session.info
    }

    const backendPath = requiredString(rawArgs.backendPath ?? rawArgs.backend_path, 'backendPath')
    const modelPath = requiredString(rawArgs.modelPath ?? rawArgs.model_path, 'modelPath')
    const port = requiredPort(rawArgs.port)
    const config = normalizeLlamacppConfig(rawArgs.config)
    const envs = (rawArgs.envs ?? {}) as Record<string, string>
    const mmprojPath =
      typeof rawArgs.mmprojPath === 'string'
        ? rawArgs.mmprojPath
        : typeof rawArgs.mmproj_path === 'string'
          ? rawArgs.mmproj_path
          : undefined
    const isEmbedding = rawArgs.isEmbedding === true || rawArgs.is_embedding === true
    const timeoutSecs =
      typeof rawArgs.timeout === 'number' && Number.isFinite(rawArgs.timeout) && rawArgs.timeout > 0
        ? rawArgs.timeout
        : 600

    if (config.engine_type === 'ax-serving') {
      throw unimplementedCommand('plugin:llamacpp|start_ax_serving')
    }

    console.log(`[llamacpp] Attempting to launch llama.cpp server at path: ${backendPath}`)

    const binPath = validateBinaryPath(backendPath, trustedBinaryRoots(), [
      'llama-server',
      'llama-server.exe',
    ])

    const args = buildLlamacppArgs(config, modelId, modelPath, port, mmprojPath, isEmbedding)
    const apiKey = typeof envs.LLAMA_API_KEY === 'string' ? envs.LLAMA_API_KEY : ''
    if (apiKey === '') console.warn('[llamacpp] API key not provided')

    // Validate model/mmproj paths and confine them to the managed model roots.
    const modelPathArg = validateModelPath(args)
    const canonicalModelPath = validatePathWithinRoots(modelPathArg, trustedModelRoots(), 'model')
    const mmprojPathArg = validateMmprojPath(args)
    if (mmprojPathArg) validatePathWithinRoots(mmprojPathArg, trustedModelRoots(), 'mmproj')

    // Environment: inherit the parent env, overlay filtered caller envs, then
    // inject CUDA / library paths (mirrors the Rust command construction order).
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const [key, value] of Object.entries(envs)) {
      if (isDangerousProcessEnvKey(key)) {
        console.warn(`[llamacpp] Blocking dangerous env var ${key} from llama-server`)
        continue
      }
      env[key] = value
    }
    const cudaFound = addCudaPaths(env)
    if (!cudaFound && binaryRequiresCuda(binPath)) {
      console.warn(
        '[llamacpp] backend appears to require CUDA, but CUDA was not found. Process may fail to start.',
      )
    }
    const cwd = setupLibraryPath(path.dirname(binPath), env)

    const child = spawn(binPath, args, {
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Process-group leader on POSIX so the whole group can be signaled.
      detached: process.platform !== 'win32',
      windowsHide: true,
    })

    const sessionInfo = await waitForReady(child, modelId, port, apiKey, canonicalModelPath, mmprojPathArg ?? null, isEmbedding, timeoutSecs)

    const exited = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => resolve(code))
    })
    const pid = sessionInfo.pid
    sessions.set(pid, { child, info: sessionInfo, exited })
    // Reaper: drop the session as soon as the process exits (the Rust side
    // polls every 5s; the exit event is immediate).
    void exited.then((code) => {
      if (sessions.delete(pid)) {
        console.log(`[llamacpp] Reaping exited llama session ${pid} with status ${String(code)}`)
      }
    })

    return sessionInfo
  })
}

/**
 * Monitor stdout/stderr for readiness, early exit, spawn failure, or timeout.
 * Readiness patterns mirror commands.rs exactly.
 */
function waitForReady(
  child: ChildProcess,
  modelId: string,
  port: number,
  apiKey: string,
  canonicalModelPath: string,
  mmprojPath: string | null,
  isEmbedding: boolean,
  timeoutSecs: number,
): Promise<SessionInfo> {
  return new Promise((resolve, reject) => {
    let stderrBuffer = ''
    let captureStderr = true
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      child.stdout?.removeAllListeners('data')
      child.stderr?.removeAllListeners('data')
      child.removeAllListeners('exit')
      child.removeAllListeners('error')
      fn()
    }

    const failWithStderr = (prefix: string): void => {
      console.error(`[llamacpp] ${prefix}`)
      console.error(stderrBuffer)
      finish(() => reject(LlamacppError.fromStderr(stderrBuffer)))
    }

    const STDOUT_READY = ['http server listening', 'all slots are idle', 'starting the main loop']
    const STDERR_READY = ['server is listening on', 'starting the main loop', 'server listening on']

    let stdoutBuf = ''
    let stderrBuf = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8')
      let newline: number
      while ((newline = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, newline).replace(/\r$/, '')
        stdoutBuf = stdoutBuf.slice(newline + 1)
        if (line.length > 0) console.log(`[llamacpp stdout] ${line}`)
        const lower = line.toLowerCase()
        if (STDOUT_READY.some((needle) => lower.includes(needle))) {
          console.log(`[llamacpp] Server appears to be ready based on stdout: '${line}'`)
          finish(() =>
            resolve({
              pid: child.pid ?? -1,
              port,
              model_id: modelId,
              model_path: canonicalModelPath,
              is_embedding: isEmbedding,
              api_key: apiKey,
              mmproj_path: mmprojPath,
            }),
          )
          return
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8')
      let newline: number
      while ((newline = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, newline).replace(/\r$/, '')
        stderrBuf = stderrBuf.slice(newline + 1)
        if (line.length === 0) continue
        if (captureStderr) {
          if (stderrBuffer.length < STDERR_BUFFER_CAP) {
            stderrBuffer += line.slice(0, STDERR_BUFFER_CAP - stderrBuffer.length) + '\n'
          } else {
            captureStderr = false
          }
        }
        console.log(`[llamacpp] ${line}`)
        const lower = line.toLowerCase()
        if (STDERR_READY.some((needle) => lower.includes(needle))) {
          console.log(`[llamacpp] Model appears to be ready based on logs: '${line}'`)
          // Buffer only needed for startup failures; stop growing.
          captureStderr = false
          finish(() =>
            resolve({
              pid: child.pid ?? -1,
              port,
              model_id: modelId,
              model_path: canonicalModelPath,
              is_embedding: isEmbedding,
              api_key: apiKey,
              mmproj_path: mmprojPath,
            }),
          )
          return
        }
      }
    })

    child.once('error', (error) => {
      finish(() =>
        reject(
          new LlamacppError('IO_ERROR', 'An input/output error occurred.', String(error)),
        ),
      )
    })

    child.once('exit', (code, signal) => {
      if (settled) return
      failWithStderr(
        `llama.cpp exited before ready (code ${String(code)}, signal ${String(signal)})`,
      )
    })

    const timeoutTimer = setTimeout(() => {
      console.error('[llamacpp] Timeout waiting for llama.cpp server to be ready')
      void terminateProcessGroup(child, 2_000).finally(() => {
        finish(() =>
          reject(
            new LlamacppError(
              'MODEL_LOAD_TIMED_OUT',
              'The model took too long to load and timed out.',
              `Timeout: ${timeoutSecs}s\n\nStderr:\n${stderrBuffer}`,
            ),
          ),
        )
      })
    }, timeoutSecs * 1000)
    // Do not keep the main process alive solely for a pending load.
    timeoutTimer.unref?.()
  })
}

/**
 * SIGTERM the process group (POSIX) or the process tree (Windows), escalating
 * to SIGKILL after `graceMs`. Port of `graceful_terminate_process` /
 * `force_terminate_process`.
 */
async function terminateProcessGroup(child: ChildProcess, graceMs: number): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return

  const waitForExit = (ms: number): Promise<boolean> =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(true)
        return
      }
      const timer = setTimeout(() => {
        child.removeListener('exit', onExit)
        resolve(false)
      }, ms)
      const onExit = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      child.once('exit', onExit)
    })

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch (error) {
      console.error(`[llamacpp] Failed to taskkill PID ${pid}:`, error)
    }
    await waitForExit(graceMs)
    return
  }

  // The child is a process-group leader (spawned `detached`), so signal the
  // whole group with the negative pid to also reap grandchildren.
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already dead
    }
  }

  if (await waitForExit(graceMs)) return

  console.warn(`[llamacpp] SIGTERM timed out; sending SIGKILL to process group -${pid}`)
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already dead
    }
  }
  await waitForExit(graceMs)
}

/** Port of the `unload_llama_model` command. */
export async function unloadLlamaModel(pid: number): Promise<UnloadResult> {
  const session = sessions.get(pid)
  if (!session) {
    const msg = `No server with PID '${pid}' found`
    console.warn(`[llamacpp] ${msg}`)
    return { success: false, error: msg }
  }
  sessions.delete(pid)
  await terminateProcessGroup(session.child, 5_000)
  return { success: true, error: null }
}

/** Port of `cleanup_llama_processes` (2s grace, also wired to app quit). */
export async function cleanupLlamaProcesses(): Promise<void> {
  const all = [...sessions.values()]
  sessions.clear()
  await Promise.all(all.map((session) => terminateProcessGroup(session.child, 2_000)))
}

export function hasActiveSessions(): boolean {
  return sessions.size > 0
}

/** Port of `find_session_by_model`. */
export function findSessionByModel(modelId: string): SessionInfo | null {
  for (const session of sessions.values()) {
    if (session.info.model_id === modelId) return session.info
  }
  return null
}

/** Port of `get_loaded_models`. */
export function getLoadedModels(): string[] {
  return [...sessions.values()].map((session) => session.info.model_id)
}

/** Port of `get_all_sessions`. */
export function getAllSessions(): SessionInfo[] {
  return [...sessions.values()].map((session) => session.info)
}

/**
 * Port of `is_process_running` (sysinfo process scan → kill(pid, 0)).
 * Also reaps the session map entry when the process is gone.
 */
export function isProcessRunning(pid: number): boolean {
  let alive = false
  try {
    process.kill(pid, 0)
    alive = true
  } catch (error) {
    // EPERM means the process exists but we cannot signal it.
    alive = (error as NodeJS.ErrnoException).code === 'EPERM'
  }
  if (!alive) sessions.delete(pid)
  return alive
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

/** Port of `get_random_port` + `generate_random_port` (3000..3999, bindable). */
export async function getRandomPort(): Promise<number> {
  const usedPorts = new Set<number>()
  for (const session of sessions.values()) {
    if (session.info.port > 0 && session.info.port <= 65535) usedPorts.add(session.info.port)
  }
  const MAX_ATTEMPTS = 20_000
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const port = randomInt(3000, 4000) // [3000, 4000)
    if (usedPorts.has(port)) continue
    if (await isPortAvailable(port)) return port
  }
  throw new Error('Failed to find an available port for the model to load')
}

/** Port of `generate_api_key`: HMAC-SHA256(api_secret, model_id), base64. */
export function generateApiKey(modelId: string, apiSecret: string): string {
  return createHmac('sha256', apiSecret).update(modelId, 'utf8').digest('base64')
}
