#!/usr/bin/env node
// dev:electron — builds the Electron shell, starts the web-app Vite dev
// server (the shim aliases are always on), waits for the port, then launches
// Electron against it. No extra devDependencies (replaces concurrently +
// wait-on).
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  resolveElectronInvocation,
  resolveYarnInvocation,
} from './electron-runtime.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV_PORT = 31420
const DEV_URL = `http://localhost:${DEV_PORT}`

let yarn
try {
  yarn = resolveYarnInvocation(repoRoot)
} catch (error) {
  console.error(`[dev-electron] ${error.message}`)
  process.exit(1)
}

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

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', (error) => {
      reject(new Error(`${label} failed to start: ${error.message}`, { cause: error }))
    })
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${label} exited with code ${code ?? 'unknown'}`))
      }
    })
  })
}

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
await waitForExit(
  run(
    yarn.cmd,
    yarnArgs('workspace', '@ax-studio/electron', 'build'),
    yarn.spawnOptions
  ),
  'electron build'
)

// 2. Start the Vite dev server.
const vite = run(yarn.cmd, yarnArgs('workspace', '@ax-studio/web-app', 'dev'), {
  ...yarn.spawnOptions,
  env: { ...process.env, IS_DEV: 'true' },
})

vite.on('error', (error) => {
  console.error(`[dev-electron] vite failed to start: ${error.message}`)
  shutdown(1)
})
vite.on('exit', (code) => {
  console.error(`[dev-electron] vite exited with code ${code}`)
  shutdown(code ?? 1)
})

// 3. Wait for the dev server, then launch Electron.
await waitForServer(DEV_URL)
const electronInvocation = resolveElectronInvocation(repoRoot)
const electron = run(electronInvocation.cmd, [...electronInvocation.argsPrefix, '.'], {
  cwd: path.join(repoRoot, 'electron'),
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: DEV_URL,
    ELECTRON_ENABLE_LOGGING: '1',
  },
})

electron.on('error', (error) => {
  console.error(`[dev-electron] electron failed to start: ${error.message}`)
  shutdown(1)
})
electron.on('exit', (code) => shutdown(code ?? 0))
