import { useState, useCallback, useEffect } from 'react'
import { events } from '@ax-studio/core'
import { ExtensionManager } from '@/lib/extension'

export interface BackendUpdateInfo {
  updateNeeded: boolean
  newVersion: string
  currentVersion?: string
  targetBackend?: string
}

interface ExtensionSetting {
  key: string
  controller_props?: {
    value: unknown
  }
}

interface LlamacppExtension {
  getSettings?(): Promise<ExtensionSetting[]>
  checkBackendForUpdates?(): Promise<BackendUpdateInfo>
  updateBackend?(
    targetBackend: string
  ): Promise<{ wasUpdated: boolean; newBackend: string }>
  installBackend?(filePath: string): Promise<void>
  configureBackends?(): Promise<void>
}

export interface BackendUpdateState {
  isUpdateAvailable: boolean
  updateInfo: BackendUpdateInfo | null
  isUpdating: boolean
  remindMeLater: boolean
  autoUpdateEnabled: boolean
}

/**
 * Find the llamacpp extension from ExtensionManager.
 * Tries by exact name first, then by constructor / type heuristic.
 */
function getLlamacppExtension(): LlamacppExtension | null {
  const manager = ExtensionManager.getInstance()
  let ext = manager.getByName('@ax-studio/llamacpp-extension')

  if (!ext) {
    ext =
      manager
        .listExtensions()
        .find(
          (e) =>
            e.constructor.name.toLowerCase().includes('llamacpp') ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((e as any).type &&
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (e as any).type()?.toString().toLowerCase().includes('inference'))
        ) ?? undefined
  }

  return (ext as LlamacppExtension | undefined) ?? null
}

export function useBackendUpdater() {
  const [updateState, setUpdateState] = useState<BackendUpdateState>({
    isUpdateAvailable: false,
    updateInfo: null,
    isUpdating: false,
    remindMeLater: false,
    autoUpdateEnabled: false,
  })

  // Sync state across multiple hook instances via events
  useEffect(() => {
    const handleUpdateStateSync = (newState: Partial<BackendUpdateState>) => {
      setUpdateState((prev) => ({ ...prev, ...newState }))
    }

    events.on('onBackendUpdateStateSync', handleUpdateStateSync)
    return () => {
      events.off('onBackendUpdateStateSync', handleUpdateStateSync)
    }
  }, [])

  // Read auto_update_engine setting from extension on mount. Cancelled
  // flag guards against the hook unmounting before `getSettings()`
  // resolves — otherwise the `setUpdateState` call would land on an
  // unmounted component.
  useEffect(() => {
    let cancelled = false
    const checkAutoUpdateSetting = async () => {
      try {
        const ext = getLlamacppExtension()
        if (!ext || !('getSettings' in (ext as object))) return

        const settings = await ext.getSettings?.()
        if (cancelled) return
        const autoUpdateSetting = settings?.find(
          (s) => s.key === 'auto_update_engine'
        )

        setUpdateState((prev) => ({
          ...prev,
          autoUpdateEnabled: autoUpdateSetting?.controller_props?.value === true,
        }))
      } catch (error) {
        if (cancelled) return
        console.error('[useBackendUpdater] Failed to read auto_update_engine:', error)
      }
    }

    checkAutoUpdateSetting()
    return () => {
      cancelled = true
    }
  }, [])

  const syncState = useCallback((partial: Partial<BackendUpdateState>) => {
    events.emit('onBackendUpdateStateSync', partial)
  }, [])

  /**
   * Check whether a newer llamacpp backend version is available.
   * @param resetRemindMeLater Pass `true` to un-suppress the notification (e.g. called from Settings).
   */
  const checkForUpdate = useCallback(
    async (resetRemindMeLater = false) => {
      try {
        if (resetRemindMeLater) {
          const partial = { remindMeLater: false }
          setUpdateState((prev) => ({ ...prev, ...partial }))
          syncState(partial)
        }

        const ext = getLlamacppExtension()
        if (!ext || !('checkBackendForUpdates' in (ext as object))) {
          console.error('[useBackendUpdater] Extension missing checkBackendForUpdates')
          return null
        }

        const updateInfo = await ext.checkBackendForUpdates?.()

        if (updateInfo?.updateNeeded) {
          const partial = {
            isUpdateAvailable: true,
            remindMeLater: false,
            updateInfo,
          }
          setUpdateState((prev) => ({ ...prev, ...partial }))
          syncState(partial)
          return updateInfo
        } else {
          const partial = { isUpdateAvailable: false, updateInfo: null }
          setUpdateState((prev) => ({ ...prev, ...partial }))
          syncState(partial)
          return null
        }
      } catch (error) {
        console.error('[useBackendUpdater] checkForUpdate error:', error)
        const partial = { isUpdateAvailable: false, updateInfo: null }
        setUpdateState((prev) => ({ ...prev, ...partial }))
        syncState(partial)
        return null
      }
    },
    [syncState]
  )

  const setRemindMeLater = useCallback(
    (remind: boolean) => {
      const partial = { remindMeLater: remind }
      setUpdateState((prev) => ({ ...prev, ...partial }))
      syncState(partial)
    },
    [syncState]
  )

  /**
   * Download and install the available update.
   */
  const updateBackend = useCallback(async () => {
    if (!updateState.updateInfo) return

    try {
      setUpdateState((prev) => ({ ...prev, isUpdating: true }))

      const ext = getLlamacppExtension()
      if (
        !ext ||
        !('getSettings' in (ext as object)) ||
        !('updateBackend' in (ext as object))
      ) {
        throw new Error('LlamaCpp extension does not support backend updates')
      }

      // Get the current backend string (e.g. "b7524_linux-cuda-12-common_cpus-x64")
      const settings = await ext.getSettings?.()
      const currentBackendSetting = settings?.find(
        (s) => s.key === 'version_backend'
      )
      const currentBackend = currentBackendSetting?.controller_props?.value as string | undefined

      if (!currentBackend) {
        throw new Error('Current backend version not found in extension settings')
      }

      // Extract backend type: "b7524_linux-cuda-12-common_cpus-x64" → "linux-cuda-12-common_cpus-x64"
      const underscoreIdx = currentBackend.indexOf('_')
      const backendType =
        underscoreIdx >= 0 ? currentBackend.slice(underscoreIdx + 1) : currentBackend
      const targetBackendString = `${updateState.updateInfo.newVersion}_${backendType}`

      const result = await ext.updateBackend?.(targetBackendString)

      if (result?.wasUpdated) {
        const partial = {
          isUpdateAvailable: false,
          updateInfo: null,
          isUpdating: false,
        }
        setUpdateState((prev) => ({ ...prev, ...partial }))
        syncState(partial)
      } else {
        throw new Error('Backend update reported wasUpdated=false')
      }
    } catch (error) {
      console.error('[useBackendUpdater] updateBackend error:', error)
      setUpdateState((prev) => ({ ...prev, isUpdating: false }))
      throw error
    }
  }, [updateState.updateInfo, syncState])

  /**
   * Install a llamacpp backend from a local archive file (.tar.gz / .zip).
   */
  const installBackend = useCallback(async (filePath: string) => {
    const ext = getLlamacppExtension()
    if (!ext || !('installBackend' in (ext as object))) {
      throw new Error('LlamaCpp extension does not support installBackend')
    }

    await ext.installBackend?.(filePath)

    // Re-run configure so the extension picks up the newly installed backend
    await ext.configureBackends?.()
  }, [])

  return {
    updateState,
    checkForUpdate,
    updateBackend,
    setRemindMeLater,
    installBackend,
  }
}
