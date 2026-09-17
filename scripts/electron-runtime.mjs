import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Resolve a `yarn` shim/executable from a PATH-style string. The release
 * packaging jobs invoke `node scripts/dist-electron.mjs` directly, so there is
 * no Corepack/npm execution context — but `corepack enable` still placed a
 * `yarn` shim on PATH. Windows ships `.cmd`/`.exe` shims; POSIX a `yarn`
 * executable/symlink.
 */
function findYarnOnPath(envPath, platform) {
  if (!envPath) return undefined
  const names = platform === 'win32' ? ['yarn.cmd', 'yarn.exe', 'yarn'] : ['yarn']
  for (const directory of envPath.split(path.delimiter)) {
    if (!directory) continue
    for (const name of names) {
      const candidate = path.join(directory, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

export function resolveYarnInvocation(
  repoRoot,
  {
    nodePath = process.execPath,
    npmExecPath = process.env.npm_execpath,
    corepackRoot = process.env.COREPACK_ROOT,
    platform = process.platform,
    pathEnv = process.env.PATH ?? process.env.Path,
  } = {}
) {
  const releasesDir = path.join(repoRoot, '.yarn', 'releases')
  if (existsSync(releasesDir)) {
    const release = readdirSync(releasesDir).find((file) => /^yarn-.*\.cjs$/.test(file))
    if (release) {
      return {
        cmd: nodePath,
        argsPrefix: [path.join(releasesDir, release)],
      }
    }
  }

  const corepackYarn = corepackRoot
    ? path.join(corepackRoot, 'dist', 'yarn.js')
    : undefined
  if (corepackYarn && existsSync(corepackYarn)) {
    return { cmd: nodePath, argsPrefix: [corepackYarn] }
  }

  if (npmExecPath && existsSync(npmExecPath)) {
    if (/\.(?:c|m)?js$/i.test(npmExecPath)) {
      return { cmd: nodePath, argsPrefix: [npmExecPath] }
    }

    if (platform !== 'win32') {
      return { cmd: npmExecPath, argsPrefix: [] }
    }

    const windowsShim = `${npmExecPath}.cmd`
    if (existsSync(windowsShim)) {
      return {
        cmd: windowsShim,
        argsPrefix: [],
        spawnOptions: { shell: true },
      }
    }
  }

  // Direct `node scripts/dist-electron.mjs` invocation (the release workflow)
  // has no npm/Corepack execution context; fall back to the `yarn` shim that
  // `corepack enable` places on PATH. This is what makes the macOS/Windows
  // "Build and package" steps find Yarn without wrapping them in `yarn`.
  const yarnOnPath = findYarnOnPath(pathEnv, platform)
  if (yarnOnPath) {
    if (platform !== 'win32') {
      return { cmd: yarnOnPath, argsPrefix: [] }
    }
    return { cmd: yarnOnPath, argsPrefix: [], spawnOptions: { shell: true } }
  }

  throw new Error('could not locate yarn; run this command through `yarn`')
}

export function resolveElectronInvocation(repoRoot, { nodePath = process.execPath } = {}) {
  const electronCli = path.join(repoRoot, 'electron', 'node_modules', 'electron', 'cli.js')
  if (!existsSync(electronCli)) {
    throw new Error('could not locate Electron; run `yarn install --immutable`')
  }

  return { cmd: nodePath, argsPrefix: [electronCli] }
}
