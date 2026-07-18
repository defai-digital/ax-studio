import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = ['tauri', 'build', '--features', 'desktop']
const explicitTarget = process.env.TAURI_BUILD_TARGET?.trim()
const explicitConfig = process.env.TAURI_BUILD_CONFIG?.trim()

if (explicitConfig) {
  args.push('--config', explicitConfig)
}

if (explicitTarget) {
  args.push('--target', explicitTarget)
} else if (process.platform === 'darwin') {
  // MLX (Apple Silicon only) cannot link for x86_64, so we build arm64 only.
  // The CI artifact pipeline expects aarch64-apple-darwin bundles.
  args.push('--target', 'aarch64-apple-darwin')
  // hdiutil create is broken on macOS 26 (Tahoe) for local dev — skip DMG
  // bundling unless explicitly requested or running in CI (where the runner
  // is on a stable macOS version with a working hdiutil).
  if (process.env.BUILD_DMG !== '1' && !process.env.GITHUB_ACTIONS) {
    args.push('--bundles', 'app')
  }
}

args.push(...process.argv.slice(2))

const result = spawnSync('yarn', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1)
}

// macOS post-build: re-sign the .app with the correct bundle identifier and
// hardened runtime. Tauri's default ad-hoc signature uses an auto-generated
// identifier (e.g. ax_studio-<hash>) that does not match `identifier` in
// tauri.conf.json. macOS 26's TCC silently denies events to the WKWebView
// when these disagree, so the app appears to launch but ignores input.
if (process.platform === 'darwin') {
  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(here, '..')
  const tauriDir = join(repoRoot, 'src-tauri')
  const appleSigningIdentity =
    process.env.AX_STUDIO_APPLE_CODESIGN_IDENTITY?.trim() ||
    process.env.APPLE_SIGNING_IDENTITY?.trim() ||
    ''

  if (appleSigningIdentity) {
    console.log(
      '[tauri-build] Apple signing identity is configured; keeping Tauri signed/notarized app bundle'
    )
    process.exit(0)
  }

  let identifier = 'ai.axstudio.app'
  try {
    const conf = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'))
    if (typeof conf.identifier === 'string' && conf.identifier.length > 0) {
      identifier = conf.identifier
    }
  } catch {
    // fall through with default
  }

  const entitlements = join(tauriDir, 'Entitlements.plist')
  const appPath = join(
    tauriDir,
    'target',
    'aarch64-apple-darwin',
    'release',
    'bundle',
    'macos',
    'AX Studio.app'
  )

  if (existsSync(appPath)) {
    console.log(`[tauri-build] re-signing ${appPath} with identifier ${identifier}`)
    spawnSync('xattr', ['-rc', appPath], { stdio: 'inherit' })
    const signArgs = ['--force', '--deep', '--sign', '-', '--identifier', identifier, '--options', 'runtime']
    if (existsSync(entitlements)) {
      signArgs.push('--entitlements', entitlements)
    }
    signArgs.push(appPath)
    const signResult = spawnSync('codesign', signArgs, { stdio: 'inherit' })
    if (signResult.status !== 0) {
      console.warn('[tauri-build] codesign re-sign failed; app may not receive input on macOS 26')
    }
    spawnSync('xattr', ['-rc', appPath], { stdio: 'inherit' })
  }
}

process.exit(0)
