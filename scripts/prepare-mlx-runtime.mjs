import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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

export function readMinimumMacosVersion(repoRoot = defaultRepoRoot) {
  const config = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'src-tauri', 'tauri.macos.conf.json'),
      'utf8',
    ),
  )
  const version = config.bundle?.macOS?.minimumSystemVersion
  if (typeof version !== 'string' || !/^\d+\.\d+$/u.test(version)) {
    throw new Error(
      `macOS minimumSystemVersion must contain a major.minor version, got: ${version}`,
    )
  }
  return version
}

export function macosWheelPlatform(minimumSystemVersion) {
  return `macosx_${minimumSystemVersion.replace('.', '_')}_arm64`
}

function probePythonMlx(python) {
  const source = [
    'import importlib.metadata',
    'import json',
    'import mlx',
    'def wheel_tags(name):',
    '  wheel = importlib.metadata.distribution(name).read_text("WHEEL") or ""',
    '  return [line.removeprefix("Tag: ").strip() for line in wheel.splitlines() if line.startswith("Tag: ")]',
    'print(json.dumps({',
    '  "installedVersion": importlib.metadata.version("mlx"),',
    '  "metalVersion": importlib.metadata.version("mlx-metal"),',
    '  "mlxWheelTags": wheel_tags("mlx"),',
    '  "metalWheelTags": wheel_tags("mlx-metal"),',
    '  "packageRoot": list(mlx.__path__)[0],',
    '}))',
  ].join('\n')

  const output = execFileSync(python, ['-c', source], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(output)
}

export function isTargetedMlxInstallation(
  probe,
  expectedVersion,
  wheelPlatform,
) {
  const hasPlatform = tags => Array.isArray(tags)
    && tags.some(tag => tag.endsWith(`-${wheelPlatform}`))

  return probe?.installedVersion === expectedVersion
    && probe?.metalVersion === expectedVersion
    && hasPlatform(probe.mlxWheelTags)
    && hasPlatform(probe.metalWheelTags)
}

function installTargetedMlxWheels(python, expectedVersion, wheelPlatform) {
  const wheelDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ax-studio-mlx-wheels-'),
  )

  try {
    console.log(
      `Installing MLX ${expectedVersion} wheels for ${wheelPlatform}`,
    )
    execFileSync(
      python,
      [
        '-m',
        'pip',
        'download',
        '--disable-pip-version-check',
        '--only-binary=:all:',
        '--platform',
        wheelPlatform,
        '--dest',
        wheelDirectory,
        `mlx==${expectedVersion}`,
      ],
      { stdio: 'inherit' },
    )

    const wheelNames = fs.readdirSync(wheelDirectory)
    const requiredPrefixes = [
      `mlx-${expectedVersion}-`,
      `mlx_metal-${expectedVersion}-`,
    ]
    const wheels = requiredPrefixes.map((prefix) => {
      const matches = wheelNames.filter(
        fileName => fileName.startsWith(prefix)
          && fileName.endsWith(`-${wheelPlatform}.whl`),
      )
      if (matches.length !== 1) {
        throw new Error(
          `expected one ${prefix} wheel for ${wheelPlatform}, found ${matches.length}`,
        )
      }
      return path.join(wheelDirectory, matches[0])
    })

    execFileSync(
      python,
      [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--force-reinstall',
        '--no-deps',
        ...wheels,
      ],
      { stdio: 'inherit' },
    )
  } finally {
    fs.rmSync(wheelDirectory, { recursive: true, force: true })
  }
}

export function parseMacosMinimumVersion(vtoolOutput) {
  return /platform MACOS[\s\S]*?\n\s*minos\s+([0-9.]+)/u.exec(vtoolOutput)?.[1]
}

function validateMlxRuntimeMinimum(packageRoot, minimumSystemVersion) {
  for (const fileName of ['libmlx.dylib', 'libjaccl.dylib']) {
    const file = path.resolve(packageRoot, 'lib', fileName)
    const output = execFileSync('vtool', ['-show-build', file], {
      encoding: 'utf8',
    })
    const actualMinimum = parseMacosMinimumVersion(output)
    if (actualMinimum !== minimumSystemVersion) {
      throw new Error(
        `${fileName} targets macOS ${actualMinimum || '(unknown)'}; expected ${minimumSystemVersion}`,
      )
    }
  }
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
  const expectedVersion = readPinnedMlxVersion()
  const minimumSystemVersion = readMinimumMacosVersion()
  const wheelPlatform = macosWheelPlatform(minimumSystemVersion)
  let probe
  try {
    probe = probePythonMlx(python)
  } catch {
    // The selected Python does not have MLX installed yet.
  }

  if (!isTargetedMlxInstallation(probe, expectedVersion, wheelPlatform)) {
    installTargetedMlxWheels(python, expectedVersion, wheelPlatform)
    probe = probePythonMlx(python)
  }
  if (!isTargetedMlxInstallation(probe, expectedVersion, wheelPlatform)) {
    throw new Error(
      `MLX installation does not use the required ${wheelPlatform} wheels`,
    )
  }

  validateMlxRuntimeMinimum(probe.packageRoot, minimumSystemVersion)
  const result = prepareMlxRuntime({
    expectedVersion,
    installedVersion: probe.installedVersion,
    packageRoot: probe.packageRoot,
  })
  console.log(
    `Prepared MLX ${probe.installedVersion} runtime for macOS ${minimumSystemVersion} in ${path.relative(defaultRepoRoot, result.destinationDirectory)}`,
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
