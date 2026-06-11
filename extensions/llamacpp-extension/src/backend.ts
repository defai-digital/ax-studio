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
import {
  axEngineAssetInfo,
  parseSha256File,
  pickNewestVersionDir,
} from './ax-engine-release'

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

  // Check legacy fork structure: build/bin/llama-server
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

// ─── ax-engine binary discovery & download ────────────────────────────────────

const AX_ENGINE_LATEST_RELEASE_URL =
  'https://api.github.com/repos/defai-digital/ax-engine/releases/latest'

/** Root directory for auto-downloaded ax-engine releases */
export async function getAxEngineDir(): Promise<string> {
  const appData = await getAppDataFolderPath()
  return joinPath([appData, 'ax-engine'])
}

/**
 * Find an installed ax-engine-server binary, or null when none is found.
 * Searches:
 *  1. ~/.ax-studio/ax-engine/<version>/ax-engine-server (auto-downloaded, newest)
 *  2. ~/.ax-studio/ax-engine/ax-engine-server (legacy manual install)
 *  3. /usr/local/bin/ax-engine-server (Homebrew / pkg install)
 *  4. /opt/homebrew/bin/ax-engine-server (Apple Silicon Homebrew)
 */
export async function findAxEngineBinary(): Promise<string | null> {
  const axDir = await getAxEngineDir()

  // Auto-downloaded versioned installs — pick the newest
  try {
    if (await fs.existsSync(axDir)) {
      const entries: string[] = (await fs.readdirSync(axDir)) ?? []
      const names = entries.map(
        (p) => p.replace(/\\/g, '/').split('/').pop() ?? ''
      )
      const newest = pickNewestVersionDir(names)
      if (newest) {
        const versionedPath = await joinPath([axDir, newest, 'ax-engine-server'])
        if (await fs.existsSync(versionedPath)) return versionedPath
      }
    }
  } catch {}

  // Legacy manual install directly in the ax-engine dir
  const legacyPath = await joinPath([axDir, 'ax-engine-server'])
  if (await fs.existsSync(legacyPath)) return legacyPath

  // System installs
  const usrLocalPath = '/usr/local/bin/ax-engine-server'
  if (await fs.existsSync(usrLocalPath)) return usrLocalPath

  const optBrewPath = '/opt/homebrew/bin/ax-engine-server'
  if (await fs.existsSync(optBrewPath)) return optBrewPath

  return null
}

/**
 * Get a path/command for the ax-engine-server binary, falling back to PATH
 * resolution by the OS when no install is found.
 */
export async function getAxEngineBinaryPath(): Promise<string> {
  return (await findAxEngineBinary()) ?? 'ax-engine-server'
}

/** Coalesces concurrent ax-engine download attempts */
let _axEngineDownload: Promise<string> | null = null

/**
 * Ensure an ax-engine-server binary is available, auto-downloading the
 * latest GitHub release when none is installed. Returns the binary path.
 */
export async function ensureAxEngineBinary(): Promise<string> {
  const existing = await findAxEngineBinary()
  if (existing) return existing

  if (!IS_MACOS) {
    throw new Error(
      'ax-engine is only available on Apple Silicon macOS. ' +
        'Use the llama.cpp engine on this platform.'
    )
  }

  if (!_axEngineDownload) {
    _axEngineDownload = downloadAxEngine().finally(() => {
      _axEngineDownload = null
    })
  }
  return _axEngineDownload
}

/** Download and install the latest ax-engine release into the app data dir */
async function downloadAxEngine(): Promise<string> {
  const downloadExt = (window as any).core?.extensionManager?.getByName(
    '@ax-studio/download-extension'
  )
  if (!downloadExt) {
    throw new Error(
      'ax-engine-server is not installed and the download extension is unavailable. ' +
        'Install it manually (e.g. "brew install defai-digital/tap/ax-engine").'
    )
  }

  // Resolve the latest release tag (api.github.com allows cross-origin reads)
  const res = await fetch(AX_ENGINE_LATEST_RELEASE_URL, {
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error(`Failed to resolve latest ax-engine release (${res.status})`)
  }
  const release = await res.json()
  const tag = String(release.tag_name ?? '')
  const asset = axEngineAssetInfo(tag)

  const axDir = await getAxEngineDir()
  const destDir = await joinPath([axDir, tag])
  if (!(await fs.existsSync(axDir))) await fs.mkdir(axDir)
  if (!(await fs.existsSync(destDir))) await fs.mkdir(destDir)

  // Temp files INSIDE destDir so cancel cleanup only removes this version dir
  const tempArchive = await joinPath([destDir, `_tmp_${asset.filename}`])
  const tempSha = await joinPath([destDir, `_tmp_${asset.filename}.sha256`])
  const proxyArg = buildProxyArg(getProxyConfig())
  const taskId = `llamacpp-ax-engine-${tag}-${Date.now()}`

  console.log(`[llamacpp] Downloading ax-engine ${tag} from ${asset.url}`)

  try {
    await downloadExt.downloadFile(asset.url, tempArchive, taskId, proxyArg)

    // Verify the archive checksum when the release publishes one
    let expectedSha: string | null = null
    try {
      await downloadExt.downloadFile(
        asset.shaUrl,
        tempSha,
        `${taskId}-sha`,
        proxyArg
      )
      const shaContent = await fs.readFileSync(tempSha)
      expectedSha = parseSha256File(String(shaContent ?? ''), asset.filename)
    } catch (e) {
      console.warn('[llamacpp] ax-engine sha256 file unavailable:', e)
    }
    if (expectedSha) {
      const valid = await (window as any).core?.api?.validateSha256?.(
        tempArchive,
        expectedSha
      )
      if (!valid) {
        throw new Error(
          `SHA256 mismatch for ${asset.filename}. Download may be corrupted.`
        )
      }
    }

    await invoke('decompress', { path: tempArchive, outputDir: destDir })
  } catch (e) {
    try {
      await fs.rm(destDir)
    } catch {}
    throw new Error(`Failed to download ax-engine ${tag}: ${e}`)
  } finally {
    try {
      await fs.rm(tempArchive)
    } catch {}
    try {
      await fs.rm(tempSha)
    } catch {}
  }

  const exePath = await joinPath([destDir, 'ax-engine-server'])
  if (!(await fs.existsSync(exePath))) {
    try {
      await fs.rm(destDir)
    } catch {}
    throw new Error(`ax-engine-server missing after extraction: ${exePath}`)
  }

  console.log(`[llamacpp] ax-engine ${tag} installed at ${exePath}`)
  return exePath
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
