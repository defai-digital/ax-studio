#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRepoRoot = path.resolve(import.meta.dirname, '..')
const requiredRuntimeFiles = [
  'libmlx.dylib',
  'libjaccl.dylib',
  'mlx.metallib',
]

export function readPinnedMlxVersion(repoRoot = defaultRepoRoot) {
  const version = fs.readFileSync(path.join(repoRoot, 'mlx.version'), 'utf8').trim()
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`mlx.version must contain a semantic version, got: ${version}`)
  }
  return version
}

function probePythonMlx(python) {
  const source = [
    'import importlib.metadata',
    'import json',
    'import mlx',
    'print(json.dumps({',
    '  "version": importlib.metadata.version("mlx"),',
    '  "packageRoot": list(mlx.__path__)[0],',
    '}))',
  ].join('\n')

  const output = execFileSync(python, ['-c', source], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return JSON.parse(output)
}

export function prepareMlxRuntime({
  repoRoot = defaultRepoRoot,
  expectedVersion = readPinnedMlxVersion(repoRoot),
  installedVersion,
  packageRoot,
}) {
  if (installedVersion !== expectedVersion) {
    throw new Error(
      `installed MLX ${installedVersion || '(unknown)'} does not match pinned ${expectedVersion}`,
    )
  }
  if (typeof packageRoot !== 'string' || packageRoot.trim() === '') {
    throw new Error('MLX package root is missing')
  }

  const sourceDirectory = path.resolve(packageRoot, 'lib')
  const destinationDirectory = path.join(repoRoot, 'src-tauri', 'resources', 'lib')
  fs.mkdirSync(destinationDirectory, { recursive: true })

  for (const fileName of requiredRuntimeFiles) {
    const source = path.join(sourceDirectory, fileName)
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`pinned MLX runtime file is missing: ${source}`)
    }
    fs.copyFileSync(source, path.join(destinationDirectory, fileName))
  }

  return { destinationDirectory, files: [...requiredRuntimeFiles] }
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('MLX runtime preparation is only required on macOS.')
    return
  }

  const python =
    process.env.PYO3_PYTHON?.trim()
    || process.env.PYTHON?.trim()
    || 'python3'
  const probe = probePythonMlx(python)
  const result = prepareMlxRuntime({
    installedVersion: probe.version,
    packageRoot: probe.packageRoot,
  })
  console.log(
    `Prepared MLX ${probe.version} runtime in ${path.relative(defaultRepoRoot, result.destinationDirectory)}`,
  )
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  try {
    main()
  } catch (error) {
    console.error(`MLX runtime preparation failed: ${error.message}`)
    process.exitCode = 1
  }
}
