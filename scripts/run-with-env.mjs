import { spawn } from 'node:child_process'

const env = { ...process.env }
const args = [...process.argv.slice(2)]

while (args.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) {
  const assignment = args.shift()
  const separatorIndex = assignment.indexOf('=')
  env[assignment.slice(0, separatorIndex)] = assignment.slice(separatorIndex + 1)
}

if (args.length === 0) {
  console.error('Usage: node scripts/run-with-env.mjs KEY=value command [args...]')
  process.exit(1)
}

const child = spawn(args[0], args.slice(1), {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
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
