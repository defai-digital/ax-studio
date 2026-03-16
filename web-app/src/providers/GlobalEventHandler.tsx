import { useEffect } from 'react'
import { events, ModelEvent, AppEvent, DownloadEvent } from '@ax-studio/core'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useAppState } from '@/hooks/useAppState'
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
      // Update active models list
      try {
        const active = await serviceHub.models().getActiveModels()
        setActiveModels(active || [])
      } catch {
        // ignore
      }
    }

    /**
     * OnModelStopped — update active models list when a model is unloaded.
     */
    const handleModelStopped = async () => {
      try {
        const active = await serviceHub.models().getActiveModels()
        setActiveModels(active || [])
      } catch {
        // ignore
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

      const userMessage = t(
        `settings:llamacpp.errors.${messageKey}` as Parameters<typeof t>[0]
      )

      // Special human-friendly overrides for context-exceeded
      const isContextExceeded =
        error.includes('finish_reason') && error.includes('length')
      if (isContextExceeded) {
        toast.error(
          t('settings:llamacpp.errors.contextExceeded' as Parameters<typeof t>[0])
        )
        return
      }

      // OOM heuristic
      const isOOM =
        error.toLowerCase().includes('out of memory') ||
        error.toLowerCase().includes('oom') ||
        error.toLowerCase().includes('failed to allocate')
      if (isOOM) {
        toast.error(
          t('settings:llamacpp.errors.outOfMemory' as Parameters<typeof t>[0])
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
    const handleModelImported = async () => {
      // Refresh providers list to show the newly downloaded model
      try {
        const updatedProviders = await serviceHub.providers().getProviders()
        setProviders(updatedProviders, serviceHub.path().sep())
      } catch (error) {
        console.error('Failed to refresh providers after import:', error)
      }

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
  }, [t, serviceHub, setProviders])

  // ─── Download events ───────────────────────────────────────────────────────

  const { updateProgress, removeDownload, removeLocalDownloadingModel } = useDownloadStore()

  type DownloadState = {
    modelId: string
    percent?: number
    transferred?: number
    total?: number
    size?: { transferred?: number; total?: number }
  }

  useEffect(() => {
    const onFileDownloadUpdate = (state: DownloadState) => {
      const modelId = state.modelId
      const percent = state.percent ?? (state.total ? (state.transferred ?? 0) / state.total : 0)
      const transferred = state.size?.transferred ?? state.transferred ?? 0
      const total = state.size?.total ?? state.total ?? 0

      updateProgress(modelId, percent, modelId, transferred, total)
    }

    const onFileDownloadSuccess = (state: DownloadState) => {
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
    }

    const onFileDownloadError = (state: DownloadState) => {
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
    }

    const onFileDownloadStopped = (state: DownloadState) => {
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
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
              // Navigate to hardware settings — user can click "Update Now" there
              window.location.hash = '#/settings/hardware'
            },
          },
        }
      )
    }

    events.on('onBackendUpdateAvailable', handleBackendUpdateAvailable)
    return () => {
      events.off('onBackendUpdateAvailable', handleBackendUpdateAvailable)
    }
  }, [t])

  return null
}
