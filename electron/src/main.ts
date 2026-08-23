// AX Studio Electron shell — main process entry.
// See docs/architecture/electron-migration-phase0-matrix.md for the migration plan.
import { app, BrowserWindow, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import nodeNet from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { emitToAllWindows } from './commands/registry.js'
import { registerAxStudioBridge, type AxStudioBridgeHandle } from './embed.js'
import { approvePath, bufferOpenFiles, getAppDataFolderPath } from './state.js'
import { cleanupLlamaProcesses, hasActiveSessions } from './llamacpp/session.js'
import { hasAxEngineServerRecord, stopAxEngineOnQuit } from './ax-engine/server.js'
import { checkAxEngineDependency, resolveAxEngineBinary } from './ax-engine/dependency.js'
import { isUpdateInstallInProgress, isUpdaterActive } from './updater.js'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:31420'
const SMOKE_MODE = process.argv.includes('--smoke')

// Smoke mode downloads fixtures from a 127.0.0.1 fixture server; the
// production download policy correctly rejects private/internal addresses,
// so smoke mode opts out via the downloads module's test-only escape hatch.
// Smoke also runs against a throwaway userData: the developer's real one can
// persist a local-API-server auto-start (default port 31419) that squats the
// ax-engine probe range and races the proxy checks — plus real secrets,
// threads, and stores the fixtures must never touch.
if (SMOKE_MODE) {
  process.env.AX_STUDIO_DOWNLOAD_ALLOW_PRIVATE = '1'
  app.setPath(
    'userData',
    fs.mkdtempSync(path.join(os.tmpdir(), 'ax-studio-smoke-userdata-'))
  )
}

let mainWindow: BrowserWindow | null = null
let bridge: AxStudioBridgeHandle | null = null

// The standalone shell consumes the same embed API hosts use (Phase 5): this
// registers the ax-file scheme privileges + IPC bridge + ax-file:// protocol,
// and (enableUpdater) initializes electron-updater in packaged prod builds.
// The synchronous pre-ready section runs immediately; the returned promise
// resolves once the app is ready and the bridge is fully wired.
const bridgePromise = registerAxStudioBridge({
  enableUpdater: true,
  getMainWindow: () => mainWindow,
  createChildWindow: (label, options) => {
    const win = new BrowserWindow({
      width: typeof options.width === 'number' ? options.width : 800,
      height: typeof options.height === 'number' ? options.height : 600,
      title: typeof options.title === 'string' ? options.title : label,
      center: options.center !== false,
      resizable: options.resizable !== false,
      minimizable: options.minimizable !== false,
      maximizable: options.maximizable !== false,
      closable: options.closable !== false,
      webPreferences: {
        contextIsolation: true,
        backgroundThrottling: false,
        sandbox: false,
        preload: bridge!.getPreloadPath(),
      },
    })
    loadRenderer(win, typeof options.url === 'string' ? options.url : undefined)
    return win
  },
})

function loadRenderer(win: BrowserWindow, route?: string): void {
  // Dev when VITE_DEV_SERVER_URL is set (see the dev:electron script);
  // otherwise load the built SPA (dist-renderer in repo builds, web-dist/
  // inside the asar when packaged — resolved by the bridge).
  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(route ? `${DEV_SERVER_URL}${route}` : DEV_SERVER_URL)
  } else {
    void win.loadFile(path.join(bridge!.getRendererPath(), 'index.html'), route ? { hash: route } : undefined)
  }
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !SMOKE_MODE,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      backgroundThrottling: false,
      // The preload only uses contextBridge + ipcRenderer, but it is a
      // separately-compiled CommonJS file, which requires sandbox: false.
      sandbox: false,
      preload: bridge!.getPreloadPath(),
      // Smoke flag for the preload bridge (renderer argv ≠ main argv).
      ...(SMOKE_MODE ? { additionalArguments: ['--ax-smoke'] } : {}),
    },
  })

  // External links never navigate the shell window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(win)
  return win
}

function collectOpenFileArgv(argv: string[]): string[] {
  // Windows/Linux "Open with": file paths arrive as argv entries.
  return argv.filter((arg) => arg.startsWith('/') || /^[A-Za-z]:[\\/]/.test(arg))
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const files = collectOpenFileArgv(argv.slice(1))
    if (files.length > 0) {
      approveAll(files)
      emitToAllWindows('dock-file-drop', files)
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // macOS: files dropped on the Dock icon / opened via Finder.
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    approvePath(filePath)
    if (mainWindow) {
      emitToAllWindows('dock-file-drop', [filePath])
    } else {
      bufferOpenFiles([filePath])
    }
  })

  void app.whenReady().then(async () => {
    // The bridge wired the ax-file:// protocol, the full IPC command registry,
    // and (packaged prod only, enableUpdater: true) electron-updater.
    bridge = await bridgePromise

    // Cold-start open-file argv (Windows/Linux).
    const argvFiles = collectOpenFileArgv(process.argv.slice(app.isPackaged ? 1 : 2))
    if (argvFiles.length > 0) bufferOpenFiles(argvFiles)

    if (SMOKE_MODE) {
      // Fixtures before window creation: runSmokeTest registers the
      // did-finish-load handler, and the page can finish loading fast enough
      // that any prep after createMainWindow would miss the event.
      const fixture = await startSmokeDownloadFixture()
      const llamaFixture = prepareSmokeLlamacppFixture(getAppDataFolderPath())
      const axEngineFixture = await prepareSmokeAxEngineFixture(getAppDataFolderPath())
      const mlxFixture = prepareSmokeMlxFixture(getAppDataFolderPath())
      mainWindow = createMainWindow()
      await runSmokeTest(mainWindow, fixture, llamaFixture, axEngineFixture, mlxFixture)
      return
    }

    mainWindow = createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Reap llama-server sessions and the ax-engine sidecar on quit (port of the
  // Rust cleanup.rs shutdown hook): SIGTERM, escalating to SIGKILL.
  let quitCleanupStarted = false
  app.on('will-quit', (event) => {
    // quitAndInstall() must not be blocked: preventing the quit would leave
    // the app running and the downloaded update never applied. The sidecar
    // is reclaimed from server.json on the next launch if it survives.
    if (isUpdateInstallInProgress()) return
    if (quitCleanupStarted) return
    if (!hasActiveSessions() && !hasAxEngineServerRecord()) return
    quitCleanupStarted = true
    event.preventDefault()
    void Promise.all([cleanupLlamaProcesses(), stopAxEngineOnQuit()]).finally(() => app.exit(0))
  })
}

function approveAll(paths: string[]): void {
  for (const p of paths) approvePath(p)
}

/**
 * Smoke mode: proves the main + preload + renderer handshake end-to-end, then
 * exercises the Phase 2 command surfaces (threads/messages persistence, the
 * internal API proxy, and downloads). Prints PASS/FAIL per section and
 * exits 0/1.
 */
async function runSmokeTest(
  win: BrowserWindow,
  fixture: SmokeDownloadFixture,
  llamaFixture: SmokeLlamacppFixture,
  axEngineFixture: SmokeAxEngineFixture,
  mlxFixture: SmokeMlxFixture,
): Promise<void> {
  // Collect renderer console output from the start so the Phase 3 checks can
  // prove the app bootstrap never touches the removed dynamic extension
  // commands (get_active_extensions / install_extensions / tgz activation).
  const consoleMessages: string[] = []
  win.webContents.on('console-message', (...args: unknown[]) => {
    // Electron ≥ 36 passes a single details object ({ message, level, … });
    // older shapes were (event, level, message, line, sourceId).
    const first = args[0] as { message?: unknown } | null | undefined
    const message =
      first && typeof first === 'object' && typeof first.message === 'string'
        ? first.message
        : typeof args[2] === 'string'
          ? (args[2] as string)
          : String(first)
    consoleMessages.push(message)
  })

  const finish = (code: number): void => {
    mlxFixture.finalize()
    const finalCode =
      axEngineFixture.mainFailures > 0 || mlxFixture.mainFailures > 0 ? 1 : code
    for (const line of axEngineFixture.mainLines) console.log(`[smoke] ${line}`)
    for (const line of mlxFixture.mainLines) console.log(`[smoke] ${line}`)
    axEngineFixture.cleanup()
    mlxFixture.cleanup()
    void fixture.close().finally(() => app.exit(finalCode))
  }
  const timeout = setTimeout(() => {
    console.error('[smoke] TIMEOUT waiting for renderer handshake')
    finish(1)
  }, 120_000)

  win.webContents.once('did-finish-load', () => {
    win.webContents
      .executeJavaScript(buildSmokeScript(fixture, llamaFixture, axEngineFixture, mlxFixture))
      .then((result) => {
        for (const line of (result as { lines?: string[] })?.lines ?? []) {
          console.log(`[smoke] ${line}`)
        }
        // Main-side check: bootstrap must not log errors from the removed
        // dynamic extension commands.
        const dynamicExtError = consoleMessages.find((message) =>
          /get_active_extensions|install_extensions?|get_app_extensions_path/.test(
            message
          )
        )
        if (dynamicExtError) {
          console.log(
            `[smoke] FAIL bootstrap avoids dynamic extension commands — ${dynamicExtError.slice(0, 200)}`
          )
        } else {
          console.log('[smoke] PASS bootstrap avoids dynamic extension commands')
        }
        // Main-side check: the renderer must never hit the removed Rust MCP
        // bridge commands.
        const rustMcpError = consoleMessages.find(
          (message) =>
            /unimplemented_command/.test(message) &&
            /activate_mcp_server|call_tool|get_tools/.test(message)
        )
        if (rustMcpError) {
          console.log(
            `[smoke] FAIL renderer avoids Rust MCP bridge commands — ${rustMcpError.slice(0, 200)}`
          )
        } else {
          console.log('[smoke] PASS renderer avoids Rust MCP bridge commands')
        }
        const rendererOk =
          (result as { ok?: boolean })?.ok && !dynamicExtError && !rustMcpError && isUpdaterActive() === false
        // Main-side check (Phase 4): electron-updater must never be
        // initialized in smoke mode — if it were, a launch-time check would
        // hit the update feed. isUpdaterActive() flips only inside
        // initUpdater(), which is gated to packaged production builds.
        if (isUpdaterActive()) {
          console.log('[smoke] FAIL electron-updater never initialized in smoke mode')
        } else {
          console.log('[smoke] PASS electron-updater never initialized in smoke mode')
        }
        // Global boot-probe assertion (Phase 3 slice 4): let the app bootstrap
        // fully settle (startup provider-refresh timers fire up to ~7s in),
        // then require ZERO unimplemented_command errors anywhere in the
        // renderer console — the Electron build must never probe commands the
        // main process does not implement during normal startup.
        setTimeout(() => {
          const bootProbeError = consoleMessages.find((message) =>
            /unimplemented_command/.test(message)
          )
          if (bootProbeError) {
            console.log(
              `[smoke] FAIL bootstrap zero unimplemented_command errors — ${bootProbeError.slice(0, 200)}`
            )
          } else {
            console.log('[smoke] PASS bootstrap zero unimplemented_command errors')
          }
          clearTimeout(timeout)
          finish(rendererOk && !bootProbeError ? 0 : 1)
        }, 10_000)
      })
      .catch((error) => {
        console.error(`[smoke] invoke failed: ${error}`)
        clearTimeout(timeout)
        finish(1)
      })
  })
}

// ─── Smoke download fixture ──────────────────────────────────────────────────
// Local node:http server standing in for a CDN: /a and /b are integrity
// checked full downloads, /flaky breaks mid-stream once and then serves Range
// resumes, /slow throttles forever so cancel_download_task can interrupt it.

interface SmokeDownloadFixture {
  port: number
  shaA: string
  sizeA: number
  shaB: string
  sizeB: number
  shaFlaky: string
  sizeFlaky: number
  close: () => Promise<void>
}

function patternBytes(size: number, seed: number): Buffer {
  const buffer = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buffer[i] = (i * 31 + seed) % 251
  return buffer
}

async function startSmokeDownloadFixture(): Promise<SmokeDownloadFixture> {
  const fileA = patternBytes(2.5 * 1024 * 1024, 7)
  const fileB = patternBytes(1.2 * 1024 * 1024, 13)
  const flaky = patternBytes(3 * 1024 * 1024, 29)
  const flakyBreakAt = 1024 * 1024
  const slowTotal = 64 * 1024 * 1024
  const slowChunk = patternBytes(16 * 1024, 3)
  const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')

  const server = http.createServer((req, res) => {
    const route = req.url ?? ''
    if (req.method === 'HEAD') {
      const size =
        route === '/a'
          ? fileA.length
          : route === '/b'
            ? fileB.length
            : route === '/flaky'
              ? flaky.length
              : route === '/slow'
                ? slowTotal
                : null
      if (size === null) {
        res.statusCode = 404
        res.end()
        return
      }
      res.setHeader('Content-Length', size)
      res.end()
      return
    }

    if (route === '/a' || route === '/b') {
      // Guards that caller headers really reach the origin.
      if (req.headers['x-smoke'] !== 'yes') {
        res.statusCode = 400
        res.end('missing x-smoke header')
        return
      }
      const body = route === '/a' ? fileA : fileB
      res.setHeader('Content-Length', body.length)
      res.end(body)
      return
    }

    if (route === '/flaky') {
      const range = /^bytes=(\d+)-$/.exec(typeof req.headers.range === 'string' ? req.headers.range : '')
      if (range) {
        const start = Number(range[1])
        if (start <= 0 || start >= flaky.length) {
          res.statusCode = 416
          res.end()
          return
        }
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${flaky.length - 1}/${flaky.length}`)
        res.setHeader('Content-Length', flaky.length - start)
        res.end(flaky.subarray(start))
        return
      }
      // First attempt: flush 1 MB, then break the connection mid-stream.
      res.setHeader('Content-Length', flaky.length)
      res.write(flaky.subarray(0, flakyBreakAt), () => {
        setTimeout(() => res.destroy(), 25)
      })
      return
    }

    if (route === '/slow') {
      res.setHeader('Content-Length', slowTotal)
      let sent = 0
      const timer = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          clearInterval(timer)
          return
        }
        res.write(slowChunk)
        sent += slowChunk.length
        if (sent >= slowTotal) {
          clearInterval(timer)
          res.end()
        }
      }, 10)
      req.on('close', () => clearInterval(timer))
      return
    }

    res.statusCode = 404
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    port,
    shaA: sha256(fileA),
    sizeA: fileA.length,
    shaB: sha256(fileB),
    sizeB: fileB.length,
    shaFlaky: sha256(flaky),
    sizeFlaky: flaky.length,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

// ─── Smoke llamacpp fixture ────────────────────────────────────────────────
// A minimal GGUF model file (exercises read_gguf_metadata) and a fake
// `llama-server` (a node script) placed under the trusted backend root. The
// fake prints a readiness line on stderr, serves /health + /v1/models, and
// spawns a grandchild so the smoke can prove process-group teardown.

interface SmokeLlamacppFixture {
  backendPath: string
  modelPath: string
}

const SMOKE_FAKE_LLAMA_SERVER = `#!/usr/bin/env node
// Fake llama-server for the Electron smoke suite.
const http = require('http')
const { spawn } = require('child_process')
const fs = require('fs')
const args = process.argv.slice(2)
const argValue = (flag) => {
  const i = args.indexOf(flag)
  return i === -1 ? null : args[i + 1]
}
const port = parseInt(argValue('--port') || '0', 10)
const model = argValue('-m') || 'model.gguf'
const alias = argValue('-a') || 'model'
const child = spawn(process.execPath, ['-e', 'setInterval(function () {}, 1000)'], { stdio: 'ignore' })
try { fs.writeFileSync(model + '.childpid', String(child.pid)) } catch {}
const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"status":"ok"}')
    return
  }
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: alias, object: 'model' }] }))
    return
  }
  res.writeHead(404)
  res.end()
})
server.listen(port, '127.0.0.1', () => {
  console.error('server is listening on http://127.0.0.1:' + port)
})
`

function ggufFixtureBytes(): Buffer {
  const str = (value: string): Buffer => {
    const bytes = Buffer.from(value, 'utf8')
    const len = Buffer.alloc(8)
    len.writeBigUInt64LE(BigInt(bytes.length))
    return Buffer.concat([len, bytes])
  }
  const u32 = (value: number): Buffer => {
    const bytes = Buffer.alloc(4)
    bytes.writeUInt32LE(value)
    return bytes
  }
  const u64 = (value: bigint): Buffer => {
    const bytes = Buffer.alloc(8)
    bytes.writeBigUInt64LE(value)
    return bytes
  }
  const entries = [
    // key, valueType, encoded value
    Buffer.concat([str('general.architecture'), u32(8), str('llama')]),
    Buffer.concat([str('general.name'), u32(8), str('smoke-fixture')]),
    Buffer.concat([str('llama.block_count'), u32(4), u32(4)]),
    Buffer.concat([str('llama.attention.head_count'), u32(4), u32(8)]),
    Buffer.concat([str('llama.embedding_length'), u32(4), u32(256)]),
    Buffer.concat([str('llama.context_length'), u32(4), u32(2048)]),
    // small Uint8 array → rendered as "[1, 2, 3]"
    Buffer.concat([str('llama.test_array'), u32(9), u32(0), u64(3n), Buffer.from([1, 2, 3])]),
  ]
  return Buffer.concat([
    Buffer.from('GGUF', 'latin1'),
    u32(3), // version
    u64(0n), // tensor count
    u64(BigInt(entries.length)),
    ...entries,
  ])
}

function prepareSmokeLlamacppFixture(dataFolder: string): SmokeLlamacppFixture {
  const modelsDir = path.join(dataFolder, 'llamacpp', 'models')
  const backendDir = path.join(dataFolder, 'llamacpp', 'backends', 'smoke')
  fs.mkdirSync(modelsDir, { recursive: true })
  fs.mkdirSync(backendDir, { recursive: true })
  const modelPath = path.join(modelsDir, 'smoke-model.gguf')
  fs.writeFileSync(modelPath, ggufFixtureBytes())
  const backendPath = path.join(backendDir, 'llama-server')
  fs.writeFileSync(backendPath, SMOKE_FAKE_LLAMA_SERVER)
  fs.chmodSync(backendPath, 0o755)
  return { backendPath, modelPath }
}

// ─── Smoke mlx HF-cache fixture ─────────────────────────────────────────────
// A throwaway Hugging Face hub cache (inside the smoke data folder so the
// renderer can read files through the confined FS bridge) with two repos —
// one with an AX-native manifest snapshot plus a newer weights-only snapshot,
// one weights-only — plus a fake `ax-engine-bench` CLI for
// `mlx_generate_model_manifest`.

interface SmokeMlxFixture {
  hfRoot: string
  axSnapshotDir: string
  weightsSnapshotDir: string
  emptyDir: string
  strayFile: string
  outsideFile: string
  mainLines: string[]
  mainFailures: number
  finalize: () => void
  cleanup: () => void
}

const SMOKE_FAKE_AX_ENGINE_BENCH = `#!/usr/bin/env node
// Fake ax-engine-bench for the Electron smoke suite: handles
// \`generate-manifest <dir>\` by writing a marker model-manifest.json.
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
if (args[0] !== 'generate-manifest' || !args[1]) {
  console.error('usage: ax-engine-bench generate-manifest <dir>')
  process.exit(2)
}
fs.writeFileSync(
  path.join(args[1], 'model-manifest.json'),
  JSON.stringify({ schema_version: 1, generated_by: 'smoke-fake-ax-engine-bench' }, null, 2)
)
`

function prepareSmokeMlxFixture(dataFolder: string): SmokeMlxFixture {
  // Unique-per-run roots: a crashed run must not leave stale state (e.g. a
  // previously generated manifest) that breaks the next run. Note the smoke
  // data folder IS the real default data folder (only userData is
  // throwaway), so cleanup below removes everything this fixture creates.
  const hfRoot = fs.mkdtempSync(path.join(dataFolder, 'smoke-hf-cache-'))
  const binRoot = fs.mkdtempSync(path.join(dataFolder, 'smoke-bin-'))
  const writeFile = (file: string, content: string | Buffer, mtime?: Date): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    if (mtime) fs.utimesSync(file, mtime, mtime)
  }
  const touchDir = (dir: string, mtime: Date): void => {
    fs.mkdirSync(dir, { recursive: true })
    fs.utimesSync(dir, mtime, mtime)
  }

  // Repo A: older manifest-bearing snapshot wins over the newer weights-only one.
  const repoA = path.join(hfRoot, 'models--smoke-org--smoke-ax-model', 'snapshots')
  const axSnapshotDir = path.join(repoA, 'aaa111')
  const newerWeightsDir = path.join(repoA, 'bbb222')
  writeFile(path.join(axSnapshotDir, 'model.safetensors'), Buffer.alloc(2048, 7))
  writeFile(
    path.join(axSnapshotDir, 'model-manifest.json'),
    JSON.stringify({ schema_version: 0, note: 'pre-existing' }),
  )
  writeFile(path.join(newerWeightsDir, 'model.safetensors'), Buffer.alloc(1024, 3))
  touchDir(axSnapshotDir, new Date('2026-01-01T00:00:00Z'))
  touchDir(newerWeightsDir, new Date('2026-06-01T00:00:00Z'))

  // Repo B: weights only (manifest generation target).
  const weightsSnapshotDir = path.join(
    hfRoot,
    'models--smoke-org--smoke-weights-model',
    'snapshots',
    'ccc333',
  )
  writeFile(path.join(weightsSnapshotDir, 'model.safetensors'), Buffer.alloc(4096, 11))

  const emptyDir = path.join(hfRoot, 'models--smoke-org--smoke-empty', 'snapshots', 'eee555')
  fs.mkdirSync(emptyDir, { recursive: true })

  const strayFile = path.join(hfRoot, 'models--smoke-org--smoke-weights-model', 'stray.tmp')
  writeFile(strayFile, 'stray')
  const outsideFile = path.join(os.tmpdir(), `ax-mlx-smoke-outside-${process.pid}.tmp`)
  fs.writeFileSync(outsideFile, 'do-not-delete')

  // Fake ax-engine-bench on AX_ENGINE_BENCH_BIN; HF cache root override.
  const benchBin = path.join(binRoot, 'ax-engine-bench')
  writeFile(benchBin, SMOKE_FAKE_AX_ENGINE_BENCH)
  fs.chmodSync(benchBin, 0o755)
  process.env.HF_HUB_CACHE = hfRoot
  process.env.AX_ENGINE_BENCH_BIN = benchBin

  const mainLines: string[] = []
  let mainFailures = 0
  return {
    hfRoot,
    axSnapshotDir,
    weightsSnapshotDir,
    emptyDir,
    strayFile,
    outsideFile,
    mainLines,
    mainFailures,
    // Runs after the renderer checks: the cleanup command must have refused to
    // touch paths outside the HF cache.
    finalize: () => {
      const ok = fs.existsSync(outsideFile)
      if (ok) {
        mainLines.push('PASS mlx cleanup refuses paths outside HF cache')
      } else {
        mainFailures += 1
        mainLines.push('FAIL mlx cleanup refuses paths outside HF cache')
      }
    },
    cleanup: () => {
      delete process.env.HF_HUB_CACHE
      delete process.env.AX_ENGINE_BENCH_BIN
      // The extension auto-registers listed HF cache models into the model
      // registry (`_mergeHfCacheModels` → model.yml); undo that so the next
      // run (and the developer's real registry) is not polluted.
      try {
        fs.rmSync(path.join(dataFolder, 'llamacpp', 'models', 'smoke-org'), {
          recursive: true,
          force: true,
        })
      } catch {
        // best effort
      }
      for (const dir of [hfRoot, binRoot]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true })
        } catch {
          // best effort
        }
      }
      try {
        fs.rmSync(outsideFile, { force: true })
      } catch {
        // best effort
      }
    },
  }
}


// A fake `ax-engine` node CLI in three variants — on PATH (6.9.0), managed
// install dir (7.0.0), and below the version floor (6.8.2) — plus an occupied
// 31418 (port-probe proof), an orphan `ax-engine serve` process (server.json
// reclaim proof), and an innocent process (pid-recycling protection proof).

// ─── Smoke ax-engine fixture ───────────────────────────────────────────────
// A fake `ax-engine` node CLI in three variants — on PATH (6.9.0), managed
// install dir (7.0.0), and below the version floor (6.8.2) — plus an occupied
// 31418 (port-probe proof), an orphan `ax-engine serve` process (server.json
// reclaim proof), and an innocent process (pid-recycling protection proof).

interface SmokeAxEngineFixture {
  pathBinary: string
  managedBinary: string
  oldBinary: string
  innocentPid: number
  orphanPid: number
  orphanPort: number
  mainLines: string[]
  mainFailures: number
  cleanup: () => void
}

const SMOKE_FAKE_AX_ENGINE = `#!/usr/bin/env node
// Fake ax-engine for the Electron smoke suite. __VERSION__ is stamped per copy.
const http = require('http')
const args = process.argv.slice(2)
if (args[0] === '--version' || args[0] === '-V') {
  console.log('ax-engine __VERSION__')
  process.exit(0)
}
if (args[0] !== 'serve') {
  console.error('unknown command: ' + args[0])
  process.exit(2)
}
const modelPath = args[1] || 'model'
const argValue = (flag) => {
  const i = args.indexOf(flag)
  return i === -1 ? null : args[i + 1]
}
const port = parseInt(argValue('--port') || '0', 10)
const initialModel = argValue('--model-id') || modelPath
const apiKey = process.env.AX_ENGINE_API_KEY || 'local'
if (process.env.AX_FAKE_IGNORE_TERM === '1') process.on('SIGTERM', () => {})
const loaded = new Set([initialModel])
const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'authorization,content-type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"status":"ok"}')
    return
  }
  const authed = req.headers.authorization === 'Bearer ' + apiKey
  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  const body = (cb) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => cb(d)) }
  if (req.url === '/v1/models') {
    if (!authed) { json(401, { error: 'unauthorized' }); return }
    json(200, { object: 'list', data: Array.from(loaded).map((id) => ({ id, object: 'model' })) })
    return
  }
  if (req.url === '/v1/model/load' && req.method === 'POST') {
    if (!authed) { json(401, { error: 'unauthorized' }); return }
    body((d) => {
      try { loaded.add(JSON.parse(d).model_id) } catch {}
      json(200, { ok: true })
    })
    return
  }
  if (req.url === '/v1/model/unload' && req.method === 'POST') {
    if (!authed) { json(401, { error: 'unauthorized' }); return }
    body((d) => {
      try { loaded.delete(JSON.parse(d).model_id) } catch {}
      json(200, { ok: true })
    })
    return
  }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    if (!authed) { json(401, { error: 'unauthorized' }); return }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: ' + JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'smoke' }, finish_reason: null }] }) + '\\n\\n')
    res.write('data: ' + JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\\n\\n')
    res.end('data: [DONE]\\n\\n')
    return
  }
  res.writeHead(404)
  res.end()
})
server.listen(port, '127.0.0.1')
`

async function prepareSmokeAxEngineFixture(dataFolder: string): Promise<SmokeAxEngineFixture> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-engine-smoke-'))
  const writeFake = (file: string, version: string): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, SMOKE_FAKE_AX_ENGINE.replaceAll('__VERSION__', version))
    fs.chmodSync(file, 0o755)
  }
  const pathBinary = path.join(tmpRoot, 'path-bin', 'ax-engine')
  const oldBinary = path.join(tmpRoot, 'old-bin', 'ax-engine')
  const managedBinary = path.join(dataFolder, 'ax-engine', 'ax-engine')
  writeFake(pathBinary, '6.9.0')
  writeFake(oldBinary, '6.8.2')
  writeFake(managedBinary, '7.0.0')

  // PATH resolution happens in the main process, so the fixture dir is
  // prepended here (renderer cannot influence main's environment).
  process.env.PATH = `${path.dirname(pathBinary)}${path.delimiter}${process.env.PATH ?? ''}`

  const mainLines: string[] = []
  let mainFailures = 0
  const checkMain = (name: string, cond: boolean, detail?: string): void => {
    if (cond) mainLines.push(`PASS ${name}`)
    else {
      mainFailures += 1
      mainLines.push(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    }
  }

  // Binary resolution order, asserted from the main process (env manipulation
  // is impossible from the renderer):
  //   AX_ENGINE_BIN beats PATH; PATH beats managed; override beats env.
  process.env.AX_ENGINE_BIN = managedBinary
  const envResolved = resolveAxEngineBinary()
  delete process.env.AX_ENGINE_BIN
  checkMain(
    'ax-engine resolution: AX_ENGINE_BIN beats PATH',
    envResolved?.source === 'env' && envResolved.path === managedBinary,
    JSON.stringify(envResolved),
  )
  const pathResolved = resolveAxEngineBinary()
  checkMain(
    'ax-engine resolution: PATH beats managed',
    pathResolved?.source === 'path' && pathResolved.path === pathBinary,
    JSON.stringify(pathResolved),
  )
  const overrideResolved = resolveAxEngineBinary(managedBinary)
  checkMain(
    'ax-engine resolution: override beats PATH',
    overrideResolved?.source === 'override' && overrideResolved.path === managedBinary,
    JSON.stringify(overrideResolved),
  )
  const savedPath = process.env.PATH
  process.env.PATH = '/usr/bin:/bin'
  const managedResolved = resolveAxEngineBinary()
  process.env.PATH = savedPath
  checkMain(
    'ax-engine resolution: managed install fallback',
    managedResolved?.source === 'managed' && managedResolved.path === managedBinary,
    JSON.stringify(managedResolved),
  )
  const oldDep = await checkAxEngineDependency(oldBinary)
  checkMain(
    'ax-engine version floor rejects 6.8.x (main)',
    oldDep.binary !== null && !oldDep.versionOk && oldDep.version === '6.8.2',
    JSON.stringify(oldDep),
  )

  // Occupy the default port so the manager must probe upward.
  const portBlocker = nodeNet.createServer()
  await new Promise<void>((resolve) => portBlocker.listen(31418, '127.0.0.1', resolve))

  // Orphan server: alive, answering, but NOT spawned by the manager.
  const orphanPort = 31488
  const orphan = spawn(pathBinary, ['serve', '/models/orphan', '--port', String(orphanPort), '--', '--model-id', 'orphan-model'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AX_ENGINE_API_KEY: 'local' },
  })
  orphan.unref()
  const orphanDeadline = Date.now() + 10_000
  let orphanReady = false
  while (Date.now() < orphanDeadline && !orphanReady) {
    try {
      const response = await fetch(`http://127.0.0.1:${orphanPort}/v1/models`, {
        headers: { Authorization: 'Bearer local' },
      })
      orphanReady = response.ok
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  checkMain('ax-engine orphan fixture answers /v1/models', orphanReady)

  // Innocent bystander process for the pid-recycling protection check.
  // process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it
  // behave as plain node so the bystander reliably stays alive (and never
  // launches a second app instance against the real userData).
  const innocent = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
  )
  innocent.unref()

  return {
    pathBinary,
    managedBinary,
    oldBinary,
    innocentPid: innocent.pid ?? 0,
    orphanPid: orphan.pid ?? 0,
    orphanPort,
    mainLines,
    mainFailures,
    cleanup: () => {
      for (const pid of [innocent.pid, orphan.pid]) {
        if (pid) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            /* already gone */
          }
        }
      }
      portBlocker.close()
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    },
  }
}

// Runs inside the renderer against the full preload bridge.
// NOTE: no template literals inside — the script is interpolated into a
// template string, so stick to string concatenation.
function buildSmokeScript(
  fixture: SmokeDownloadFixture,
  llamaFixture: SmokeLlamacppFixture,
  axEngineFixture: SmokeAxEngineFixture,
  mlxFixture: SmokeMlxFixture,
): string {
  const baseA = "'http://127.0.0.1:" + fixture.port + "/a'"
  const baseB = "'http://127.0.0.1:" + fixture.port + "/b'"
  const baseSlow = "'http://127.0.0.1:" + fixture.port + "/slow'"
  const baseFlaky = "'http://127.0.0.1:" + fixture.port + "/flaky'"
  return `(async () => {
  const lines = []
  let failures = 0
  const check = (name, cond, detail) => {
    if (cond) lines.push('PASS ' + name)
    else { failures += 1; lines.push('FAIL ' + name + (detail ? ' — ' + detail : '')) }
  }
  if (!window.axElectron) return { ok: false, lines: ['window.axElectron missing'] }
  const invoke = (cmd, args) => window.axElectron.invoke(cmd, args)
  const errText = (e) => String(e && e.message ? e.message : e)
  const waitFor = async (cond, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (cond()) return true
      await new Promise((r) => setTimeout(r, 25))
    }
    return cond()
  }

  // ── handshake (Phase 1) ──
  const dataFolder = await invoke('get_app_data_folder_path')
  check('handshake data folder', typeof dataFolder === 'string' && dataFolder.length > 0)

  // ── threads/messages (Phase 2A) ──
  let threadId = null
  try {
    const thread = await invoke('create_thread', {
      thread: { object: 'thread', title: 'smoke-thread', assistants: [], metadata: {} },
    })
    threadId = thread.id
    check('create_thread returns uuid', typeof threadId === 'string' && threadId.length > 0)

    const message = await invoke('create_message', {
      message: { object: 'thread.message', thread_id: threadId, role: 'user', status: 'ready', content: [{ type: 'text', text: { value: 'hello' } }], attachments: [], metadata: {} },
    })
    check('create_message returns id', typeof message.id === 'string' && message.id.length > 0)

    const threads = await invoke('list_threads')
    check('list_threads contains new thread', Array.isArray(threads) && threads.some((t) => t.id === threadId))

    const messages = await invoke('list_messages', { threadId })
    check('list_messages returns 1 message', Array.isArray(messages) && messages.length === 1 && messages[0].thread_id === threadId)

    await invoke('modify_thread', { thread: { ...thread, title: 'smoke-thread-updated' } })
    const afterModify = await invoke('list_threads')
    check('modify_thread persists title', afterModify.some((t) => t.id === threadId && t.title === 'smoke-thread-updated'))

    const assistant = await invoke('create_thread_assistant', { threadId, assistant: { id: 'smoke-asst', name: 'Smoke' } })
    check('create_thread_assistant echoes', assistant && assistant.id === 'smoke-asst')
    const fetched = await invoke('get_thread_assistant', { threadId })
    check('get_thread_assistant returns first', fetched && fetched.id === 'smoke-asst')

    await invoke('modify_message', { message: { ...message, status: 'modified' } })
    const modifiedMessages = await invoke('list_messages', { threadId })
    check('modify_message persists status', modifiedMessages[0] && modifiedMessages[0].status === 'modified')

    await invoke('delete_message', { threadId, messageId: message.id })
    const afterDelete = await invoke('list_messages', { threadId })
    check('delete_message empties thread', Array.isArray(afterDelete) && afterDelete.length === 0)

    await invoke('delete_thread', { threadId })
    const afterThreadDelete = await invoke('list_threads')
    check('delete_thread removes thread', !afterThreadDelete.some((t) => t.id === threadId))
  } catch (error) {
    failures += 1
    lines.push('FAIL threads section threw: ' + (error && error.message ? error.message : String(error)))
    if (threadId) {
      try { await invoke('delete_thread', { threadId }) } catch { /* best effort cleanup */ }
    }
  }

  // ── internal API proxy (Phase 2B) ──
  let serverStarted = false
  try {
    const port = await invoke('start_server', {
      config: { host: '127.0.0.1', port: 31499, prefix: '/v1', api_key: '', trusted_hosts: ['localhost'], cors_enabled: false, verbose_logs: false, proxy_timeout: 30 },
    })
    serverStarted = true
    check('start_server returns port', port === 31499, 'got ' + port)
    check('get_server_status true', (await invoke('get_server_status')) === true)

    await invoke('register_provider_config', {
      request: { provider: 'smoke-dummy', api_key: 'sk-smoke', custom_headers: [], models: ['smoke-model-1'] },
    })
    const configs = await invoke('list_provider_configs')
    const dummy = Array.isArray(configs) && configs.find((c) => c.provider === 'smoke-dummy')
    check('list_provider_configs shows dummy', Boolean(dummy))
    check('provider config redacts key', dummy && dummy.has_api_key === true && !('api_key' in dummy))

    // The app bootstrap periodically re-syncs its provider list into the
    // proxy registry and can clobber the smoke registration; re-register and
    // retry until the aggregate listing reflects it.
    let modelIds = []
    const modelsDeadline = Date.now() + 15000
    while (Date.now() < modelsDeadline) {
      await invoke('register_provider_config', {
        request: { provider: 'smoke-dummy', api_key: 'sk-smoke', custom_headers: [], models: ['smoke-model-1'] },
      })
      const modelsResponse = await fetch('http://127.0.0.1:31499/v1/models')
      const modelsBody = await modelsResponse.json()
      modelIds = Array.isArray(modelsBody.data) ? modelsBody.data.map((m) => m.id) : []
      if (modelIds.includes('smoke-model-1')) break
      await new Promise((r) => setTimeout(r, 400))
    }
    check('GET /v1/models aggregates provider models', modelIds.includes('smoke-model-1'), JSON.stringify(modelIds))

    await invoke('unregister_provider_config', { provider: 'smoke-dummy' })
    const configsAfter = await invoke('list_provider_configs')
    check('unregister_provider_config removes dummy', !configsAfter.some((c) => c.provider === 'smoke-dummy'))
  } catch (error) {
    failures += 1
    lines.push('FAIL proxy section threw: ' + (error && error.message ? error.message : String(error)))
  } finally {
    if (serverStarted) {
      await invoke('stop_server')
      check('stop_server stops', (await invoke('get_server_status')) === false)
    }
  }

  // ── downloads (Phase 2C) ──
  const dlDir = dataFolder + '/smoke-downloads'
  try {
    // Exact payload shape used by extensions/download-extension (snake_case
    // item fields, camelCase taskId, plain headers map).
    const events = []
    const off = window.axElectron.onEvent((env) => {
      if (env && env.kind === 'event' && env.name === 'download-smoke_task') events.push(env.payload)
    })
    await invoke('download_files', {
      items: [
        { url: ${baseA}, save_path: 'smoke-downloads/a.bin', sha256: '${fixture.shaA}', size: ${fixture.sizeA}, model_id: 'smoke/model' },
        { url: ${baseB}, save_path: 'smoke-downloads/b.bin', sha256: '${fixture.shaB}' },
      ],
      taskId: 'smoke_task',
      headers: { 'X-Smoke': 'yes' },
    })
    check('download_files two items completes', true)
    off()

    const okA = await invoke('validate_sha256', { path: dlDir + '/a.bin', expected: '${fixture.shaA}' })
    const okB = await invoke('validate_sha256', { path: dlDir + '/b.bin', expected: '${fixture.shaB}' })
    check('downloaded bytes match fixtures', okA === true && okB === true, 'a=' + okA + ' b=' + okB)

    check('progress events fired', events.length >= 2, 'got ' + events.length)
    let monotonic = true
    for (let i = 1; i < events.length; i++) {
      if (events[i].transferred < events[i - 1].transferred) monotonic = false
    }
    check('progress events are ordered', monotonic)
    const lastEv = events[events.length - 1] || {}
    check('final progress equals total', lastEv.transferred === ${fixture.sizeA + fixture.sizeB} && lastEv.total === ${fixture.sizeA + fixture.sizeB}, JSON.stringify(lastEv))
    check('progress payload carries ids', events.every((e) => e.downloadId === 'smoke_task' && e.modelId === 'smoke/model'))
    check('partial artifacts cleaned after commit',
      (await invoke('exists_sync', { path: dlDir + '/a.bin.tmp' })) === false &&
      (await invoke('exists_sync', { path: dlDir + '/a.bin.url' })) === false)
  } catch (error) {
    failures += 1
    lines.push('FAIL downloads basic section threw: ' + errText(error))
  }

  // ── cancel mid-stream ──
  try {
    const cancelEvents = []
    const offCancel = window.axElectron.onEvent((env) => {
      if (env && env.kind === 'event' && env.name === 'download-smoke_cancel') cancelEvents.push(env.payload)
    })
    const pending = invoke('download_files', {
      items: [{ url: ${baseSlow}, save_path: 'smoke-downloads/slow.bin', sha256: '${'0'.repeat(64)}' }],
      taskId: 'smoke_cancel',
      headers: {},
    })
    const sawProgress = await waitFor(() => cancelEvents.some((e) => e.transferred > 0), 10000)
    check('throttled download starts streaming', sawProgress)
    await invoke('cancel_download_task', { taskId: 'smoke_cancel' })
    const cancelError = await pending.then(() => null, (e) => errText(e))
    check('cancel rejects with Download cancelled', typeof cancelError === 'string' && cancelError.indexOf('Download cancelled') !== -1, cancelError)
    // Rust semantics: cancelling a fresh (non-resume) download removes the
    // .tmp/.url artifacts; the final path is never touched.
    check('cancel removes fresh partial artifacts',
      (await invoke('exists_sync', { path: dlDir + '/slow.bin.tmp' })) === false &&
      (await invoke('exists_sync', { path: dlDir + '/slow.bin.url' })) === false &&
      (await invoke('exists_sync', { path: dlDir + '/slow.bin' })) === false)
    offCancel()

    let missingErr = null
    try { await invoke('cancel_download_task', { taskId: 'smoke_missing' }) } catch (e) { missingErr = errText(e) }
    check('cancel unknown task rejected', missingErr !== null && missingErr.indexOf('No download task') !== -1, missingErr)
  } catch (error) {
    failures += 1
    lines.push('FAIL downloads cancel section threw: ' + errText(error))
  }

  // ── resume via Range after a mid-stream failure ──
  try {
    let firstErr = null
    try {
      await invoke('download_files', {
        items: [{ url: ${baseFlaky}, save_path: 'smoke-downloads/flaky.bin', sha256: '${fixture.shaFlaky}' }],
        taskId: 'smoke_resume',
        headers: {},
      })
    } catch (e) { firstErr = errText(e) }
    check('flaky download fails mid-stream', firstErr !== null, 'unexpected success')
    check('resume artifacts preserved after failure',
      (await invoke('exists_sync', { path: dlDir + '/flaky.bin.tmp' })) === true &&
      (await invoke('exists_sync', { path: dlDir + '/flaky.bin.url' })) === true)

    await invoke('download_files', {
      items: [{ url: ${baseFlaky}, save_path: 'smoke-downloads/flaky.bin', sha256: '${fixture.shaFlaky}', size: ${fixture.sizeFlaky} }],
      taskId: 'smoke_resume',
      headers: {},
    })
    check('resume completes and verifies', (await invoke('validate_sha256', { path: dlDir + '/flaky.bin', expected: '${fixture.shaFlaky}' })) === true)
    check('resume artifacts committed', (await invoke('exists_sync', { path: dlDir + '/flaky.bin.tmp' })) === false)
  } catch (error) {
    failures += 1
    lines.push('FAIL downloads resume section threw: ' + errText(error))
  }

  // ── policy rejections ──
  const escapeCases = [
    { save_path: '../smoke-escape.bin', label: 'relative ..' },
    { save_path: '/tmp/ax-smoke-escape.bin', label: 'absolute outside roots' },
  ]
  for (const escapeCase of escapeCases) {
    let rejected = null
    try {
      await invoke('download_files', {
        items: [{ url: ${baseB}, save_path: escapeCase.save_path, sha256: '${fixture.shaB}' }],
        taskId: 'smoke_escape',
        headers: {},
      })
    } catch (e) { rejected = errText(e) }
    check('path escape rejected (' + escapeCase.label + ')', rejected !== null && rejected.indexOf('outside') !== -1, rejected)
  }

  let headerErr = null
  try {
    await invoke('download_files', {
      items: [{ url: ${baseB}, save_path: 'smoke-downloads/h.bin', sha256: '${fixture.shaB}' }],
      taskId: 'smoke_hdr',
      headers: { Range: 'bytes=0-' },
    })
  } catch (e) { headerErr = errText(e) }
  check('managed header rejected', headerErr !== null && headerErr.indexOf('managed by the HTTP client') !== -1, headerErr)

  try { await invoke('rm', { path: dlDir }) } catch { /* best effort cleanup */ }

  // ── llamacpp plugin: GGUF + ports (Phase 2D) ──
  const smokeModelPath = ${JSON.stringify(llamaFixture.modelPath)}
  const smokeBackendPath = ${JSON.stringify(llamaFixture.backendPath)}
  let ggufMeta = null
  try {
    const randomPort = await invoke('plugin:llamacpp|get_random_port')
    check('llamacpp get_random_port in range', typeof randomPort === 'number' && randomPort >= 3000 && randomPort < 4000, String(randomPort))

    ggufMeta = await invoke('plugin:llamacpp|read_gguf_metadata', { path: smokeModelPath })
    check('gguf header parsed', ggufMeta && ggufMeta.version === 3 && ggufMeta.tensor_count === 0, JSON.stringify(ggufMeta && { v: ggufMeta.version, t: ggufMeta.tensor_count }))
    check('gguf string metadata', ggufMeta.metadata['general.architecture'] === 'llama' && ggufMeta.metadata['general.name'] === 'smoke-fixture', JSON.stringify(ggufMeta.metadata))
    check('gguf numeric metadata', ggufMeta.metadata['llama.block_count'] === '4' && ggufMeta.metadata['llama.context_length'] === '2048' && ggufMeta.metadata['llama.embedding_length'] === '256')
    check('gguf small array rendered', ggufMeta.metadata['llama.test_array'] === '[1, 2, 3]', String(ggufMeta.metadata['llama.test_array']))

    const kv = await invoke('plugin:llamacpp|estimate_kv_cache_size', { meta: ggufMeta.metadata, ctxSize: 1024 })
    check('estimate_kv_cache_size exact', kv && kv.per_token_size === 4096 && kv.size === 4194304, JSON.stringify(kv))

    const modelSize = await invoke('plugin:llamacpp|get_model_size', { path: smokeModelPath })
    check('get_model_size positive', typeof modelSize === 'number' && modelSize > 0, String(modelSize))
  } catch (error) {
    failures += 1
    lines.push('FAIL llamacpp gguf section threw: ' + errText(error))
  }

  // ── llamacpp plugin: session lifecycle against the fake llama-server ──
  let sessionPid = null
  let grandchildPid = null
  try {
    const port = await invoke('plugin:llamacpp|get_random_port')
    const loadArgs = {
      backendPath: smokeBackendPath,
      modelId: 'smoke-model',
      modelPath: smokeModelPath,
      port,
      config: { version_backend: 'b999/smoke' },
      envs: { LLAMA_API_KEY: 'smoke-key' },
      isEmbedding: false,
      timeout: 30,
    }
    const session = await invoke('plugin:llamacpp|load_llama_model', loadArgs)
    sessionPid = session && session.pid
    check('load_llama_model returns SessionInfo',
      session && session.pid > 0 && session.port === port && session.model_id === 'smoke-model' &&
      session.api_key === 'smoke-key' && session.is_embedding === false,
      JSON.stringify(session))

    const health = await fetch('http://127.0.0.1:' + port + '/health')
    check('loaded server answers HTTP', health.status === 200, String(health.status))
    const served = await (await fetch('http://127.0.0.1:' + port + '/v1/models')).json()
    check('loaded server serves model alias', served && served.data && served.data[0] && served.data[0].id === 'smoke-model', JSON.stringify(served))

    const found = await invoke('plugin:llamacpp|find_session_by_model', { modelId: 'smoke-model' })
    check('find_session_by_model round-trip', found && found.pid === sessionPid, JSON.stringify(found))
    const loaded = await invoke('plugin:llamacpp|get_loaded_models')
    check('get_loaded_models contains model', Array.isArray(loaded) && loaded.indexOf('smoke-model') !== -1, JSON.stringify(loaded))
    const allSessions = await invoke('plugin:llamacpp|get_all_sessions')
    check('get_all_sessions contains pid', Array.isArray(allSessions) && allSessions.some((s) => s.pid === sessionPid))
    check('is_process_running (server)', (await invoke('plugin:llamacpp|is_process_running', { pid: sessionPid })) === true)

    const again = await invoke('plugin:llamacpp|load_llama_model', loadArgs)
    check('reload is idempotent', again && again.pid === sessionPid, JSON.stringify(again))

    grandchildPid = parseInt(await invoke('read_file_sync', { path: smokeModelPath + '.childpid' }), 10)
    check('grandchild pid recorded', Number.isFinite(grandchildPid) && grandchildPid > 0, String(grandchildPid))
    check('is_process_running (grandchild)', (await invoke('plugin:llamacpp|is_process_running', { pid: grandchildPid })) === true)

    const unload = await invoke('plugin:llamacpp|unload_llama_model', { pid: sessionPid })
    check('unload_llama_model success', unload && unload.success === true, JSON.stringify(unload))

    let serverAlive = true
    let grandchildAlive = true
    const reapDeadline = Date.now() + 5000
    while (Date.now() < reapDeadline && (serverAlive || grandchildAlive)) {
      serverAlive = await invoke('plugin:llamacpp|is_process_running', { pid: sessionPid })
      grandchildAlive = Number.isFinite(grandchildPid)
        ? await invoke('plugin:llamacpp|is_process_running', { pid: grandchildPid })
        : false
      if (!serverAlive && !grandchildAlive) break
      await new Promise((r) => setTimeout(r, 100))
    }
    check('unload kills server process', serverAlive === false)
    check('unload kills process group (grandchild)', grandchildAlive === false)
    const loadedAfter = await invoke('plugin:llamacpp|get_loaded_models')
    check('session reaped after unload', Array.isArray(loadedAfter) && loadedAfter.indexOf('smoke-model') === -1, JSON.stringify(loadedAfter))
  } catch (error) {
    failures += 1
    lines.push('FAIL llamacpp session section threw: ' + errText(error))
    if (sessionPid) {
      try { await invoke('plugin:llamacpp|unload_llama_model', { pid: sessionPid }) } catch { /* best effort */ }
    }
  }

  // ── ax-serving stays excluded ──
  let axServingErr = null
  try {
    await invoke('plugin:llamacpp|start_ax_serving', { binaryPath: 'ax-serving', port: 3999, timeout: 1 })
  } catch (error) {
    axServingErr = errText(error)
  }
  check('start_ax_serving is unimplemented', axServingErr !== null && axServingErr.indexOf('not implemented') !== -1, axServingErr)

  // ── hardware plugin ──
  try {
    const hwInfo = await invoke('plugin:hardware|get_system_info')
    check('hw cpu shape', hwInfo && hwInfo.cpu && typeof hwInfo.cpu.name === 'string' && hwInfo.cpu.core_count > 0 && typeof hwInfo.cpu.arch === 'string' && Array.isArray(hwInfo.cpu.extensions), JSON.stringify(hwInfo && hwInfo.cpu))
    check('hw os/memory shape', typeof hwInfo.os_type === 'string' && hwInfo.os_type.length > 0 && typeof hwInfo.os_name === 'string' && hwInfo.total_memory > 0, JSON.stringify({ os_type: hwInfo.os_type, total_memory: hwInfo.total_memory }))
    check('hw gpus array', Array.isArray(hwInfo.gpus))
    const hwUsage = await invoke('plugin:hardware|get_system_usage')
    check('hw usage shape', hwUsage && typeof hwUsage.cpu === 'number' && hwUsage.total_memory > 0 && typeof hwUsage.used_memory === 'number' && Array.isArray(hwUsage.gpus), JSON.stringify(hwUsage))
  } catch (error) {
    failures += 1
    lines.push('FAIL hardware section threw: ' + errText(error))
  }

  // ── ax-engine sidecar (Phase 2 slice 4) ──
  const axDir = dataFolder + '/ax-engine'
  const axRecordPath = axDir + '/server.json'
  const axPathBinary = ${JSON.stringify(axEngineFixture.pathBinary)}
  const axOldBinary = ${JSON.stringify(axEngineFixture.oldBinary)}
  const axInnocentPid = ${JSON.stringify(axEngineFixture.innocentPid)}
  const axOrphanPid = ${JSON.stringify(axEngineFixture.orphanPid)}
  const axOrphanPort = ${JSON.stringify(axEngineFixture.orphanPort)}
  let axPid = null
  try {
    const st0 = await invoke('ax_engine_status')
    check('ax-engine initial phase missing_model', st0 && st0.phase === 'missing_model', JSON.stringify(st0))
    check('ax-engine binary resolved from PATH', st0.binarySource === 'path' && st0.binaryPath === axPathBinary, JSON.stringify({ s: st0.binarySource, p: st0.binaryPath }))
    check('ax-engine version reported', st0.version === '6.9.0', String(st0.version))

    const st1 = await invoke('ax_engine_ensure', { modelPath: '/models/smoke-a', modelId: 'smoke-a' })
    axPid = st1.pid
    check('ax-engine ensure reaches ready', st1.phase === 'ready', JSON.stringify(st1))
    check('ax-engine port probe skips occupied 31418', st1.port === 31419, String(st1.port))
    check('ax-engine server pid alive', (await invoke('plugin:llamacpp|is_process_running', { pid: axPid })) === true)

    const rec = JSON.parse(await invoke('read_file_sync', { path: axRecordPath }))
    check('server.json written (pid/port/baseURL/model/posture)',
      rec.pid === axPid && rec.port === 31419 && rec.model === 'smoke-a' &&
      typeof rec.baseURL === 'string' && typeof rec.posture === 'string' && rec.posture.indexOf('agentic') !== -1,
      JSON.stringify(rec))

    const noAuth = await fetch('http://127.0.0.1:31419/v1/models')
    check('ax-engine /v1/models requires Bearer', noAuth.status === 401, String(noAuth.status))
    const withAuth = await fetch('http://127.0.0.1:31419/v1/models', { headers: { Authorization: 'Bearer local' } })
    const modelsBody = await withAuth.json()
    check('ax-engine serves loaded model', withAuth.status === 200 && modelsBody.data.some((m) => m.id === 'smoke-a'), JSON.stringify(modelsBody))

    const chat = await fetch('http://127.0.0.1:31419/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer local' },
      body: JSON.stringify({ model: 'smoke-a', messages: [{ role: 'user', content: 'hi' }], stream: true }),
    })
    const chatText = await chat.text()
    check('ax-engine SSE chat endpoint streams', chat.status === 200 && chatText.indexOf('data:') !== -1 && chatText.indexOf('[DONE]') !== -1, chatText.slice(0, 120))

    const st2 = await invoke('ax_engine_load_model', { modelId: 'smoke-b', modelPath: '/models/smoke-b' })
    check('ax-engine load_model hot-adds model', st2.phase === 'ready' && st2.models.indexOf('smoke-b') !== -1, JSON.stringify(st2.models))
    check('ax-engine model swap without respawn (same pid)', st2.pid === axPid, 'pid ' + st2.pid + ' vs ' + axPid)

    const st3 = await invoke('ax_engine_unload_model', { modelId: 'smoke-b' })
    check('ax-engine unload_model removes model', st3.phase === 'ready' && st3.models.indexOf('smoke-b') === -1, JSON.stringify(st3.models))

    const st4 = await invoke('ax_engine_ensure', { modelPath: '/models/smoke-a', modelId: 'smoke-a', posture: { contextTokens: 32768 } })
    check('ax-engine posture change forces relaunch (new pid)', st4.phase === 'ready' && st4.pid !== axPid, 'pid ' + st4.pid + ' vs ' + axPid)
    check('ax-engine old server reaped after relaunch', (await invoke('plugin:llamacpp|is_process_running', { pid: axPid })) === false)
    axPid = st4.pid

    // Stubborn server ignores SIGTERM → stop must escalate to SIGKILL.
    const st5 = await invoke('ax_engine_ensure', { modelPath: '/models/smoke-a', modelId: 'smoke-a', posture: { contextTokens: 49152 }, envs: { AX_FAKE_IGNORE_TERM: '1' } })
    check('ax-engine relaunch with envs ready', st5.phase === 'ready' && st5.pid !== axPid, JSON.stringify(st5))
    const stop1 = await invoke('ax_engine_stop', { graceMs: 300 })
    check('ax-engine SIGTERM→SIGKILL escalation', stop1.success === true && stop1.signal === 'SIGKILL', JSON.stringify(stop1))
    check('ax-engine stubborn server dead', (await invoke('plugin:llamacpp|is_process_running', { pid: st5.pid })) === false)

    // pid-recycling protection: server.json pointing at an innocent process
    // must never cause a signal; the record is dropped as stale.
    await invoke('write_text_file', { path: axRecordPath, content: JSON.stringify({
      pid: axInnocentPid, port: 31419, baseURL: 'http://127.0.0.1:31419/v1', apiKey: 'local',
      model: 'x', modelPath: '/x', models: ['x'], posture: '{}', binaryPath: axPathBinary, version: '6.9.0', startedAt: 'x',
    }) })
    const stop2 = await invoke('ax_engine_stop')
    check('ax-engine stop refuses recycled pid', stop2.success === true && stop2.stale === true, JSON.stringify(stop2))
    check('ax-engine innocent process untouched', (await invoke('plugin:llamacpp|is_process_running', { pid: axInnocentPid })) === true)

    // Orphan reclaim: a live foreign ax-engine serve process + server.json is
    // adopted by status, then stopped via ps-cmdline verification.
    await invoke('write_text_file', { path: axRecordPath, content: JSON.stringify({
      pid: axOrphanPid, port: axOrphanPort, baseURL: 'http://127.0.0.1:' + axOrphanPort + '/v1', apiKey: 'local',
      model: 'orphan-model', modelPath: '/models/orphan', models: ['orphan-model'], posture: '{}', binaryPath: axPathBinary, version: '6.9.0', startedAt: 'x',
    }) })
    const st6 = await invoke('ax_engine_status')
    check('ax-engine orphan reclaimed via server.json', st6.phase === 'ready' && st6.pid === axOrphanPid && st6.models.indexOf('orphan-model') !== -1, JSON.stringify({ phase: st6.phase, pid: st6.pid, models: st6.models }))
    const stop3 = await invoke('ax_engine_stop')
    check('ax-engine orphan stopped via SIGTERM', stop3.success === true && stop3.signal === 'SIGTERM', JSON.stringify(stop3))

    const st7 = await invoke('ax_engine_ensure', { modelPath: '/x', modelId: 'x', binaryPath: axOldBinary })
    check('ax-engine version floor → missing_dependency', st7.phase === 'missing_dependency' && String(st7.detail).indexOf('6.9.0') !== -1, JSON.stringify(st7))
    const st8 = await invoke('ax_engine_ensure', { modelPath: '/x', modelId: 'x', binaryPath: '/nonexistent/ax-engine' })
    check('ax-engine absent binary → missing_dependency', st8.phase === 'missing_dependency', JSON.stringify({ phase: st8.phase, detail: st8.detail }))
  } catch (error) {
    failures += 1
    lines.push('FAIL ax-engine section threw: ' + errText(error))
  } finally {
    try { await invoke('ax_engine_stop') } catch { /* best effort */ }
    try { await invoke('rm', { path: axDir }) } catch { /* best effort */ }
  }

  // ── static extension wiring (Phase 3 slice 1) ──
  try {
    // The app bootstrap (ExtensionProvider) registers the three built-in
    // extensions statically under Electron; onLoad() publishes the llamacpp
    // engine into window.core.engineManager keyed by provider.
    const engineReady = await waitFor(() => {
      const core = window.core
      return !!(core && core.engineManager && core.engineManager.get && core.engineManager.get('llamacpp'))
    }, 30000)
    check('llamacpp engine registered after app bootstrap', engineReady)
    const extMgr = window.core && window.core.extensionManager
    check('download extension registered statically', !!(extMgr && extMgr.getByName && extMgr.getByName('@ax-studio/download-extension')))
    check('conversational extension registered statically', !!(extMgr && extMgr.getByName && extMgr.getByName('@ax-studio/conversational-extension')))
    if (engineReady) {
      const listed = await window.core.engineManager.get('llamacpp').list()
      check('llamacpp list() reaches registry', Array.isArray(listed), Object.prototype.toString.call(listed))
    }
  } catch (error) {
    failures += 1
    lines.push('FAIL static extensions section threw: ' + errText(error))
  }

  // ── route pruning (Phase 3 slice 2) ──
  try {
    const router = window.__ax && window.__ax.router
    check('router exposed for smoke checks', !!router)
    if (router) {
      const navAndWait = async (to, expected) => {
        await router.navigate({ to })
        return waitFor(() => router.state.location.pathname === expected, 10000)
      }
      // Slice 2b deleted the route files (and the Phase 3 redirect guard):
      // removed paths must be absent from the router's registered route tree.
      const registeredPaths = Object.keys(router.routesByPath || {})
      const removedRegistered = registeredPaths.filter((p) =>
        p === '/logs' || p === '/system-monitor' || p.indexOf('/project') === 0 ||
        p.indexOf('mcp-servers') !== -1 || p.indexOf('interface') !== -1 ||
        p.indexOf('hardware') !== -1 || p.indexOf('voice') !== -1 ||
        p.indexOf('assistant') !== -1 || p.indexOf('local-api-server') !== -1 ||
        p.indexOf('extensions') !== -1 || p.indexOf('privacy') !== -1 ||
        p.indexOf('knowledge-base') !== -1 || p.indexOf('attachments') !== -1 ||
        p.indexOf('shortcuts') !== -1 || p.indexOf('guardrails') !== -1 ||
        p.indexOf('https-proxy') !== -1 || p.indexOf('engine-settings') !== -1 ||
        p.indexOf('llm-router') !== -1 || p.indexOf('ax-bi') !== -1)
      check(
        'removed routes are not registered',
        removedRegistered.length === 0,
        JSON.stringify(removedRegistered))
      check(
        '/settings/general is registered and renders',
        await navAndWait('/settings/general', '/settings/general'),
        router.state.location.pathname)
      check(
        'product settings routes are registered',
        registeredPaths.includes('/settings/ax-engine'),
        JSON.stringify(registeredPaths))
      const generalRendered = await waitFor(() => {
        const text = document.body.textContent || ''
        return text.indexOf('App Version') !== -1 && text.indexOf('Data & Storage') !== -1
      }, 15000)
      check('/settings/general renders', generalRendered)
      const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href') || '')
      const hasHref = (frag) => hrefs.some((h) => h.indexOf(frag) !== -1)
      check('sidebar keeps hub + settings entries', hasHref('#/hub') && hasHref('#/settings/general'))
      check('sidebar has no Projects entries', !hasHref('#/project/'))
      check('sidebar has no MCP/assistants entries',
        !hasHref('#/settings/mcp-servers') && !hasHref('#/settings/assistant'))
      check('settings menu separates local products and cloud providers',
        hasHref('#/settings/ax-engine') &&
          hasHref('#/settings/providers') &&
          !hasHref('#/settings/ax-bi') &&
          !hasHref('#/settings/hardware') &&
          !hasHref('#/settings/extensions') &&
          !hasHref('#/settings/voice'))
    }
  } catch (error) {
    failures += 1
    lines.push('FAIL route pruning section threw: ' + errText(error))
  }

  // ── mlx HF-cache helpers (Phase 3 slice 4, migration matrix §2.1) ──
  // The fixture HF cache lives inside the smoke data folder, so reads go
  // through the confined FS bridge.
  try {
    const hfRoot = ${JSON.stringify(mlxFixture.hfRoot)}
    const axSnapshotDir = ${JSON.stringify(mlxFixture.axSnapshotDir)}
    const weightsSnapshotDir = ${JSON.stringify(mlxFixture.weightsSnapshotDir)}
    const emptyDir = ${JSON.stringify(mlxFixture.emptyDir)}
    const strayFile = ${JSON.stringify(mlxFixture.strayFile)}
    const outsideFile = ${JSON.stringify(mlxFixture.outsideFile)}
    const readText = async (p) => {
      const data = await invoke('read_file_sync', { path: p })
      return typeof data === 'string' ? data : new TextDecoder().decode(new Uint8Array(data))
    }

    const snapshotDir = await invoke('mlx_hf_snapshot_dir', {
      modelId: 'smoke-org/smoke-ax-model',
      revision: 'ddd444',
    })
    check('mlx_hf_snapshot_dir constructs snapshot path',
      snapshotDir === hfRoot + '/models--smoke-org--smoke-ax-model/snapshots/ddd444',
      String(snapshotDir))

    const badRevision = await invoke('mlx_hf_snapshot_dir', {
      modelId: 'smoke-org/smoke-ax-model',
      revision: '../escape',
    }).then(() => null, (e) => errText(e))
    check('mlx_hf_snapshot_dir rejects traversal revision',
      typeof badRevision === 'string' && badRevision.indexOf('invalid Hugging Face revision') !== -1,
      String(badRevision))

    const cached = await invoke('mlx_list_hf_cache_models')
    const axEntry = Array.isArray(cached) && cached.find((m) => m.model_id === 'smoke-org/smoke-ax-model')
    const weightsEntry = Array.isArray(cached) && cached.find((m) => m.model_id === 'smoke-org/smoke-weights-model')
    check('mlx_list_hf_cache_models finds both repos',
      Boolean(axEntry) && Boolean(weightsEntry), JSON.stringify(cached))
    check('mlx_list_hf_cache_models prefers manifest snapshot',
      axEntry && axEntry.has_manifest === true && axEntry.model_dir === axSnapshotDir && axEntry.size_bytes === 2048,
      JSON.stringify(axEntry))
    check('mlx_list_hf_cache_models reports weights-only repo',
      weightsEntry && weightsEntry.has_manifest === false && weightsEntry.model_dir === weightsSnapshotDir && weightsEntry.size_bytes === 4096,
      JSON.stringify(weightsEntry))
    check('mlx_list_hf_cache_models sorts by model_id and skips empty repos',
      Array.isArray(cached) && cached.length === 2 &&
        cached[0].model_id === 'smoke-org/smoke-ax-model' &&
        cached[1].model_id === 'smoke-org/smoke-weights-model',
      JSON.stringify(cached && cached.map((m) => m.model_id)))

    check('mlx_has_model_manifest true for AX snapshot',
      (await invoke('mlx_has_model_manifest', { modelDir: axSnapshotDir })) === true)
    check('mlx_has_model_manifest false for weights-only snapshot',
      (await invoke('mlx_has_model_manifest', { modelDir: weightsSnapshotDir })) === false)
    const outsideProbe = await invoke('mlx_has_model_manifest', { modelDir: dataFolder })
      .then(() => null, (e) => errText(e))
    check('mlx_has_model_manifest rejects outside-cache path',
      typeof outsideProbe === 'string' && outsideProbe.indexOf('outside Hugging Face cache') !== -1,
      String(outsideProbe))

    // Manifest-bearing snapshot wins over the newer weights-only one.
    check('mlx_resolve_model_dir prefers AX manifest snapshot',
      (await invoke('mlx_resolve_model_dir', { modelId: 'smoke-org/smoke-ax-model' })) === axSnapshotDir)
    check('mlx_resolve_model_dir falls back to weights-only snapshot',
      (await invoke('mlx_resolve_model_dir', { modelId: 'smoke-org/smoke-weights-model' })) === weightsSnapshotDir)
    const unresolved = await invoke('mlx_resolve_model_dir', { modelId: 'smoke-org/not-cached' })
      .then(() => null, (e) => errText(e))
    check('mlx_resolve_model_dir errors for unknown model',
      typeof unresolved === 'string' && unresolved.indexOf('could not resolve') !== -1,
      String(unresolved))

    // Manifest already present → validation only, no regeneration (the fake
    // bench would overwrite the 'pre-existing' marker).
    await invoke('mlx_generate_model_manifest', { modelDir: axSnapshotDir })
    check('mlx_generate_model_manifest keeps valid existing manifest',
      (await readText(axSnapshotDir + '/model-manifest.json')).indexOf('pre-existing') !== -1)

    // Weights-only dir → fake ax-engine-bench generates the manifest.
    await invoke('mlx_generate_model_manifest', { modelDir: weightsSnapshotDir })
    const generated = await readText(weightsSnapshotDir + '/model-manifest.json')
    check('mlx_generate_model_manifest generates via ax-engine-bench',
      generated.indexOf('smoke-fake-ax-engine-bench') !== -1, generated)
    check('mlx_has_model_manifest true after generation',
      (await invoke('mlx_has_model_manifest', { modelDir: weightsSnapshotDir })) === true)

    const noWeights = await invoke('mlx_generate_model_manifest', { modelDir: emptyDir })
      .then(() => null, (e) => errText(e))
    check('mlx_generate_model_manifest rejects dir without safetensors',
      typeof noWeights === 'string' && noWeights.indexOf('does not contain safetensors') !== -1,
      String(noWeights))
    const outsideGenerate = await invoke('mlx_generate_model_manifest', { modelDir: '/tmp' })
      .then(() => null, (e) => errText(e))
    check('mlx_generate_model_manifest confines to data folder + HF cache',
      typeof outsideGenerate === 'string' && outsideGenerate.indexOf('outside the AX Studio data folder') !== -1,
      String(outsideGenerate))

    // Best-effort cleanup: in-cache stray removed, outside-cache path skipped
    // (asserted main-side in the fixture finalize).
    check('mlx_cleanup_import_artifacts returns ok',
      (await invoke('mlx_cleanup_import_artifacts', { paths: [strayFile, outsideFile, ''] })) === null)
    check('mlx_cleanup_import_artifacts removed in-cache stray',
      (await invoke('exists_sync', { path: strayFile })) === false)
  } catch (error) {
    failures += 1
    lines.push('FAIL mlx section threw: ' + errText(error))
  }

  // ── updater (Phase 4): IPC surface exists but is inert outside packaged prod ──
  try {
    const updCheck = await invoke('updater_check')
    check('updater_check inert in smoke mode',
      updCheck && updCheck.enabled === false && updCheck.reason === 'smoke' && updCheck.state === 'idle',
      JSON.stringify(updCheck))
    const updDownload = await invoke('updater_download')
    check('updater_download inert in smoke mode',
      updDownload && updDownload.enabled === false && updDownload.reason === 'smoke',
      JSON.stringify(updDownload))
    const updInstall = await invoke('updater_install')
    check('updater_install inert in smoke mode',
      updInstall && updInstall.enabled === false && updInstall.reason === 'smoke',
      JSON.stringify(updInstall))
  } catch (error) {
    failures += 1
    lines.push('FAIL updater section threw: ' + errText(error))
  }

  // ── llamacpp smoke cleanup ──
  try { await invoke('plugin:llamacpp|cleanup_llama_processes') } catch { /* best effort */ }
  try { await invoke('rm', { path: dataFolder + '/llamacpp/backends/smoke' }) } catch { /* best effort */ }
  try { await invoke('rm', { path: smokeModelPath }) } catch { /* best effort */ }
  try { await invoke('rm', { path: smokeModelPath + '.childpid' }) } catch { /* best effort */ }

  return { ok: failures === 0, lines }
})()`
}
