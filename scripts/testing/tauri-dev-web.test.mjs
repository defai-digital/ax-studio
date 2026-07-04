import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { createTauriDevWebCommand } from '../tauri-dev-web.mjs'

describe('tauri dev web command', () => {
  it('runs Vite from the web-app workspace with Tauri dev env', () => {
    const repoRoot = '/repo/ax-studio'
    const command = createTauriDevWebCommand({
      repoRoot,
      nodePath: '/usr/local/bin/node',
      argv: ['--host', 'localhost'],
      env: {
        PATH: '/usr/bin',
        IS_TAURI: 'false',
        IS_DEV: 'false',
      },
    })

    expect(command.command).toBe('/usr/local/bin/node')
    expect(command.cwd).toBe(join(repoRoot, 'web-app'))
    expect(command.args).toEqual([
      join(repoRoot, 'web-app', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      'localhost',
    ])
    expect(command.env.PATH).toBe('/usr/bin')
    expect(command.env.IS_TAURI).toBe('true')
    expect(command.env.IS_DEV).toBe('true')
  })
})
