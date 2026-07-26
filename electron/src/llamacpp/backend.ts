// Backend version management — port of
// src-tauri/plugins/tauri-plugin-llamacpp/src/backend.rs.
import fs from 'node:fs'
import path from 'node:path'

export interface BackendInfo {
  version: string
  backend: string
}

export interface BackendFeatures {
  cuda11: boolean
  cuda12: boolean
  cuda13: boolean
  vulkan: boolean
}

export interface SupportedFeatures extends BackendFeatures {
  avx: boolean
  avx2: boolean
  avx512: boolean
}

export interface GpuInfoInput {
  driver_version: string
  nvidia_info?: { compute_capability: string } | null
  vulkan_info?: { api_version: string } | null
}

export interface BestBackendResult {
  backend_string: string
  version: string
  backend_type: string
}

export interface UpdateCheckResult {
  update_needed: boolean
  new_version: string
  target_backend?: string
}

export interface SettingUpdateResult {
  backend_type_updated: boolean
  effective_backend_type?: string
  needs_backend_installation: boolean
  version?: string
  backend?: string
}

/** Port of `map_old_backend_to_new`. */
export function mapOldBackendToNew(oldBackend: string): string {
  const isWindows = oldBackend.startsWith('win-')
  const isLinux = oldBackend.startsWith('linux-')
  const osPrefix = isWindows ? 'win-' : isLinux ? 'linux-' : ''

  const archSuffix = oldBackend.includes('-arm64') ? 'arm64' : 'x64'
  const isX64 = archSuffix === 'x64'
  const suffix = isX64 ? 'x64' : archSuffix

  if (oldBackend.includes('cuda-cu12.0')) {
    return `${osPrefix}cuda-12-common_cpus-${suffix}`
  }
  if (oldBackend.includes('cuda-cu11.7')) {
    return `${osPrefix}cuda-11-common_cpus-${suffix}`
  }
  if (oldBackend.includes('vulkan')) {
    if (oldBackend.includes('vulkan-common_cpus')) return oldBackend
    return `${osPrefix}vulkan-common_cpus-${suffix}`
  }

  const isOldCpuBackend =
    oldBackend.includes('avx512') ||
    oldBackend.includes('avx2') ||
    oldBackend.includes('avx-x64') ||
    oldBackend.includes('noavx-x64')

  if (isOldCpuBackend) {
    return `${osPrefix}common_cpus-${suffix}`
  }

  return oldBackend
}

/** Check for llama-server in build/bin, ggml-org layout, or the backend root. */
function isBackendInstalled(backendDir: string): boolean {
  try {
    if (!fs.statSync(backendDir).isDirectory()) return false
  } catch {
    return false
  }
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'

  if (fs.existsSync(path.join(backendDir, 'build', 'bin', exeName))) return true

  // ggml-org structure: llama-{version-dir-name}/llama-server
  const versionName = path.basename(path.dirname(backendDir))
  if (versionName && fs.existsSync(path.join(backendDir, `llama-${versionName}`, exeName))) {
    return true
  }

  return fs.existsSync(path.join(backendDir, exeName))
}

/** Port of `get_local_installed_backends`. */
export function getLocalInstalledBackends(backendsDir: string): BackendInfo[] {
  const local: BackendInfo[] = []
  if (!fs.existsSync(backendsDir)) return local

  for (const versionEntry of fs.readdirSync(backendsDir, { withFileTypes: true })) {
    const versionPath = path.join(backendsDir, versionEntry.name)
    let isDir = versionEntry.isDirectory()
    if (versionEntry.isSymbolicLink()) {
      try {
        isDir = fs.statSync(versionPath).isDirectory()
      } catch {
        isDir = false
      }
    }
    if (!isDir) continue

    for (const backendEntry of fs.readdirSync(versionPath)) {
      const backendPath = path.join(versionPath, backendEntry)
      if (isBackendInstalled(backendPath)) {
        local.push({ version: versionEntry.name, backend: backendEntry })
      }
    }
  }
  return local
}

/** Port of `determine_supported_backends`. */
export function determineSupportedBackends(
  osType: string,
  arch: string,
  features: BackendFeatures,
): string[] {
  const sysType = `${osType}-${arch}`
  const supported: string[] = []

  switch (sysType) {
    case 'windows-x86_64':
      supported.push('win-common_cpus-x64')
      if (features.cuda11) supported.push('win-cuda-11-common_cpus-x64')
      if (features.cuda12) supported.push('win-cuda-12-common_cpus-x64')
      if (features.cuda13) supported.push('win-cuda-13-common_cpus-x64')
      if (features.vulkan) supported.push('win-vulkan-common_cpus-x64')
      break
    case 'windows-aarch64':
    case 'windows-arm64':
      supported.push('win-arm64')
      break
    case 'linux-x86_64':
    case 'linux-x86':
      supported.push('linux-common_cpus-x64')
      if (features.cuda11) supported.push('linux-cuda-11-common_cpus-x64')
      if (features.cuda12) supported.push('linux-cuda-12-common_cpus-x64')
      if (features.cuda13) supported.push('linux-cuda-13-common_cpus-x64')
      if (features.vulkan) supported.push('linux-vulkan-common_cpus-x64')
      break
    case 'linux-aarch64':
    case 'linux-arm64':
      supported.push('linux-arm64')
      break
    case 'macos-x86_64':
    case 'macos-x86':
      supported.push('macos-x64')
      break
    case 'macos-aarch64':
    case 'macos-arm64':
      supported.push('macos-arm64')
      break
    default:
      throw new Error(`Unsupported system type: ${sysType}`)
  }

  return supported
}

/** Port of `list_supported_backends` (merge + dedupe + sort). */
export function listSupportedBackends(
  remoteBackendVersions: BackendInfo[],
  localBackendVersions: BackendInfo[],
): BackendInfo[] {
  const mergedMap = new Map<string, BackendInfo>()
  for (const entry of remoteBackendVersions) {
    mergedMap.set(`${entry.version}|${entry.backend}`, entry)
  }
  for (const entry of localBackendVersions) {
    mergedMap.set(`${entry.version}|${entry.backend}`, entry)
  }
  const merged = [...mergedMap.values()]
  // Rust sorts with `str::cmp` (byte order); localeCompare is locale-aware.
  merged.sort((a, b) => {
    if (a.version !== b.version) return a.version < b.version ? 1 : -1
    if (a.backend === b.backend) return 0
    return a.backend < b.backend ? -1 : 1
  })
  return merged
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.')
  const parts2 = v2.split('.')
  const maxLen = Math.max(parts1.length, parts2.length)
  for (let i = 0; i < maxLen; i++) {
    const num1 = Number.parseInt(parts1[i] ?? '', 10) || 0
    const num2 = Number.parseInt(parts2[i] ?? '', 10) || 0
    if (num1 < num2) return -1
    if (num1 > num2) return 1
  }
  return 0
}

/** Port of `get_supported_features`. */
export function getSupportedFeatures(
  osType: string,
  cpuExtensions: string[],
  gpus: GpuInfoInput[],
): SupportedFeatures {
  const features: SupportedFeatures = {
    avx: cpuExtensions.includes('avx'),
    avx2: cpuExtensions.includes('avx2'),
    avx512: cpuExtensions.includes('avx512'),
    cuda11: false,
    cuda12: false,
    cuda13: false,
    vulkan: false,
  }

  let minDrivers: [string, string, string] | null = null
  // https://docs.nvidia.com/deploy/cuda-compatibility/#cuda-11-and-later-defaults-to-minor-version-compatibility
  if (osType === 'linux') minDrivers = ['450.80.02', '525.60.13', '580']
  else if (osType === 'windows') minDrivers = ['452.39', '527.41', '580']
  if (!minDrivers) return features

  const [minCuda11Driver, minCuda12Driver, minCuda13Driver] = minDrivers
  for (const gpu of gpus) {
    if (gpu.nvidia_info != null) {
      if (compareVersions(gpu.driver_version, minCuda11Driver) >= 0) features.cuda11 = true
      if (compareVersions(gpu.driver_version, minCuda12Driver) >= 0) features.cuda12 = true
      if (compareVersions(gpu.driver_version, minCuda13Driver) >= 0) features.cuda13 = true
    }
    if (gpu.vulkan_info != null) features.vulkan = true
  }
  return features
}

const CUDA_LIB_LOOKUP: Record<string, string> = {
  'windows-11.7': 'cudart64_110.dll',
  'windows-12.0': 'cudart64_12.dll',
  'windows-13.0': 'cudart64_13.dll',
  'linux-11.7': 'libcudart.so.11.0',
  'linux-12.0': 'libcudart.so.12',
  'linux-13.0': 'libcudart.so.13',
}

/** Port of `is_cuda_installed` (with old→new location migration). */
export function isCudaInstalled(
  backendDir: string,
  version: string,
  osType: string,
  appDataFolderPath: string,
): boolean {
  const libname = CUDA_LIB_LOOKUP[`${osType}-${version}`]
  if (libname === undefined) return false

  const newPath = path.join(backendDir, 'build', 'bin', libname)
  if (fs.existsSync(newPath)) return true

  const oldPath = path.join(appDataFolderPath, 'llamacpp', 'lib', libname)
  if (!fs.existsSync(oldPath)) return false

  const targetDir = path.join(backendDir, 'build', 'bin')
  try {
    fs.mkdirSync(targetDir, { recursive: true })
    fs.renameSync(oldPath, newPath)
    console.log(`[llamacpp] [CUDA] Migrated ${libname} from old path to new location.`)
    return true
  } catch (error) {
    console.warn(`[llamacpp] [CUDA] Failed to move old library:`, error)
    return false
  }
}

/** Port of `find_latest_version_for_backend`. */
export function findLatestVersionForBackend(
  versionBackends: BackendInfo[],
  backendType: string,
): string | null {
  const matching = versionBackends.filter((vb) => mapOldBackendToNew(vb.backend) === backendType)
  if (matching.length === 0) return null
  matching.sort((a, b) => (a.version === b.version ? 0 : a.version < b.version ? 1 : -1))
  return `${matching[0].version}/${matching[0].backend}`
}

function getBackendCategory(backendString: string): string | null {
  if (backendString.includes('cuda-13-common_cpus')) return 'cuda-cu13.0'
  if (backendString.includes('cuda-12-common_cpus') || backendString.includes('cu12.0')) {
    return 'cuda-cu12.0'
  }
  if (backendString.includes('cuda-11-common_cpus') || backendString.includes('cu11.7')) {
    return 'cuda-cu11.7'
  }
  if (backendString.includes('vulkan')) return 'vulkan'
  if (backendString.includes('common_cpus')) return 'common_cpus'
  if (backendString.includes('avx512')) return 'avx512'
  if (backendString.includes('avx2')) return 'avx2'
  if (
    backendString.includes('avx') &&
    !backendString.includes('avx2') &&
    !backendString.includes('avx512')
  ) {
    return 'avx'
  }
  if (backendString.includes('noavx')) return 'noavx'
  if (backendString.endsWith('arm64')) return 'arm64'
  if (backendString.endsWith('x64')) return 'x64'
  return null
}

/** Port of `prioritize_backends`. */
export function prioritizeBackends(
  versionBackends: BackendInfo[],
  hasEnoughGpuMemory: boolean,
): BestBackendResult {
  if (versionBackends.length === 0) {
    throw new Error('No backends available')
  }

  const backendPriorities = hasEnoughGpuMemory
    ? [
        'cuda-cu13.0',
        'cuda-cu12.0',
        'cuda-cu11.7',
        'vulkan',
        'common_cpus',
        'avx512',
        'avx2',
        'avx',
        'noavx',
        'arm64',
        'x64',
      ]
    : [
        'cuda-cu13.0',
        'cuda-cu12.0',
        'cuda-cu11.7',
        'common_cpus',
        'avx512',
        'avx2',
        'avx',
        'noavx',
        'arm64',
        'x64',
        'vulkan',
      ]

  for (const priorityCategory of backendPriorities) {
    const matching = versionBackends.filter(
      (vb) => getBackendCategory(vb.backend) === priorityCategory,
    )
    if (matching.length > 0) {
      const best = matching[0]
      return {
        backend_string: `${best.version}/${best.backend}`,
        version: best.version,
        backend_type: best.backend,
      }
    }
  }

  const fallback = versionBackends[0]
  return {
    backend_string: `${fallback.version}/${fallback.backend}`,
    version: fallback.version,
    backend_type: fallback.backend,
  }
}

/** Port of `parse_backend_version` (leading non-digits stripped). */
export function parseBackendVersion(versionString: string): number {
  const numeric = versionString.replace(/^[^\d]+/, '')
  const parsed = Number.parseInt(numeric, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Port of `check_backend_for_updates`. */
export function checkBackendForUpdates(
  currentBackendString: string,
  versionBackends: BackendInfo[],
): UpdateCheckResult {
  const parts = currentBackendString.split('/')
  if (parts.length !== 2) {
    throw new Error(`Invalid current backend format: ${currentBackendString}`)
  }
  const [currentVersion, currentBackend] = parts

  const currentEffectiveBackendType = mapOldBackendToNew(currentBackend)
  const targetBackendString = findLatestVersionForBackend(
    versionBackends,
    currentEffectiveBackendType,
  )
  if (targetBackendString === null) {
    return { update_needed: false, new_version: '0' }
  }
  const latestVersion = targetBackendString.split('/')[0]

  if (parseBackendVersion(latestVersion) > parseBackendVersion(currentVersion)) {
    return {
      update_needed: true,
      new_version: latestVersion,
      target_backend: targetBackendString,
    }
  }
  return { update_needed: false, new_version: '0' }
}

function isSinglePathSegment(value: string): boolean {
  return (
    value.length > 0 && !value.includes('..') && !value.includes('/') && !value.includes('\\')
  )
}

/** Port of `remove_old_backend_versions` (with traversal defenses). */
export function removeOldBackendVersions(
  backendsDir: string,
  latestVersion: string,
  backendType: string,
): string[] {
  if (!isSinglePathSegment(backendType)) {
    throw new Error(
      `Invalid backend_type '${backendType}': must be a single path segment without separators`,
    )
  }
  if (
    latestVersion.includes('..') ||
    latestVersion.includes('/') ||
    latestVersion.includes('\\')
  ) {
    throw new Error(`Invalid latest_version '${latestVersion}': must be a single path segment`)
  }

  const removedPaths: string[] = []
  if (!fs.existsSync(backendsDir)) return removedPaths
  const backendsCanon = fs.realpathSync(backendsDir)

  for (const versionEntry of fs.readdirSync(backendsCanon)) {
    if (versionEntry === latestVersion) continue

    const backendTypePath = path.join(backendsCanon, versionEntry, backendType)
    let backendCanon: string
    try {
      backendCanon = fs.realpathSync(backendTypePath)
    } catch {
      continue
    }
    if (
      backendCanon !== backendsCanon &&
      !backendCanon.startsWith(backendsCanon + path.sep)
    ) {
      console.warn(`[llamacpp] Skipping backend path outside backends_dir: ${backendCanon}`)
      continue
    }

    if (fs.existsSync(backendTypePath) && isBackendInstalled(backendTypePath)) {
      try {
        fs.rmSync(backendTypePath, { recursive: true, force: true })
        removedPaths.push(backendTypePath)
      } catch (error) {
        console.warn(`[llamacpp] Failed to remove old backend version ${backendTypePath}:`, error)
      }
    }
  }
  return removedPaths
}

/** Port of `validate_backend_string`. Returns [version, backend]. */
export function validateBackendString(backendString: string): [string, string] {
  const parts = backendString.split('/')
  if (parts.length !== 2) {
    throw new Error(`Invalid backend format: ${backendString}`)
  }
  const version = parts[0].trim()
  const backend = parts[1].trim()
  if (version.length === 0 || backend.length === 0) {
    throw new Error(`Invalid backend format: ${backendString}`)
  }
  return [version, backend]
}

/** Port of `should_migrate_backend`. */
export function shouldMigrateBackend(
  storedBackendType: string,
  versionBackends: BackendInfo[],
): string | null {
  const mappedNewBackendType = mapOldBackendToNew(storedBackendType)
  if (mappedNewBackendType === storedBackendType) return null

  const isNewTypeAvailable = versionBackends.some(
    (vb) => mapOldBackendToNew(vb.backend) === mappedNewBackendType,
  )
  return isNewTypeAvailable ? mappedNewBackendType : null
}

/** Port of `handle_setting_update`. */
export function handleSettingUpdate(
  key: string,
  value: string,
  currentStoredBackend?: string,
): SettingUpdateResult {
  if (key !== 'version_backend') {
    return {
      backend_type_updated: false,
      needs_backend_installation: false,
    }
  }

  const parts = value.split('/')
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    throw new Error(`Invalid backend format: ${value}`)
  }
  const [version, backend] = parts

  const effectiveBackendType = mapOldBackendToNew(backend)
  const backendTypeUpdated =
    currentStoredBackend !== undefined ? currentStoredBackend !== effectiveBackendType : true

  return {
    backend_type_updated: backendTypeUpdated,
    effective_backend_type: effectiveBackendType,
    needs_backend_installation: true,
    version,
    backend,
  }
}
