/**
 * Ax-Studio llama.cpp Extension — Backend Manager
 *
 * Manages llama.cpp binary downloads, version detection, and updates.
 * Written from scratch for Ax-Studio (UNLICENSED).
 */

import { getAppDataFolderPath, joinPath, fs, events } from '@ax-studio/core'
import { invoke } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
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
  GpuInfo,
  UpdateCheckResult,
} from '@ax-studio/tauri-plugin-llamacpp-api'
import { getProxyConfig, buildProxyArg } from './util'

// Build-time constants — see env.d.ts for declarations

// Keep the release page small because we only need recent backend artifacts.
const GITHUB_RELEASES_PAGE_SIZE = 10
const GITHUB_API_TIMEOUT_MS = 5_000
const REMOTE_BACKEND_CACHE_TTL_MS = 5 * 60 * 1000
const BACKEND_DOWNLOAD_MAX_ATTEMPTS = 3
const BACKEND_DOWNLOAD_RETRY_BASE_MS = 500
const GITHUB_RELEASES_URL =
  `https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=${GITHUB_RELEASES_PAGE_SIZE}`

let remoteBackendsCache:
  | {
      fetchedAt: number
      backends: BackendVersion[]
    }
  | null = null

interface GithubReleaseAsset {
  name: string
}

interface GithubRelease {
  tag_name: string
  assets: GithubReleaseAsset[]
}

type HardwareGpuInfo = GpuInfo

export const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function removePathIfPresent(path: string, label: string): Promise<void> {
  try {
    await fs.rm(path)
  } catch (error) {
    console.warn(`[llamacpp] Failed to remove ${label}:`, error)
  }
}

/** @internal Test-only: resets the remote backends cache between tests. */
export function clearRemoteBackendsCacheForTests(): void {
  remoteBackendsCache = null
}

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
  } catch (error) {
    console.debug('[llamacpp] Failed to check backend installation state:', error)
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
  } catch (error) {
    console.debug('[llamacpp] Failed to list local backends:', error)
    return []
  }
}

// ─── Remote backend discovery ─────────────────────────────────────────────────

/**
 * Fetch available backend versions from GitHub releases.
 * Falls back to empty list if GitHub is unavailable.
 */
export async function fetchRemoteBackends(): Promise<BackendVersion[]> {
  if (
    remoteBackendsCache &&
    Date.now() - remoteBackendsCache.fetchedAt < REMOTE_BACKEND_CACHE_TTL_MS
  ) {
    return remoteBackendsCache.backends
  }

  try {
    // Try Tauri HTTP plugin first (bypasses CSP), fall back to global fetch.
    // CSP connect-src also includes api.github.com as defense-in-depth.
    const doFetch = typeof tauriFetch === 'function' ? tauriFetch : fetch
    const response = await Promise.race([
      doFetch(GITHUB_RELEASES_URL, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('GitHub API timeout')),
          GITHUB_API_TIMEOUT_MS
        )
      ),
    ])
    if (!response.ok) throw new Error(`GitHub API ${response.status}`)

    const releases = (await response.json()) as GithubRelease[]

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
    remoteBackendsCache = { fetchedAt: Date.now(), backends }
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
  gpus: HardwareGpuInfo[]
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
  } catch (error) {
    console.debug('[llamacpp] Hardware extension unavailable, using fallback info:', error)
  }
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
    let lastError: unknown = null

    for (let attempt = 1; attempt <= BACKEND_DOWNLOAD_MAX_ATTEMPTS; attempt++) {
      try {
        await downloadExt.downloadFile(
          downloadUrl,
          tempFile,
          `${taskId}-attempt-${attempt}`,
          proxyArg,
          undefined,
          (transferred: number, total: number) => {
            if (onProgress && total > 0) {
              onProgress(Math.round((transferred / total) * 100))
            }
          }
        )
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (attempt === BACKEND_DOWNLOAD_MAX_ATTEMPTS) break
        const delayMs = BACKEND_DOWNLOAD_RETRY_BASE_MS * 2 ** (attempt - 1)
        console.warn(
          `[llamacpp] Backend download attempt ${attempt}/${BACKEND_DOWNLOAD_MAX_ATTEMPTS} failed for ${backend}; retrying in ${delayMs}ms:`,
          error
        )
        await sleep(delayMs)
      }
    }

    if (lastError) {
      throw lastError
    }
  } catch (e) {
    await removePathIfPresent(tempFile, 'backend temp archive')
    throw new Error(
      `Failed to download backend "${backend}" from ${downloadUrl}: ${formatError(e)}`
    )
  }

  // Decompress using Tauri's decompress command
  try {
    await invoke('decompress', { path: tempFile, outputDir: destDir })
  } catch (e) {
    await removePathIfPresent(tempFile, 'backend temp archive')
    await removePathIfPresent(destDir, 'backend destination directory')
    throw new Error(`Failed to decompress backend: ${formatError(e)}`)
  }
  await removePathIfPresent(tempFile, 'backend temp archive')

  // Verify binary
  const exePath = await getBackendExePath(version, backend)
  if (!(await fs.existsSync(exePath))) {
    await removePathIfPresent(destDir, 'backend destination directory')
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

// ─── Default backend selection (JS fallback) ─────────────────────────────────

/**
 * Pick the best backend from a list purely in JS, without Rust IPC.
 * Used when Rust ranking calls hang or fail.
 */
function pickDefaultBackend(osType: string, backends: BackendVersion[]): string | null {
  if (backends.length === 0) return null
  // Use the latest release version
  const latest = backends.reduce((a, b) => (b.version > a.version ? b : a)).version
  const candidates = backends.filter((b) => b.version === latest)

  const keywords =
    osType === 'macOS'
      ? ['macos-arm64', 'macos-x64', 'macos', 'metal']
      : osType === 'windows'
        ? ['cuda', 'vulkan', 'avx2', 'avx']
        : ['ubuntu', 'linux', 'avx2', 'avx']

  for (const kw of keywords) {
    const match = candidates.find((b) => b.backend.toLowerCase().includes(kw))
    if (match) return `${match.version}/${match.backend}`
  }
  return `${candidates[0].version}/${candidates[0].backend}`
}

// ─── configureBackends ────────────────────────────────────────────────────────

// Share in-flight backend discovery so duplicate callers observe the same work.
let configureBackendsPromise: Promise<void> | null = null

// Resolves as soon as Phase 1 (backend selection) completes — before the
// binary download starts.  _doLoadLlamacpp awaits this, not the full promise,
// so model load is never blocked by a multi-minute download.
let configureBackendsSelectionPromise: Promise<void> | null = null

/**
 * Main entry point called on extension load.
 * Discovers available backends, selects the best one, checks for updates,
 * and ensures it is downloaded.
 */
export async function configureBackends(
  currentVersionBackend: string,
  autoUpdate: boolean,
  onSettingUpdate: (key: string, value: string) => void | Promise<void>
): Promise<void> {
  if (configureBackendsPromise) {
    return configureBackendsPromise
  }

  let resolveSelection!: () => void
  configureBackendsSelectionPromise = new Promise<void>((resolve) => {
    resolveSelection = resolve
  })

  configureBackendsPromise = (async () => {
    try {
      let targetVersionBackend = currentVersionBackend

      // Fetch remote backends and hardware info.
      // The Rust IPC calls (getSupportedFeaturesFromRust, listSupportedBackendsFromRust,
      // prioritizeBackends) are only needed when no backend is selected yet — on some
      // machines these calls can hang indefinitely, so skip them when a backend is
      // already configured.
      // Timeout the entire discovery: getLocalInstalledBackends or
      // fetchRemoteBackends can hang indefinitely on some machines
      // (Tauri IPC deadlock, network issues).  12s is generous —
      // fetchRemoteBackends already has a 5s per-request timeout.
      const discoveryResult = await Promise.race([
        Promise.all([getLocalInstalledBackends(), fetchRemoteBackends()]),
        new Promise<[BackendVersion[], BackendVersion[]]>((resolve) =>
          setTimeout(() => {
            console.warn('[llamacpp] Backend discovery timed out after 12s, using empty lists')
            resolve([[], []])
          }, 12_000)
        ),
      ])
      const [localBackends, remoteBackends] = discoveryResult
      console.debug(
        `[llamacpp] configureBackends: currentVersionBackend="${currentVersionBackend}", ` +
        `localBackends=${localBackends.length}, remoteBackends=${remoteBackends.length}`
      )

      if (!targetVersionBackend) {
        const hw = await getHardwareInfo()
        // Rust IPC calls can hang indefinitely on some machines.
        // Give each 6 seconds then fall back to a JS heuristic.
        const withFallback = <T>(p: Promise<T>, fallback: T): Promise<T> =>
          Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), 6_000))])

        let picked: string | null = null
        try {
          await withFallback(getSupportedFeaturesFromRust(hw.osType, hw.cpuExtensions, hw.gpus), undefined)
          const ranked = await withFallback(listSupportedBackendsFromRust(remoteBackends, localBackends), remoteBackends)
          const best = await withFallback(prioritizeBackends(ranked, hw.gpus.length > 0), null)
          if (best?.backend_string) picked = best.backend_string
        } catch (e) {
          console.warn('[llamacpp] Rust backend ranking failed, using JS fallback:', e)
        }

        // JS fallback: pick from remote list by OS keyword
        if (!picked && remoteBackends.length > 0) {
          picked = pickDefaultBackend(hw.osType, remoteBackends)
          console.debug(`[llamacpp] JS fallback picked: ${picked}`)
        }

        // Final fallback: if remote discovery failed (CSP, network, etc.)
        // use the newest locally installed backend.  This ensures the engine
        // can start even when GitHub is unreachable.
        if (!picked && localBackends.length > 0) {
          const latest = localBackends.reduce((a, b) =>
            b.version > a.version ? b : a
          )
          picked = `${latest.version}/${latest.backend}`
          console.debug(
            `[llamacpp] Remote backends unavailable, using local backend: ${picked}`
          )
        }

        if (picked) {
          targetVersionBackend = picked
          await onSettingUpdate('version_backend', picked)
        } else {
          console.warn(
            `[llamacpp] No backend could be selected! ` +
            `remoteBackends=${remoteBackends.length}, localBackends=${localBackends.length}, ` +
            `hw.osType=${hw.osType}`
          )
        }
      }

      // Phase 1 (selection) is complete — unblock any concurrent model loads
      // before starting the potentially long binary download.
      resolveSelection()

      // Emit update notification if auto-update is on
      if (autoUpdate && targetVersionBackend && remoteBackends.length > 0) {
        const updateInfo = await checkForBackendUpdate(targetVersionBackend, remoteBackends)
        if (updateInfo.updateNeeded) {
          events.emit('onBackendUpdateAvailable', updateInfo)
        }
      }

      // Ensure selected backend binary is on disk (Phase 2 — may be slow)
      if (targetVersionBackend) {
        const [version, ...rest] = targetVersionBackend.split('/')
        const backend = rest.join('/')
        if (version && backend) {
          const installed = await isBackendInstalled(version, backend)
          if (!installed) {
            await downloadBackend(version, backend)
          }
        }
      }
    } catch (e) {
      resolveSelection?.()  // always unblock waiters even on error
      console.error('[llamacpp] configureBackends failed:', e)
      throw e
    } finally {
      configureBackendsPromise = null
      configureBackendsSelectionPromise = null
    }
  })()

  return configureBackendsPromise
}

/** Resolves when Phase 1 (backend selection) of configureBackends completes, or immediately if not running. */
export function awaitPendingBackendSelection(): Promise<void> {
  return configureBackendsSelectionPromise ?? Promise.resolve()
}

/** Resolves when the full configureBackends call finishes (including download), or immediately if not running. */
export function awaitPendingConfigureBackends(): Promise<void> {
  return configureBackendsPromise ?? Promise.resolve()
}

// ─── Backend resolution (for model load path) ────────────────────────────────

/** Timeout for local backend discovery via Rust IPC (ms). */
const LOCAL_DISCOVERY_TIMEOUT_MS = 6_000

/**
 * Regex for a well-formed backend string: "{version}/{platform}".
 * Rejects absolute paths, empty segments, and malformed values.
 */
const BACKEND_STRING_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/

/** Check whether a version_backend string is well-formed. */
export function isValidBackendString(value: string): boolean {
  return BACKEND_STRING_RE.test(value)
}

/**
 * Try to discover a locally installed backend via Rust IPC, using the
 * official API package (not raw invoke strings).  Returns a well-formed
 * "{version}/{platform}" string, or empty string if nothing found.
 *
 * This is the single source of truth for local backend discovery outside
 * of configureBackends().
 */
export async function resolveBackendVersion(): Promise<string> {
  try {
    const backendsDir = await getBackendsDir()
    if (!(await fs.existsSync(backendsDir))) return ''

    const localBackends = await Promise.race([
      getLocalInstalledBackendsInternal(backendsDir),
      new Promise<BackendVersion[]>((resolve) =>
        setTimeout(() => {
          console.warn('[llamacpp] Local backend discovery timed out')
          resolve([])
        }, LOCAL_DISCOVERY_TIMEOUT_MS)
      ),
    ])

    if (localBackends.length === 0) return ''

    // Pick the latest version
    const latest = localBackends.reduce((a, b) =>
      b.version > a.version ? b : a
    )
    const result = `${latest.version}/${latest.backend}`
    console.debug(`[llamacpp] Resolved local backend: ${result}`)
    return result
  } catch (e) {
    console.warn('[llamacpp] Local backend discovery failed:', e)
    return ''
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
  const filename = filePath.split(/[\\/]/).pop() ?? filePath
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
    await removePathIfPresent(destDir, 'backend destination directory')
    throw new Error(`Failed to decompress backend file: ${formatError(e)}`)
  }

  const exePath = await getBackendExePath(version, backend)
  if (!(await fs.existsSync(exePath))) {
    await removePathIfPresent(destDir, 'backend destination directory')
    throw new Error(`Backend binary missing after installation: ${exePath}`)
  }
}
