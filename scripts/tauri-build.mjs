import { spawnSync } from 'node:child_process'

const args = ['tauri', 'build']

if (process.platform === 'darwin') {
  args.push('--target', 'universal-apple-darwin')
}

const result = spawnSync('yarn', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status ?? 1)
