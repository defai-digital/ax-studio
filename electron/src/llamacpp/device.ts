// Device enumeration via the backend binary — port of
// src-tauri/plugins/tauri-plugin-llamacpp/src/device.rs.
import { execFile } from 'node:child_process'
import path from 'node:path'
import { LlamacppError } from './error.js'
import { isDangerousProcessEnvKey, validateBinaryPath } from './path.js'
import { addCudaPaths, binaryRequiresCuda, setupLibraryPath } from './sysutil.js'

export interface DeviceInfo {
  id: string
  name: string
  mem: number
  free: number
}

export async function getDevicesFromBackend(
  backendPath: string,
  envs: Record<string, string>,
  trustedRoots: string[],
): Promise<DeviceInfo[]> {
  const binPath = validateBinaryPath(backendPath, trustedRoots, ['llama-server', 'llama-server.exe'])

  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(envs)) {
    if (isDangerousProcessEnvKey(key)) continue
    env[key] = value
  }
  const cudaFound = addCudaPaths(env)
  if (!cudaFound && binaryRequiresCuda(binPath)) {
    console.warn('[llamacpp] backend appears to require CUDA, but CUDA was not found.')
  }
  const cwd = setupLibraryPath(path.dirname(binPath), env)

  const output = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      execFile(
        binPath,
        ['--list-devices'],
        { env, cwd, timeout: 30_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const timedOut = error !== null && (error as { killed?: boolean }).killed === true
          if (timedOut) {
            reject(new LlamacppError('INTERNAL_ERROR', 'Timeout waiting for device list'))
            return
          }
          const code = typeof error?.code === 'number' ? error.code : error ? -1 : 0
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code })
        },
      )
    },
  )

  if (output.code !== 0) {
    console.error(`[llamacpp] llama-server --list-devices failed: ${output.stderr}`)
    throw LlamacppError.fromStderr(output.stderr)
  }

  return parseDeviceOutput(output.stdout)
}

function parseDeviceOutput(output: string): DeviceInfo[] {
  const devices: DeviceInfo[] = []
  let foundDevicesSection = false

  for (const raw of output.split('\n')) {
    if (raw.trim() === 'Available devices:') {
      foundDevicesSection = true
      continue
    }
    if (!foundDevicesSection) continue
    const line = raw.trim()
    if (line.length === 0) continue
    const device = parseDeviceLine(line)
    if (device) devices.push(device)
  }

  if (devices.length === 0 && !foundDevicesSection) {
    throw new LlamacppError(
      'DEVICE_LIST_PARSE_FAILED',
      "Could not find 'Available devices:' section in the backend output.",
      output,
    )
  }
  return devices
}

function parseDeviceLine(line: string): DeviceInfo | null {
  // Expected: "Vulkan0: Intel(R) Arc(tm) A750 Graphics (DG2) (8128 MiB, 8128 MiB free)"
  const colonIndex = line.indexOf(':')
  if (colonIndex === -1) return null

  const id = line.slice(0, colonIndex).trim()
  const rest = line.slice(colonIndex + 1).trim()

  const memoryMatch = findMemoryPattern(rest)
  if (!memoryMatch) return null

  const name = rest.slice(0, memoryMatch.start).trim()
  const memoryParts = memoryMatch.content.split(',')
  if (memoryParts.length < 2) return null

  const totalMem = parseMemoryValue(memoryParts[0].trim())
  const freeMem = parseMemoryValue(memoryParts[1].trim())
  if (totalMem === null || freeMem === null) return null

  return { id, name, mem: totalMem, free: freeMem }
}

function findMemoryPattern(text: string): { start: number; content: string } | null {
  let lastMatch: { start: number; content: string } | null = null
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '(') continue
    const closePos = text.indexOf(')', i + 1)
    if (closePos === -1) continue
    const content = text.slice(i + 1, closePos)
    if (isMemoryPattern(content)) {
      lastMatch = { start: i, content }
    }
  }
  return lastMatch
}

function isMemoryPattern(content: string): boolean {
  if (!content.includes('MiB') || !content.includes('free') || !content.includes(',')) {
    return false
  }
  const parts = content.split(',')
  if (parts.length !== 2) return false
  return parts.every((part) => {
    const trimmed = part.trim()
    const firstWord = trimmed.split(/\s+/)[0]
    return firstWord !== undefined && /^-?\d+$/.test(firstWord) && trimmed.includes('MiB')
  })
}

function parseMemoryValue(memStr: string): number | null {
  const firstWord = memStr.split(/\s+/)[0]
  if (firstWord === undefined || firstWord === '') return null
  const value = Number.parseInt(firstWord, 10)
  return Number.isFinite(value) ? value : null
}
