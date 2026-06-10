import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = ['tauri', 'build']

if (process.platform === 'darwin') {
  args.push('--target', 'universal-apple-darwin')
  // hdiutil create is broken on macOS 26 (Tahoe) — skip DMG bundling by
  // default. Set BUILD_DMG=1 on a stable macOS host for a distributable .dmg.
  if (process.env.BUILD_DMG !== '1') {
    args.push('--bundles', 'app')
  }
}

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
    'universal-apple-darwin',
    'release',
    'bundle',
    'macos',
    'Ax-Studio.app'
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
