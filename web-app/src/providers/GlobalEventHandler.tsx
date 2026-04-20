import { useEffect } from 'react'
import { events, ModelEvent, AppEvent, DownloadEvent } from '@ax-studio/core'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useDownloadStore } from '@/hooks/models/useDownloadStore'
import { useAppState } from '@/hooks/settings/useAppState'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'

// Map Rust error code strings to i18n keys in settings:llamacpp.errors
const ERROR_CODE_MAP: Record<string, string> = {
  BINARY_NOT_FOUND: 'binaryNotFound',
  MODEL_FILE_NOT_FOUND: 'modelFileNotFound',
  MODEL_LOAD_FAILED: 'modelLoadFailed',
  MODEL_LOAD_TIMED_OUT: 'modelLoadTimedOut',
  OUT_OF_MEMORY: 'outOfMemory',
  MODEL_ARCH_NOT_SUPPORTED: 'modelArchNotSupported',
  MULTIMODAL_PROJECTOR_LOAD_FAILED: 'multimodalProjectorLoadFailed',
  DEVICE_LIST_PARSE_FAILED: 'deviceListParseFailed',
  INVALID_ARGUMENT: 'invalidArgument',
}

/**
 * GlobalEventHandler handles global events that should be processed across all screens.
 * This provider is mounted at the root level.
 */
export function GlobalEventHandler() {
  const { setProviders } = useModelProvider()
  const serviceHub = useServiceHub()
  const navigate = useNavigate()
  const { t } = useTranslation()

  // ─── Settings changes ───────────────────────────────────────────────────────

  useEffect(() => {
    const handleSettingsChanged = async (event: {
      key: string
      value: string
    } | null) => {
      // Refresh providers when version_backend changes so the UI shows the new value
      if (event?.key === 'version_backend') {
        try {
          const updatedProviders = await serviceHub.providers().getProviders()
          setProviders(updatedProviders, serviceHub.path().sep())
        } catch (error) {
          console.error('Failed to refresh providers after settingsChanged:', error)
        }
      }
    }

    events.on('settingsChanged', handleSettingsChanged)
    return () => {
      events.off('settingsChanged', handleSettingsChanged)
    }
  }, [setProviders, serviceHub])

  // ─── Model load / ready / fail events ───────────────────────────────────────

  const setActiveModels = useAppState((state) => state.setActiveModels)

  useEffect(() => {
    // Sequence counter: if model-ready and model-stopped fire close together,
    // both handlers call the async getActiveModels() concurrently. The resolve
    // order isn't guaranteed to match the event order, so the later event's
    // result can be overwritten by the earlier one's result. Dropping stale
    // resolutions by sequence number keeps the active-models indicator
    // consistent with the true event order.
    let eventSeq = 0

    /**
     * OnModelReady — the llamacpp extension emits this after a model is loaded.
     * The engine layer is responsible for proxy registration; the app only
     * refreshes active-model state here.
     */
    const handleModelReady = async (_payload: {
      modelId?: string
      port?: number
      api_key?: string
      provider?: string
    }) => {
      const seq = ++eventSeq
      try {
        const active = await serviceHub.models().getActiveModels()
        if (seq !== eventSeq) return
        setActiveModels(active || [])
      } catch (error) {
        if (seq !== eventSeq) return
        console.error('[GlobalEventHandler] Failed to refresh active models after model ready:', error)
      }
    }

    /**
     * OnModelStopped — update active models list when a model is unloaded.
     */
    const handleModelStopped = async () => {
      const seq = ++eventSeq
      try {
        const active = await serviceHub.models().getActiveModels()
        if (seq !== eventSeq) return
        setActiveModels(active || [])
      } catch (error) {
        if (seq !== eventSeq) return
        console.error('[GlobalEventHandler] Failed to refresh active models after model stopped:', error)
      }
    }

    events.on(ModelEvent.OnModelReady, handleModelReady)
    events.on(ModelEvent.OnModelStopped, handleModelStopped)
    return () => {
      events.off(ModelEvent.OnModelReady, handleModelReady)
      events.off(ModelEvent.OnModelStopped, handleModelStopped)
    }
  }, [serviceHub, setActiveModels])

  useEffect(() => {
    /**
     * OnModelFail — the llamacpp extension emits this when a model fails to load.
     * Payload: { modelId: string; error: string }
     * The error string may contain an error code from ERROR_CODE_MAP.
     */
    const handleModelFail = (payload: { modelId?: string; error?: string }) => {
      const error = payload?.error ?? ''

      // Detect known error codes
      const matchedCode = Object.keys(ERROR_CODE_MAP).find((code) =>
        error.toUpperCase().includes(code)
      )

      const messageKey = matchedCode
        ? ERROR_CODE_MAP[matchedCode]
        : 'modelLoadFailed'

      const isOOM =
        messageKey === 'outOfMemory' ||
        error.toLowerCase().includes('out of memory') ||
        error.toLowerCase().includes('oom') ||
        error.toLowerCase().includes('failed to allocate')

      const userMessage = t(
        `settings:llamacpp.errors.${isOOM ? 'outOfMemory' : messageKey}` as Parameters<typeof t>[0]
      )

      const isContextExceeded =
        error.includes('finish_reason') && error.includes('length')
      if (isContextExceeded) {
        toast.error(
          t('settings:llamacpp.errors.contextExceeded' as Parameters<typeof t>[0])
        )
        return
      }

      toast.error(userMessage)
    }

    events.on(ModelEvent.OnModelFail, handleModelFail)
    return () => {
      events.off(ModelEvent.OnModelFail, handleModelFail)
    }
  }, [t])

  // ─── Model import / validation events ──────────────────────────────────────

  useEffect(() => {
    // Provider refresh on model import is handled by bootstrapEvents()
    // (see lib/bootstrap/bootstrap-events.ts) — registering it here too would
    // trigger two concurrent getProviders()/setProviders() calls per import.
    // We only own the user-visible toast notification here.
    const handleModelImported = () => {
      toast.success(
        t('settings:llamacpp.errors.modelImported' as Parameters<typeof t>[0])
      )
    }

    const handleModelValidationFailed = () => {
      toast.error(
        t('settings:llamacpp.errors.modelValidationFailed' as Parameters<typeof t>[0])
      )
    }

    events.on(AppEvent.onModelImported, handleModelImported)
    events.on(DownloadEvent.onModelValidationFailed, handleModelValidationFailed)

    return () => {
      events.off(AppEvent.onModelImported, handleModelImported)
      events.off(DownloadEvent.onModelValidationFailed, handleModelValidationFailed)
    }
  }, [t])

  // ─── Download events ───────────────────────────────────────────────────────

  const { updateProgress, removeDownload, removeLocalDownloadingModel } = useDownloadStore()

  type DownloadState = {
    downloadId?: string
    modelId: string
    percent?: number
    transferred?: number
    total?: number
    size?: { transferred?: number; total?: number }
  }

  useEffect(() => {
    const getDownloadId = (state: DownloadState) =>
      state.downloadId ?? state.modelId

    const onFileDownloadUpdate = (state: DownloadState) => {
      const downloadId = getDownloadId(state)
      const rawPercent = state.percent ?? (state.total ? (state.transferred ?? 0) / state.total : 0)
      const percent = Math.max(0, Math.min(100, rawPercent))
      const transferred = state.size?.transferred ?? state.transferred ?? 0
      const total = state.size?.total ?? state.total ?? 0

      updateProgress(downloadId, percent, downloadId, transferred, total)
    }

    const onFileDownloadSuccess = (state: DownloadState) => {
      const downloadId = getDownloadId(state)
      removeDownload(downloadId)
      removeLocalDownloadingModel(downloadId)
    }

    const onFileDownloadError = (state: DownloadState) => {
      const downloadId = getDownloadId(state)
      removeDownload(downloadId)
      removeLocalDownloadingModel(downloadId)
    }

    const onFileDownloadStopped = (state: DownloadState) => {
      const downloadId = getDownloadId(state)
      removeDownload(downloadId)
      removeLocalDownloadingModel(downloadId)
    }

    events.on(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
    events.on(DownloadEvent.onFileDownloadError, onFileDownloadError)
    events.on(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)
    events.on(DownloadEvent.onFileDownloadAndVerificationSuccess, onFileDownloadSuccess)

    return () => {
      events.off(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
      events.off(DownloadEvent.onFileDownloadError, onFileDownloadError)
      events.off(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)
      events.off(DownloadEvent.onFileDownloadAndVerificationSuccess, onFileDownloadSuccess)
    }
  }, [updateProgress, removeDownload, removeLocalDownloadingModel])

  // ─── Backend update available ───────────────────────────────────────────────

  useEffect(() => {
    const handleBackendUpdateAvailable = (updateInfo: {
      newVersion?: string
      updateNeeded?: boolean
    }) => {
      if (!updateInfo?.updateNeeded) return

      const version = updateInfo.newVersion ?? ''
      toast.info(
        t('settings:llamacpp.errors.backendUpdateAvailable' as Parameters<typeof t>[0], {
          version,
        }),
        {
          duration: 8000,
          action: {
            label: t('settings:hardware.updateNow' as Parameters<typeof t>[0]),
            onClick: () => {
              // Navigate via TanStack Router — the app is path-based, so
              // setting `window.location.hash` only added a URL fragment
              // and did nothing to the visible route.
              navigate({ to: route.settings.hardware })
            },
          },
        }
      )
    }

    events.on('onBackendUpdateAvailable', handleBackendUpdateAvailable)
    return () => {
      events.off('onBackendUpdateAvailable', handleBackendUpdateAvailable)
    }
  }, [t, navigate])

  return null
}
