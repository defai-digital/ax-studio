import { isDev } from '@/lib/utils'
import { useState, useCallback, useEffect } from 'react'
import { events, AppEvent } from '@ax-studio/core'
import type { InstallChannel, UpdateInfo } from '@/services/updater/types'
import { SystemEvent } from '@/types/events'
import { useServiceHub } from '@/hooks/useServiceHub'

export interface UpdateState {
  isUpdateAvailable: boolean
  updateInfo: UpdateInfo | null
  isDownloading: boolean
  downloadProgress: number
  downloadedBytes: number
  totalBytes: number
  remindMeLater: boolean
  /** Homebrew cask installs should not use in-app binary replace. */
  installChannel: InstallChannel
}

// Update state is synchronized across hook instances, so checks must share the
// same cancellation generation as well. Otherwise a stale failure in one
// instance can clear a newer successful result from another instance.
let activeUpdateCheck: AbortController | null = null
let activeUpdateDownload: Promise<void> | null = null

export const useAppUpdater = () => {
  const serviceHub = useServiceHub()
  const [updateState, setUpdateState] = useState<UpdateState>({
    isUpdateAvailable: false,
    updateInfo: null,
    isDownloading: false,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    remindMeLater: false,
    installChannel: 'standalone',
  })

  // Listen for app update state sync events
  useEffect(() => {
    const handleUpdateStateSync = (newState: Partial<UpdateState>) => {
      setUpdateState((prev) => ({
        ...prev,
        ...newState,
      }))
    }

    events.on('onAppUpdateStateSync', handleUpdateStateSync)

    return () => {
      events.off('onAppUpdateStateSync', handleUpdateStateSync)
    }
  }, [])

  const syncStateToOtherInstances = useCallback(
    (partialState: Partial<UpdateState>) => {
      // Emit event to sync state across all useAppUpdater instances
      events.emit('onAppUpdateStateSync', partialState)
    },
    []
  )

  const checkForUpdate = useCallback(
    async (resetRemindMeLater = false) => {
      activeUpdateCheck?.abort()
      const controller = new AbortController()
      activeUpdateCheck = controller

      try {
        if (resetRemindMeLater) {
          const newState = {
            remindMeLater: false,
          }
          setUpdateState((prev) => ({
            ...prev,
            ...newState,
          }))
          syncStateToOtherInstances(newState)
        }

        if (!isDev()) {
          if (AUTO_UPDATER_DISABLED) {
            return null
          }

          try {
            const channel = await serviceHub.updater().getInstallChannel()
            if (!controller.signal.aborted) {
              const channelState = { installChannel: channel }
              setUpdateState((prev) => ({ ...prev, ...channelState }))
              syncStateToOtherInstances(channelState)
            }
          } catch (channelError) {
            if (!controller.signal.aborted) {
              console.warn('Failed to resolve install channel:', channelError)
            }
          }

          if (controller.signal.aborted) return null
          const update = await serviceHub.updater().check()
          if (controller.signal.aborted) return null

          if (update) {
            const newState = {
              isUpdateAvailable: true,
              remindMeLater: false,
              updateInfo: update,
            }
            setUpdateState((prev) => ({
              ...prev,
              ...newState,
            }))
            // Sync to other instances
            syncStateToOtherInstances(newState)
            return update
          } else {
            // No update available - reset state
            const newState = {
              isUpdateAvailable: false,
              updateInfo: null,
            }
            setUpdateState((prev) => ({
              ...prev,
              ...newState,
            }))
            // Sync to other instances
            syncStateToOtherInstances(newState)
            return null
          }
        } else {
          const newState = {
            isUpdateAvailable: false,
            updateInfo: null,
            ...(resetRemindMeLater && { remindMeLater: false }),
          }
          setUpdateState((prev) => ({
            ...prev,
            ...newState,
          }))
          // Sync to other instances
          syncStateToOtherInstances(newState)
          return null
        }
      } catch (error) {
        if (controller.signal.aborted) return null
        console.error('Error checking for updates:', error)
        // Reset state on error
        const newState = {
          isUpdateAvailable: false,
          updateInfo: null,
        }
        setUpdateState((prev) => ({
          ...prev,
          ...newState,
        }))
        // Sync to other instances
        syncStateToOtherInstances(newState)
        return null
      } finally {
        if (activeUpdateCheck === controller) {
          activeUpdateCheck = null
        }
      }
    },
    [serviceHub, syncStateToOtherInstances]
  )

  const setRemindMeLater = useCallback(
    (remind: boolean) => {
      const newState = {
        remindMeLater: remind,
      }
      setUpdateState((prev) => ({
        ...prev,
        ...newState,
      }))
      // Sync to other instances
      syncStateToOtherInstances(newState)
    },
    [syncStateToOtherInstances]
  )

  const downloadAndInstallUpdate = useCallback(() => {
    if (AUTO_UPDATER_DISABLED) {
      return Promise.resolve()
    }

    if (!updateState.updateInfo) return Promise.resolve()
    if (activeUpdateDownload) return activeUpdateDownload

    const operation = (async () => {
      // Homebrew-managed installs must use `brew upgrade --cask ax-studio`.
      // Replacing the app in place desyncs the cask from Caskroom.
      let channel = updateState.installChannel
      try {
        channel = await serviceHub.updater().getInstallChannel()
      } catch {
        // keep state value
      }
      if (channel === 'homebrew') {
        console.info(
          'Skipping in-app install: Homebrew cask install detected. Use brew upgrade --cask ax-studio.'
        )
        return
      }

      activeUpdateCheck?.abort()

      try {
        setUpdateState((prev) => ({
          ...prev,
          isDownloading: true,
        }))

        let downloaded = 0
        let contentLength = 0
        await serviceHub.models().stopAllModels()
        serviceHub.events()?.emit(SystemEvent.KILL_SIDECAR)
        await new Promise((resolve) => setTimeout(resolve, 1000))

        await serviceHub.updater().downloadAndInstallWithProgress((event) => {
          switch (event.event) {
            case 'Started':
              contentLength = event.data?.contentLength || 0
              setUpdateState((prev) => ({
                ...prev,
                totalBytes: contentLength,
              }))
              // Emit app update download started event
              events.emit(AppEvent.onAppUpdateDownloadUpdate, {
                progress: 0,
                downloadedBytes: 0,
                totalBytes: contentLength,
              })
              break
            case 'Progress': {
              downloaded += event.data?.chunkLength || 0
              const progress = contentLength > 0 ? downloaded / contentLength : 0
              setUpdateState((prev) => ({
                ...prev,
                downloadProgress: progress,
                downloadedBytes: downloaded,
              }))

              // Emit app update download progress event
              events.emit(AppEvent.onAppUpdateDownloadUpdate, {
                progress: progress,
                downloadedBytes: downloaded,
                totalBytes: contentLength,
              })
              break
            }
            case 'Finished':
              setUpdateState((prev) => ({
                ...prev,
                downloadProgress: 1,
              }))
              break
          }
        })

        setUpdateState((prev) => ({
          ...prev,
          isDownloading: false,
          downloadProgress: 1,
          isUpdateAvailable: false,
          updateInfo: null,
        }))
        // Install already succeeded; relaunch is best-effort and must not
        // reclassify a successful install as a download/install failure.
        events.emit(AppEvent.onAppUpdateDownloadSuccess, {})
        try {
          await window.core?.api?.relaunch()
        } catch (relaunchError) {
          console.error('Error relaunching after update install:', relaunchError)
        }
      } catch (error) {
        console.error('Error downloading update:', error)
        setUpdateState((prev) => ({
          ...prev,
          isDownloading: false,
        }))

        // Emit app update download error event
        events.emit(AppEvent.onAppUpdateDownloadError, {
          message: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })()

    activeUpdateDownload = operation
    const clearOperation = () => {
      if (activeUpdateDownload === operation) {
        activeUpdateDownload = null
      }
    }
    void operation.then(clearOperation, clearOperation)
    return operation
  }, [serviceHub, updateState.updateInfo, updateState.installChannel])

  return {
    updateState,
    checkForUpdate,
    downloadAndInstallUpdate,
    setRemindMeLater,
  }
}
