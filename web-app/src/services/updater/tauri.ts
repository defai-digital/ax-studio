/**
 * Tauri Updater Service - Desktop implementation
 *
 * Two-phase update flow:
 * 1. check() — asks the Rust backend to hit the primary endpoint with HMAC request signing,
 *    falling back to unsigned fallback endpoints. One request, zero Tauri plugin involvement.
 * 2. downloadAndInstallWithProgress() — lazily calls the Tauri plugin-updater check() to
 *    obtain an installable Update object, then streams progress back to the caller.
 *    The plugin request happens at install time only, not at notification time.
 */

import { check, Update } from '@tauri-apps/plugin-updater'
import { invoke } from '@tauri-apps/api/core'
import { load } from '@tauri-apps/plugin-store'
import type {
  InstallChannel,
  UpdateInfo,
  UpdateProgressEvent,
  UpdaterService,
} from './types'

const STORE_NAME = 'updater.json'
const NONCE_SEED_KEY = 'nonce_seed'

// Cache nonce seed in memory to avoid repeated store reads
let cachedNonceSeed: string | null = null
// Deduplicates concurrent getNonceSeed() calls
let nonceSeedPromise: Promise<string> | null = null

async function getNonceSeed(): Promise<string> {
  if (cachedNonceSeed) return cachedNonceSeed
  if (nonceSeedPromise) return nonceSeedPromise

  nonceSeedPromise = (async () => {
    try {
      const store = await load(STORE_NAME, { autoSave: true, defaults: {} })
      let nonceSeed = await store.get<string>(NONCE_SEED_KEY)

      if (!nonceSeed) {
        nonceSeed = crypto.randomUUID()
        await store.set(NONCE_SEED_KEY, nonceSeed)
        await store.save()
      }

      cachedNonceSeed = nonceSeed
      return nonceSeed
    } catch (error) {
      console.warn(
        'Failed to access store for nonce seed, using temporary seed:',
        error
      )
      const tempSeed = crypto.randomUUID()
      cachedNonceSeed = tempSeed
      return tempSeed
    } finally {
      nonceSeedPromise = null
    }
  })()

  return nonceSeedPromise
}

export class TauriUpdaterService implements UpdaterService {
  private cachedInstallableUpdate: Update | null = null
  private installableCheckPromise: Promise<Update | null> | null = null
  private cachedInstallChannel: InstallChannel | null = null
  private installChannelPromise: Promise<InstallChannel> | null = null

  /**
   * Detect Homebrew vs standalone install. Defaults to standalone when unsure
   * so manual/DMG installs keep the full in-app updater.
   */
  async getInstallChannel(): Promise<InstallChannel> {
    if (this.cachedInstallChannel) return this.cachedInstallChannel
    if (this.installChannelPromise) return this.installChannelPromise

    this.installChannelPromise = (async () => {
      try {
        const channel = await invoke<string>('get_install_channel')
        if (
          channel === 'homebrew' ||
          channel === 'standalone' ||
          channel === 'unknown'
        ) {
          this.cachedInstallChannel = channel
          return channel
        }
        this.cachedInstallChannel = 'standalone'
        return 'standalone'
      } catch (error) {
        console.warn(
          'Failed to resolve install channel; assuming standalone:',
          error
        )
        this.cachedInstallChannel = 'standalone'
        return 'standalone'
      } finally {
        this.installChannelPromise = null
      }
    })()

    return this.installChannelPromise
  }

  /**
   * Lazily fetch an installable Update via the Tauri plugin. Deduplicated so
   * concurrent callers share the same in-flight request.
   */
  private async getInstallableUpdate(): Promise<Update> {
    if (this.cachedInstallableUpdate) return this.cachedInstallableUpdate

    if (!this.installableCheckPromise) {
      this.installableCheckPromise = check()
    }

    let update: Update | null
    try {
      update = await this.installableCheckPromise
    } finally {
      // A rejected check must not poison later Update Now attempts. Clearing
      // in finally lets the next attempt retry after a transient failure.
      this.installableCheckPromise = null
    }

    if (!update) throw new Error('No update available')

    this.cachedInstallableUpdate = update
    return update
  }

  /**
   * Check for updates via the signed custom endpoint (Rust backend).
   * Makes a single HTTP request — no Tauri plugin-updater involvement here.
   */
  async check(): Promise<UpdateInfo | null> {
    try {
      const nonceSeed = await getNonceSeed()
      const update = await invoke<{
        version: string
        notes?: string
        pub_date?: string
        url?: string
        signature?: string
      } | null>('check_for_app_updates', { nonceSeed })

      if (!update) return null

      console.info('Update found via custom updater:', update.version)
      return {
        version: update.version,
        date: update.pub_date,
        body: update.notes,
        signature: update.signature,
      }
    } catch (error) {
      console.error('Error checking for updates in Tauri:', error)
      return null
    }
  }

  async downloadAndInstallWithProgress(
    progressCallback: (event: UpdateProgressEvent) => void
  ): Promise<void> {
    try {
      const update = await this.getInstallableUpdate()

      await update.downloadAndInstall((event) => {
        try {
          progressCallback(event as UpdateProgressEvent)
        } catch (callbackError) {
          console.warn('Error in download progress callback:', callbackError)
        }
      })

      this.cachedInstallableUpdate = null
    } catch (error) {
      this.cachedInstallableUpdate = null
      console.error('Error downloading update with progress in Tauri:', error)
      throw error
    }
  }
}
