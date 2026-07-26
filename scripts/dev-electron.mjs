#!/usr/bin/env node
// dev:electron — builds the Electron shell, starts the web-app Vite dev
// server (the shim aliases are always on), waits for the port, then launches
// Electron against it. No extra devDependencies (replaces concurrently +
// wait-on).
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV_PORT = 31420
const DEV_URL = `http://localhost:${DEV_PORT}`

// Locate a runnable Yarn 4: prefer a repo-pinned release, then npm_execpath
// (Yarn sets it when this script runs via `yarn dev:electron`; it may be an
// extensionless shim, which is spawned directly).
import fs from 'node:fs'

function resolveYarn() {
  const releasesDir = path.join(repoRoot, '.yarn', 'releases')
  if (fs.existsSync(releasesDir)) {
    const release = fs.readdirSync(releasesDir).find((f) => /^yarn-.*\.cjs$/.test(f))
    if (release) {
      const releasePath = path.join(releasesDir, release)
      return { cmd: process.execPath, argsPrefix: [releasePath] }
    }
  }
  const execPath = process.env.npm_execpath
  if (execPath && /\.(js|cjs|mjs)$/.test(execPath)) {
    return { cmd: process.execPath, argsPrefix: [execPath] }
  }
  if (execPath && fs.existsSync(execPath)) {
    return { cmd: execPath, argsPrefix: [] }
  }
  console.error('[dev-electron] could not locate yarn; run via `yarn dev:electron`')
  process.exit(1)
}

const yarn = resolveYarn()
const yarnArgs = (...args) => [...yarn.argsPrefix, ...args]

const children = []
function run(cmd, args, options = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', cwd: repoRoot, ...options })
  children.push(child)
  return child
}

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(url, { method: 'HEAD' })
      if (response.ok) return
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${url}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

// 1. Build the Electron main/preload.
await new Promise((resolve, reject) => {
  run(yarn.cmd, yarnArgs('workspace', '@ax-studio/electron', 'build'))
    .on('exit', (code) => (code === 0 ? resolve() : reject(new Error('electron build failed'))))
})

// 2. Start the Vite dev server.
const vite = run(yarn.cmd, yarnArgs('workspace', '@ax-studio/web-app', 'dev'), {
  env: { ...process.env, IS_DEV: 'true' },
})

vite.on('exit', (code) => {
  console.error(`[dev-electron] vite exited with code ${code}`)
  shutdown(code ?? 1)
})

// 3. Wait for the dev server, then launch Electron.
await waitForServer(DEV_URL)
const electronBin = path.join(
  repoRoot,
  'electron',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
)
const electron = run(electronBin, ['.'], {
  cwd: path.join(repoRoot, 'electron'),
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: DEV_URL,
    ELECTRON_ENABLE_LOGGING: '1',
  },
})

electron.on('exit', (code) => shutdown(code ?? 0))
