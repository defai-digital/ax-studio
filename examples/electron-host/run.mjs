// Launcher: resolves the electron binary and runs this app with it.
// A standalone host project would just declare `electron` as a devDependency
// and use `"start": "electron ."` — this indirection exists because the
// example lives inside the ax-studio Yarn workspace, where the electron
// binary already ships with @ax-studio/electron (and Yarn cannot link the
// Electron.app bundle into two workspaces).
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

let electronPath
try {
  // Host's own electron (standalone project layout).
  electronPath = require('electron')
} catch {
  // Monorepo layout: borrow the binary from @ax-studio/electron.
  const bridgeRequire = createRequire(require.resolve('@ax-studio/electron/package.json'))
  electronPath = bridgeRequire('electron')
}

const appDir = path.dirname(fileURLToPath(import.meta.url))
const result = spawnSync(electronPath, [appDir, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(result.status ?? (result.signal ? 1 : 0))
