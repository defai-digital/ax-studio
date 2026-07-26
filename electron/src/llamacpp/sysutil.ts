// Process environment helpers — port of the relevant parts of
// src-tauri/utils/src/system.rs (add_cuda_paths, setup_library_path,
// binary_requires_cuda). Operates on a plain env map for child_process.spawn.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function prependEnv(env: NodeJS.ProcessEnv, key: string, value: string, delimiter: string): void {
  const current = env[key]
  env[key] = current && current.length > 0 ? `${value}${delimiter}${current}` : value
}

/**
 * Prepend the binary's own directory to the dynamic-library search path
 * (port of `setup_library_path`). On Windows also returns the directory to
 * use as the child's working directory.
 */
export function setupLibraryPath(
  libraryPath: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (!libraryPath) return undefined
  if (process.platform === 'linux') {
    prependEnv(env, 'LD_LIBRARY_PATH', libraryPath, ':')
    return undefined
  }
  if (process.platform === 'win32') {
    const normalized = libraryPath.startsWith('\\\\?\\') ? libraryPath.slice(4) : libraryPath
    prependEnv(env, 'PATH', normalized, ';')
    return normalized
  }
  if (process.platform === 'darwin') {
    prependEnv(env, 'DYLD_LIBRARY_PATH', libraryPath, ':')
    return undefined
  }
  return undefined
}

/** Port of `binary_requires_cuda` (Windows string scan / Linux ldd). */
export function binaryRequiresCuda(binPath: string): boolean {
  if (process.platform === 'win32') {
    try {
      const contents = fs.readFileSync(binPath).toString('latin1')
      return ['cudart', 'cublas', 'cufft', 'curand', 'cusparse', 'cusolver', 'cudnn'].some((needle) =>
        contents.includes(needle),
      )
    } catch {
      return false
    }
  }
  if (process.platform === 'linux') {
    try {
      const stdout = execFileSync('ldd', [binPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      return ['libcudart', 'libcublas', 'libcufft', 'libcurand', 'libcusparse', 'libcusolver', 'libcudnn'].some(
        (needle) => stdout.includes(needle),
      )
    } catch {
      // fall through to the string scan
    }
    try {
      const contents = fs.readFileSync(binPath).toString('latin1')
      return ['libcudart', 'libcublas', 'libcufft'].some((needle) => contents.includes(needle))
    } catch {
      return false
    }
  }
  return false
}

/** Port of `add_cuda_paths`: returns true when CUDA paths were found and injected. */
export function addCudaPaths(env: NodeJS.ProcessEnv): boolean {
  if (process.platform === 'win32') return addCudaPathsWindows(env)
  if (process.platform === 'linux') return addCudaPathsLinux(env)
  return false
}

function addCudaPathsWindows(env: NodeJS.ProcessEnv): boolean {
  const cudaPaths = new Set<string>()

  const cudaPathEnv = process.env.CUDA_PATH
  if (cudaPathEnv) {
    const binPath = `${cudaPathEnv}\\bin`
    if (fs.existsSync(binPath)) cudaPaths.add(binPath)
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CUDA_PATH_V') && value) {
      const binPath = `${value}\\bin`
      if (fs.existsSync(binPath)) cudaPaths.add(binPath)
    }
  }
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const cudaToolkitBase = `${programFiles}\\NVIDIA GPU Computing Toolkit\\CUDA`
  try {
    for (const entry of fs.readdirSync(cudaToolkitBase, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const binPath = path.join(cudaToolkitBase, entry.name, 'bin')
      if (fs.existsSync(binPath)) cudaPaths.add(binPath)
    }
  } catch {
    // no CUDA toolkit directory
  }

  if (cudaPaths.size === 0) return false
  const paths = [...cudaPaths].sort()
  const current = (env.PATH ?? '').replace(/;+$/, '')
  env.PATH = `${paths.join(';')};${current}`
  return true
}

function addCudaPathsLinux(env: NodeJS.ProcessEnv): boolean {
  const cudaLibPaths = new Set<string>()
  const cudaBinPaths = new Set<string>()

  const cudaHome = process.env.CUDA_HOME ?? process.env.CUDA_PATH
  if (cudaHome) {
    for (const sub of ['lib64', 'lib', 'bin']) {
      const p = path.join(cudaHome, sub)
      if (!fs.existsSync(p)) continue
      if (sub === 'bin') cudaBinPaths.add(p)
      else cudaLibPaths.add(p)
    }
  }

  const commonPaths = [
    '/usr/local/cuda/lib64',
    '/usr/local/cuda/lib',
    '/usr/lib/cuda/lib64',
    '/usr/lib/cuda/lib',
    '/opt/cuda/lib64',
    '/opt/cuda/lib',
    '/usr/lib/x86_64-linux-gnu',
    '/usr/lib/x86_64-linux-gnu/nvidia',
  ]
  for (const p of commonPaths) {
    if (fs.existsSync(p)) cudaLibPaths.add(p)
  }

  try {
    for (const entry of fs.readdirSync('/usr/local', { withFileTypes: true })) {
      if (!entry.name.startsWith('cuda-')) continue
      for (const sub of ['lib64', 'lib', 'bin']) {
        const p = path.join('/usr/local', entry.name, sub)
        if (!fs.existsSync(p)) continue
        if (sub === 'bin') cudaBinPaths.add(p)
        else cudaLibPaths.add(p)
      }
    }
  } catch {
    // /usr/local unreadable
  }

  let modified = false
  if (cudaLibPaths.size > 0) {
    const libs = [...cudaLibPaths].sort()
    const current = (env.LD_LIBRARY_PATH ?? '').replace(/:+$/, '')
    env.LD_LIBRARY_PATH = current ? `${libs.join(':')}:${current}` : libs.join(':')
    modified = true
  }
  if (cudaBinPaths.size > 0) {
    const bins = [...cudaBinPaths].sort()
    const current = (env.PATH ?? '').replace(/:+$/, '')
    env.PATH = current ? `${bins.join(':')}:${current}` : bins.join(':')
    modified = true
  }
  return modified
}
