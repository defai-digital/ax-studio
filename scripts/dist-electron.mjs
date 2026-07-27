// Phase 4 packaging pipeline for the Electron shell:
//   1. build:electron (web-app vite build + electron tsc)
//   2. electron-builder (electron/electron-builder.yml) with --publish never
//
// The app version is read from the ROOT package.json (single source of truth,
// same value as web-app/package.json) and
// injected via -c.extraMetadata.version — electron/package.json stays 0.0.0.
//
// Usage:
//   node scripts/dist-electron.mjs [--mac|--win] [--skip-build]
// Local unsigned mac builds:
//   CSC_IDENTITY_AUTO_DISCOVERY=false yarn dist:electron:mac
// (code signing requires a Developer ID identity in CI; without one
// electron-builder fails unless auto-discovery is disabled).
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveYarnInvocation } from './electron-runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
if (typeof version !== 'string' || version.length === 0) {
  console.error('[dist-electron] could not read version from root package.json')
  process.exit(1)
}

const run = (command, commandArgs, options = {}) => {
  console.log(`[dist-electron] $ ${command} ${commandArgs.join(' ')}`)
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', cwd: root, ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!args.includes('--skip-build')) {
  let yarn
  try {
    yarn = resolveYarnInvocation(root)
  } catch (error) {
    console.error(`[dist-electron] ${error.message}`)
    process.exit(1)
  }
  run(yarn.cmd, [...yarn.argsPrefix, 'build:electron'], yarn.spawnOptions)
}

const electronRequire = createRequire(path.join(root, 'electron', 'package.json'))
const builderCli = electronRequire.resolve('electron-builder/out/cli/cli.js')

const platformArgs = []
if (args.includes('--mac')) platformArgs.push('--mac')
if (args.includes('--win')) platformArgs.push('--win')

run(
  process.execPath,
  [
    builderCli,
    '--config',
    'electron-builder.yml',
    `-c.extraMetadata.version=${version}`,
    '--publish',
    'never',
    ...platformArgs,
    // Forward any extra flags (e.g. --dir) to electron-builder.
    ...args.filter((a) => !['--mac', '--win', '--skip-build'].includes(a)),
  ],
  { cwd: path.join(root, 'electron') }
)
