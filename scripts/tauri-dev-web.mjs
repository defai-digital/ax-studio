import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function getRepoRoot() {
  return resolve(fileURLToPath(new URL('..', import.meta.url)))
}

export function createTauriDevWebCommand({
  repoRoot = getRepoRoot(),
  nodePath = process.execPath,
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  const webAppDir = join(repoRoot, 'web-app')
  const viteEntry = join(webAppDir, 'node_modules', 'vite', 'bin', 'vite.js')

  return {
    command: nodePath,
    args: [viteEntry, ...argv],
    cwd: webAppDir,
    env: {
      ...env,
      IS_TAURI: 'true',
      IS_DEV: 'true',
    },
    viteEntry,
  }
}

export function runTauriDevWeb(options = {}) {
  const commandConfig = createTauriDevWebCommand(options)

  if (!existsSync(commandConfig.viteEntry)) {
    console.error(
      [
        '[tauri-dev-web] Missing local Vite entry:',
        commandConfig.viteEntry,
        '',
        'Run dependency setup first, then retry Tauri dev.',
      ].join('\n')
    )
    return 1
  }

  const child = spawn(commandConfig.command, commandConfig.args, {
    cwd: commandConfig.cwd,
    env: commandConfig.env,
    stdio: 'inherit',
  })

  child.on('error', (error) => {
    console.error(error)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })

  return 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const exitCode = runTauriDevWeb()
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}
