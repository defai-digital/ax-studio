import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

export function resolveYarnInvocation(
  repoRoot,
  {
    nodePath = process.execPath,
    npmExecPath = process.env.npm_execpath,
    corepackRoot = process.env.COREPACK_ROOT,
    platform = process.platform,
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

  throw new Error('could not locate yarn; run this command through `yarn`')
}

export function resolveElectronInvocation(repoRoot, { nodePath = process.execPath } = {}) {
  const electronCli = path.join(repoRoot, 'electron', 'node_modules', 'electron', 'cli.js')
  if (!existsSync(electronCli)) {
    throw new Error('could not locate Electron; run `yarn install --immutable`')
  }

  return { cmd: nodePath, argsPrefix: [electronCli] }
}
