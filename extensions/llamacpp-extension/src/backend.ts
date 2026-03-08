/**
 * Ax-Studio llama.cpp Extension — Backend Manager
 *
 * Manages llama.cpp binary downloads, version detection, and updates.
 * Written from scratch for Ax-Studio (UNLICENSED).
 */

import { getAppDataFolderPath, joinPath, fs, events } from '@ax-studio/core'
import { invoke } from '@tauri-apps/api/core'
import {
  getLocalInstalledBackendsInternal,
  listSupportedBackendsFromRust,
  getSupportedFeaturesFromRust,
  prioritizeBackends,
  checkBackendForUpdates,
  removeOldBackendVersions,
  findLatestVersionForBackend,
  BackendVersion,
  BestBackendResult,
  UpdateCheckResult,
} from '@ax-studio/tauri-plugin-llamacpp-api'
import { getProxyConfig, buildProxyArg } from './util'

// Build-time constants — see env.d.ts for declarations

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10'

// ─── Path helpers ───────────────────────────────────────────────────────────

/**
 * Get the absolute path to the backends root directory.
 */
export async function getBackendsDir(): Promise<string> {
  const appData = await getAppDataFolderPath()
  return joinPath([appData, 'llamacpp', 'backends'])
}

/**
 * Get the absolute path to a specific backend's extracted directory.
 */
export async function getBackendDir(version: string, backend: string): Promise<string> {
  const backendsDir = await getBackendsDir()
  return joinPath([backendsDir, version, backend])
}

/**
 * Get the absolute path to the llama-server executable for a given backend.
 * Searches multiple possible structures:
 *  1. llama-{version}/llama-server  (ggml-org official releases)
 *  2. build/bin/llama-server        (fork releases)
 *  3. llama-server                  (flat / direct in root)
 */
export async function getBackendExePath(version: string, backend: string): Promise<string> {
  const dir = await getBackendDir(version, backend)
  const isWindows = IS_WINDOWS
  const binary = isWindows ? 'llama-server.exe' : 'llama-server'

  // Check ggml-org structure: llama-{version}/llama-server
  const ggmlPath = await joinPath([dir, `llama-${version}`, binary])
  if (await fs.existsSync(ggmlPath)) return ggmlPath

  // Check janhq structure: build/bin/llama-server
  const buildPath = await joinPath([dir, 'build', 'bin', binary])
  if (await fs.existsSync(buildPath)) return buildPath

  // Fallback: llama-server directly in root
  const rootPath = await joinPath([dir, binary])
  if (await fs.existsSync(rootPath)) return rootPath

  // Return ggml-org path as default (most likely for new downloads)
  return ggmlPath
}

/**
 * Check whether a specific backend version is already installed.
 */
export async function isBackendInstalled(version: string, backend: string): Promise<boolean> {
  try {
    const exePath = await getBackendExePath(version, backend)
    return Boolean(await fs.existsSync(exePath))
  } catch {
    return false
  }
}

// ─── ax-serving binary discovery ──────────────────────────────────────────────

/**
 * Get the absolute path to the ax-serving binary.
 * Searches:
 *  1. ~/.ax-studio/ax-serving/ax-serving (app data directory)
 *  2. /usr/local/bin/ax-serving (Homebrew / pkg install)
 *  3. ax-serving on PATH (fallback — will be resolved by the OS)
 */
export async function getAxServingBinaryPath(): Promise<string> {
  // Check app data directory
  const appData = await getAppDataFolderPath()
  const appDataPath = await joinPath([appData, 'ax-serving', 'ax-serving'])
  if (await fs.existsSync(appDataPath)) return appDataPath

  // Check /usr/local/bin (Homebrew default)
  const usrLocalPath = '/usr/local/bin/ax-serving'
  if (await fs.existsSync(usrLocalPath)) return usrLocalPath

  // Check /opt/homebrew/bin (Apple Silicon Homebrew)
  const optBrewPath = '/opt/homebrew/bin/ax-serving'
  if (await fs.existsSync(optBrewPath)) return optBrewPath

  // Fallback: assume it's on PATH
  return 'ax-serving'
}

// ─── Local backend discovery ─────────────────────────────────────────────────

/**
 * List all locally installed backends by scanning the backends directory.
 */
export async function getLocalInstalledBackends(): Promise<BackendVersion[]> {
  try {
    const backendsDir = await getBackendsDir()
    const exists = await fs.existsSync(backendsDir)
    if (!exists) return []
    return await getLocalInstalledBackendsInternal(backendsDir)
  } catch {
    return []
  }
}

// ─── Remote backend discovery ─────────────────────────────────────────────────

/**
 * Fetch available backend versions from GitHub releases.
 * Falls back to empty list if GitHub is unavailable.
 */
export async function fetchRemoteBackends(): Promise<BackendVersion[]> {
  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`GitHub API ${response.status}`)

    const releases = (await response.json()) as Array<{
      tag_name: string
      assets: Array<{ name: string }>
    }>

    const backends: BackendVersion[] = []
    for (const release of releases) {
      const version = release.tag_name
      for (const asset of release.assets) {
        // Pattern: llama-{version}-bin-{backend}.tar.gz or .zip
        const match = asset.name.match(/^llama-[^-]+-bin-(.+?)\.(tar\.gz|zip)$/)
        if (match) {
          backends.push({ version, backend: match[1] })
        }
      }
    }
    return backends
  } catch (e) {
    console.warn('[llamacpp] Failed to fetch remote backends from GitHub:', e)
    return []
  }
}

// ─── Hardware detection ───────────────────────────────────────────────────────

interface HardwareInfo {
  osType: string
  arch: string
  cpuExtensions: string[]
  gpus: Array<{ driver_version: string; nvidia_info?: any; vulkan_info?: any }>
}

/**
 * Get hardware info from the hardware extension for backend selection.
 */
async function getHardwareInfo(): Promise<HardwareInfo> {
  const isWindows = IS_WINDOWS
  const isMac = IS_MACOS
  const isLinux = IS_LINUX

  try {
    const hw = await (window as any).core?.extensionManager
      ?.getByName('@ax-studio/hardware-extension')
      ?.getHardwareInfo?.()
    if (hw) {
      return {
        osType: isWindows ? 'windows' : isMac ? 'macOS' : 'linux',
        arch: hw.arch ?? 'x64',
        cpuExtensions: hw.cpu_extensions ?? [],
        gpus: hw.gpus ?? [],
      }
    }
  } catch {}
  // Fallback: minimal info
  return {
    osType: isWindows ? 'windows' : isMac ? 'macOS' : 'linux',
    arch: 'x64',
    cpuExtensions: [],
    gpus: [],
  }
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * Download and extract a backend binary.
 * Tries GitHub first, then CDN fallback.
 */
export async function downloadBackend(
  version: string,
  backend: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  const isWindows = IS_WINDOWS
  const ext = isWindows ? '.zip' : '.tar.gz'
  const filename = `llama-${version}-bin-${backend}${ext}`
  const downloadUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${version}/${filename}`

  const backendsDir = await getBackendsDir()
  const destDir = await getBackendDir(version, backend)
  // Save temp file INSIDE destDir so that Rust's cancel cleanup
  // (remove_dir_all on parent) only removes the specific backend dir,
  // not the entire backends directory.
  const tempFile = await joinPath([destDir, `_tmp_${filename}`])

  // Ensure destination dirs exist
  if (!(await fs.existsSync(backendsDir))) await fs.mkdir(backendsDir)
  if (!(await fs.existsSync(destDir))) await fs.mkdir(destDir)

  const downloadExt = (window as any).core?.extensionManager?.getByName(
    '@ax-studio/download-extension'
  )
  if (!downloadExt) throw new Error('Download extension not available')

  const proxy = getProxyConfig()
  const proxyArg = buildProxyArg(proxy)

  // Use a unique task_id (with timestamp) to prevent concurrent
  // configureBackends calls from cancelling each other's downloads.
  const taskId = `llamacpp-backend-${version}-${backend}-${Date.now()}`

  try {
    await downloadExt.downloadFile(
      downloadUrl,
      tempFile,
      taskId,
      proxyArg,
      (transferred: number, total: number) => {
        if (onProgress && total > 0) {
          onProgress(Math.round((transferred / total) * 100))
        }
      }
    )
  } catch (e) {
    try { await fs.rm(tempFile) } catch {}
    throw new Error(`Failed to download backend "${backend}" from ${downloadUrl}: ${e}`)
  }

  // Decompress using Tauri's decompress command
  try {
    await invoke('decompress', { path: tempFile, outputDir: destDir })
  } catch (e) {
    try { await fs.rm(tempFile) } catch {}
    try { await fs.rm(destDir) } catch {}
    throw new Error(`Failed to decompress backend: ${e}`)
  }
  try { await fs.rm(tempFile) } catch {}

  // Verify binary
  const exePath = await getBackendExePath(version, backend)
  if (!(await fs.existsSync(exePath))) {
    try { await fs.rm(destDir) } catch {}
    throw new Error(`Backend binary missing after extraction: ${exePath}`)
  }
}

// ─── Update checking ──────────────────────────────────────────────────────────

export interface BackendUpdateInfo {
  updateNeeded: boolean
  newVersion: string
  currentVersion?: string
  targetBackend?: string
}

/**
 * Check whether a newer version of the current backend type is available.
 */
export async function checkForBackendUpdate(
  currentVersionBackend: string,
  remoteBackends: BackendVersion[]
): Promise<BackendUpdateInfo> {
  if (!currentVersionBackend || remoteBackends.length === 0) {
    return { updateNeeded: false, newVersion: '' }
  }
  try {
    const result: UpdateCheckResult = await checkBackendForUpdates(
      currentVersionBackend,
      remoteBackends
    )
    return {
      updateNeeded: result.update_needed,
      newVersion: result.new_version ?? '',
      targetBackend: result.target_backend,
    }
  } catch (e) {
    console.error('[llamacpp] checkForBackendUpdate error:', e)
    return { updateNeeded: false, newVersion: '' }
  }
}

// ─── configureBackends ────────────────────────────────────────────────────────

// Guard to prevent concurrent configureBackends executions
// (React strict mode in dev can trigger onLoad twice)
let _configureBackendsRunning = false

/**
 * Main entry point called on extension load.
 * Discovers available backends, selects the best one, checks for updates,
 * and ensures it is downloaded.
 */
export async function configureBackends(
  currentVersionBackend: string,
  autoUpdate: boolean,
  onSettingUpdate: (key: string, value: string) => void
): Promise<void> {
  if (_configureBackendsRunning) {
    console.log('[llamacpp] configureBackends already running, skipping duplicate call')
    return
  }
  _configureBackendsRunning = true
  try {
    const [localBackends, remoteBackends, hw] = await Promise.all([
      getLocalInstalledBackends(),
      fetchRemoteBackends(),
      getHardwareInfo(),
    ])

    // Report hardware to Rust so it can rank backends correctly
    await getSupportedFeaturesFromRust(hw.osType, hw.cpuExtensions, hw.gpus)

    // Merge local + remote into a ranked list
    const allBackends = await listSupportedBackendsFromRust(remoteBackends, localBackends)

    let targetVersionBackend = currentVersionBackend

    // If no backend set (first run), pick the best for this hardware
    if (!targetVersionBackend) {
      const hasGpu = hw.gpus.length > 0
      const best: BestBackendResult = await prioritizeBackends(allBackends, hasGpu)
      if (best?.backend_string) {
        targetVersionBackend = best.backend_string
        onSettingUpdate('version_backend', best.backend_string)
      }
    }

    // Emit update notification if auto-update is on
    if (autoUpdate && targetVersionBackend && remoteBackends.length > 0) {
      const updateInfo = await checkForBackendUpdate(targetVersionBackend, remoteBackends)
      if (updateInfo.updateNeeded) {
        events.emit('onBackendUpdateAvailable', updateInfo)
      }
    }

    // Ensure selected backend binary is on disk
    if (targetVersionBackend) {
      const [version, ...rest] = targetVersionBackend.split('/')
      const backend = rest.join('/')
      if (version && backend) {
        const installed = await isBackendInstalled(version, backend)
        if (!installed) {
          console.log(`[llamacpp] Downloading backend: ${targetVersionBackend}`)
          await downloadBackend(version, backend)
        }
      }
    }
  } catch (e) {
    console.error('[llamacpp] configureBackends failed:', e)
  } finally {
    _configureBackendsRunning = false
  }
}

// ─── Update / install ─────────────────────────────────────────────────────────

/**
 * Download and switch to a new backend version, removing old versions.
 */
export async function updateBackend(
  targetVersionBackend: string,
  currentVersionBackend: string
): Promise<{ wasUpdated: boolean; newBackend: string }> {
  const [version, ...rest] = targetVersionBackend.split('/')
  const backend = rest.join('/')
  if (!version || !backend) {
    throw new Error(`Invalid backend string: "${targetVersionBackend}"`)
  }

  if (!(await isBackendInstalled(version, backend))) {
    await downloadBackend(version, backend)
  }

  // Remove obsolete versions of the same backend type
  if (currentVersionBackend && currentVersionBackend !== targetVersionBackend) {
    try {
      const backendsDir = await getBackendsDir()
      await removeOldBackendVersions(backendsDir, version, backend)
    } catch (e) {
      console.warn('[llamacpp] removeOldBackendVersions failed:', e)
    }
  }

  return { wasUpdated: true, newBackend: targetVersionBackend }
}

/**
 * Install a backend from a local archive (.tar.gz or .zip).
 * Filename must follow: llama-{version}-bin-{backend}.{ext}
 */
export async function installBackendFromFile(filePath: string): Promise<void> {
  const filename = filePath.split('/').pop() ?? filePath
  const match = filename.match(/^llama-([^_]+(?:_[^.]+)*)-bin-(.+?)\.(tar\.gz|zip)$/)
  if (!match) {
    throw new Error(
      `Invalid backend filename: "${filename}". Expected: llama-{version}-bin-{backend}.tar.gz`
    )
  }
  const version = match[1]
  const backend = match[2]

  const backendsDir = await getBackendsDir()
  const destDir = await getBackendDir(version, backend)

  if (!(await fs.existsSync(destDir))) await fs.mkdir(destDir)

  try {
    await invoke('decompress', { path: filePath, outputDir: destDir })
  } catch (e) {
    try { await fs.rm(destDir) } catch {}
    throw new Error(`Failed to decompress backend file: ${e}`)
  }

  const exePath = await getBackendExePath(version, backend)
  if (!(await fs.existsSync(exePath))) {
    try { await fs.rm(destDir) } catch {}
    throw new Error(`Backend binary missing after installation: ${exePath}`)
  }
}
