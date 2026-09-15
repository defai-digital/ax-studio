import { afterEach, describe, expect, it, vi } from 'vitest'

// `promisify(execFile)` resolves `{ stdout, stderr }` through execFile's custom
// promisify hook, so the mock must expose it (a plain callback mock resolves
// only `stdout`).
const mock = vi.hoisted(() => {
  const calls = []
  const responses = new Map()
  const fn = vi.fn()
  fn[Symbol.for('nodejs.util.promisify.custom')] = async (file, args) => {
    calls.push({ file, args })
    const key = args.join(' ')
    if (responses.has(key)) return { stdout: responses.get(key), stderr: '' }
    const error = new Error(`unknown command: ${args[0]}`)
    error.stdout = ''
    error.stderr = `unknown command: ${args[0]}`
    throw error
  }
  return { calls, responses, fn }
})

vi.mock('node:child_process', () => ({ execFile: mock.fn }))
vi.mock('../../electron/src/ax-engine/paths.ts', () => ({
  managedBinaryPath: () => '/managed/ax-engine',
}))
vi.mock('electron', () => ({ app: {} }))

const { parseAxEngineVersion, parseAxEngineDoctorVersion, queryAxEngineVersion } =
  await import('../../electron/src/ax-engine/dependency.ts')

// Real `ax-engine doctor --json` shape (Homebrew v7.3.1).
const DOCTOR_JSON = JSON.stringify({
  checks: [],
  host: { os: 'macos', os_version: '26.6.2' },
  install: { cwd: '/Users/devop', mode: 'installed_tools', version: '7.3.1' },
  result: 'ready',
  schema_version: 'ax.engine.doctor.v1',
})

function respond(map) {
  mock.responses.clear()
  for (const [key, value] of Object.entries(map)) mock.responses.set(key, value)
}

afterEach(() => {
  mock.calls.length = 0
  mock.responses.clear()
})

describe('ax-engine version resolution', () => {
  it('parses install.version out of doctor --json', () => {
    expect(parseAxEngineVersion('ax-engine 6.13.1')).toBe('6.13.1')
    expect(parseAxEngineDoctorVersion(DOCTOR_JSON)).toBe('7.3.1')
    expect(parseAxEngineDoctorVersion('not json')).toBeNull()
    expect(parseAxEngineDoctorVersion('{"install":{}}')).toBeNull()
  })

  it('falls back to doctor --json when --version is unsupported', async () => {
    respond({ 'doctor --json': DOCTOR_JSON })
    await expect(
      queryAxEngineVersion('/opt/homebrew/bin/ax-engine')
    ).resolves.toBe('7.3.1')
    expect(mock.calls.map((call) => call.args)).toEqual([
      ['--version'],
      ['doctor', '--json'],
    ])
  })

  it('prefers --version when the build supports it', async () => {
    respond({ '--version': 'ax-engine 6.13.1\n' })
    await expect(queryAxEngineVersion('/bin/ax-engine')).resolves.toBe('6.13.1')
    expect(mock.calls.map((call) => call.args)).toEqual([['--version']])
  })

  it('returns null when neither probe yields a semver', async () => {
    respond({ 'doctor --json': '{"install":{"mode":"installed_tools"}}' })
    await expect(queryAxEngineVersion('/bin/ax-engine')).resolves.toBeNull()
  })
})
